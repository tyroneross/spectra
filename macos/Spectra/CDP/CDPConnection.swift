// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

public final class CDPConnection: NSObject, URLSessionWebSocketDelegate {
    public typealias EventHandler = @Sendable (Any?) -> Void

    private struct Pending {
        let method: String
        let continuation: CheckedContinuation<Any?, Error>
        let timeoutTask: Task<Void, Never>
    }

    private let timeoutSeconds: TimeInterval
    private let queue = DispatchQueue(label: "dev.spectra.cdp.connection")
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var nextID = 0
    private var pending: [Int: Pending] = [:]
    private var handlers: [String: [UUID: EventHandler]] = [:]

    public init(timeoutSeconds: TimeInterval = 30) {
        self.timeoutSeconds = timeoutSeconds
        super.init()
        self.session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }

    public var connected: Bool {
        queue.sync { task != nil }
    }

    public func connect(_ webSocketURL: String) async throws {
        guard let url = URL(string: webSocketURL) else {
            throw CDPError.connectionFailed(webSocketURL)
        }
        let ws = session.webSocketTask(with: url)
        queue.sync {
            self.task = ws
        }
        ws.resume()
        receiveNext()
    }

    @discardableResult
    public func send(
        _ method: String,
        params: [String: Any]? = nil,
        sessionID: String? = nil
    ) async throws -> Any? {
        let id = queue.sync { () -> Int in
            nextID += 1
            return nextID
        }

        let ws = queue.sync { task }
        guard let ws else { throw CDPError.notConnected }

        var message: [String: Any] = ["id": id, "method": method]
        if let params { message["params"] = params }
        if let sessionID { message["sessionId"] = sessionID }
        let data = try JSONSerialization.data(withJSONObject: message, options: [])
        guard let text = String(data: data, encoding: .utf8) else {
            throw CDPError.invalidResponse("Could not encode CDP request \(method)")
        }

        return try await withCheckedThrowingContinuation { continuation in
            let timeoutTask = Task { [weak self] in
                let nanos = UInt64(self?.timeoutSeconds ?? 30) * 1_000_000_000
                try? await Task.sleep(nanoseconds: nanos)
                self?.rejectPending(
                    id,
                    error: CDPError.timeout(method: method, seconds: Int(self?.timeoutSeconds ?? 30))
                )
            }

            queue.async {
                self.pending[id] = Pending(method: method, continuation: continuation, timeoutTask: timeoutTask)
                ws.send(.string(text)) { [weak self] error in
                    if let error {
                        self?.rejectPending(id, error: error)
                    }
                }
            }
        }
    }

    public func sendDictionary(
        _ method: String,
        params: [String: Any]? = nil,
        sessionID: String? = nil
    ) async throws -> [String: Any] {
        let value = try await send(method, params: params, sessionID: sessionID)
        guard let dict = value as? [String: Any] else {
            throw CDPError.invalidResponse("CDP method \(method) did not return an object")
        }
        return dict
    }

    @discardableResult
    public func on(_ method: String, handler: @escaping EventHandler) -> UUID {
        let token = UUID()
        queue.async {
            var bucket = self.handlers[method] ?? [:]
            bucket[token] = handler
            self.handlers[method] = bucket
        }
        return token
    }

    public func off(_ method: String, token: UUID) {
        queue.async {
            self.handlers[method]?.removeValue(forKey: token)
        }
    }

    public func close() async {
        let ws = queue.sync { task }
        ws?.cancel(with: .normalClosure, reason: nil)
        rejectAll(CDPError.webSocketClosed)
    }

    private func receiveNext() {
        let ws = queue.sync { task }
        ws?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleFrame(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handleFrame(text)
                    }
                @unknown default:
                    break
                }
                self.receiveNext()
            case .failure:
                self.rejectAll(CDPError.webSocketClosed)
            }
        }
    }

    private func handleFrame(_ text: String) {
        guard let data = text.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }

        if let id = CDPJSON.int(raw["id"]) {
            if let errorDict = raw["error"] as? [String: Any] {
                let code = CDPJSON.int(errorDict["code"]) ?? 0
                let message = CDPJSON.string(errorDict["message"]) ?? "Unknown CDP error"
                rejectPending(id, error: CDPError.protocolError(code: code, message: message))
            } else {
                resolvePending(id, value: raw["result"])
            }
            return
        }

        guard let method = raw["method"] as? String else { return }
        let params = raw["params"]
        let callbacks = queue.sync { Array(handlers[method]?.values ?? [:].values) }
        for callback in callbacks {
            callback(params)
        }
    }

    private func resolvePending(_ id: Int, value: Any?) {
        let pendingItem = queue.sync { () -> Pending? in
            guard let item = pending.removeValue(forKey: id) else { return nil }
            item.timeoutTask.cancel()
            return item
        }
        pendingItem?.continuation.resume(returning: value)
    }

    private func rejectPending(_ id: Int, error: Error) {
        let pendingItem = queue.sync { () -> Pending? in
            guard let item = pending.removeValue(forKey: id) else { return nil }
            item.timeoutTask.cancel()
            return item
        }
        pendingItem?.continuation.resume(throwing: error)
    }

    private func rejectAll(_ error: Error) {
        let items = queue.sync { () -> [Pending] in
            let values = Array(pending.values)
            pending.removeAll()
            task = nil
            return values
        }
        for item in items {
            item.timeoutTask.cancel()
            item.continuation.resume(throwing: error)
        }
    }
}
