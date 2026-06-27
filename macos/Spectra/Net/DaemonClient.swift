// DaemonClient.swift
//
// Unix-domain-socket client for the Spectra daemon, speaking the FROZEN wire
// contract (apiVersion 2). The menu-bar app is a thin forwarding surface: it
// connects to ~/.spectra/daemon.sock (mode 0600, OS-enforced single-user — no
// bearer token, no TCP, no DNS-rebinding surface) and POSTs an enveloped
// request to /api/v1/<operation>. The daemon authenticates by socket peer
// credentials. This replaces the pre-contract TCP/MCP-JSON-RPC client.
//
// Transport: Network.framework NWConnection over an NWEndpoint.unix endpoint.
// Foundation's URLSession cannot address a unix socket, so HTTP/1.1 framing is
// written by hand (single request per connection, `Connection: close`).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation
import Network

public enum DaemonError: Error, LocalizedError, Sendable {
    case daemonDown(hint: String)
    case apiError(code: String, message: String, hint: String?)
    case versionSkew(apiVersion: Int, expected: Int)
    case malformedResponse(String)

    public var errorDescription: String? {
        switch self {
        case .daemonDown(let hint):
            return "Spectra daemon is not reachable. \(hint)"
        case .apiError(let code, let message, let hint):
            return hint.map { "\(message) [\(code)] — \($0)" } ?? "\(message) [\(code)]"
        case .versionSkew(let api, let expected):
            return "Daemon apiVersion \(api) does not match app expectation \(expected). Update both to matching builds."
        case .malformedResponse(let detail):
            return "Malformed daemon response: \(detail)"
        }
    }
}

/// Daemon version metadata (derived from the `health` operation).
public struct VersionInfo: Codable, Equatable, Sendable {
    public let apiVersion: Int
    public let daemonVersion: String
}

/// `health` operation result (subset the menu-bar app needs).
public struct HealthInfo: Codable, Sendable, Equatable {
    public let ok: Bool
    public let apiVersion: Int
    public let daemonVersion: String
    public let pid: Int
    public let aquaSession: Bool
    public struct WindowServer: Codable, Sendable, Equatable {
        public let connected: Bool
        public let error: String?
    }
    public let windowServer: WindowServer
}

private let kDaemonDownHint =
    "Start the Spectra menu-bar app (it owns screen capture in a GUI session), " +
    "or run `spectra daemon` from a logged-in desktop session."

public actor DaemonClient {
    public static let expectedApiVersion = 2
    public static let defaultSocketPath =
        (NSString(string: "~/.spectra/daemon.sock").expandingTildeInPath)

    private let socketPath: String
    private let surface: String
    private let timeout: TimeInterval

    public init(
        socketPath: String = DaemonClient.defaultSocketPath,
        surface: String = "menubar",
        timeout: TimeInterval = 30
    ) {
        self.socketPath = socketPath
        self.surface = surface
        self.timeout = timeout
    }

    // ─── Public entry points ─────────────────────────────────

    /// Forward a CoreApi operation. Returns the raw `result` JSON so callers can
    /// decode their own concrete types. Throws an actionable `DaemonError`.
    @discardableResult
    public func call(operation: String, params: [String: Any]? = nil) async throws -> Data {
        let envelope = try makeEnvelope(operation: operation, params: params)
        let (status, body) = try await send(operation: operation, body: envelope)
        return try decodeResult(status: status, body: body)
    }

    /// Decode the `health` operation into `HealthInfo`.
    public func health() async throws -> HealthInfo {
        let data = try await call(operation: "health", params: [:])
        do {
            let info = try JSONDecoder().decode(HealthInfo.self, from: data)
            if info.apiVersion != Self.expectedApiVersion {
                throw DaemonError.versionSkew(apiVersion: info.apiVersion, expected: Self.expectedApiVersion)
            }
            return info
        } catch let e as DaemonError {
            throw e
        } catch {
            throw DaemonError.malformedResponse("health: \(error.localizedDescription)")
        }
    }

    /// Lightweight reachability probe.
    public func isUp() async -> Bool {
        do { _ = try await call(operation: "health", params: [:]); return true }
        catch DaemonError.daemonDown { return false }
        catch { return true } // an API/HTTP error still means the daemon answered
    }

    // ─── Envelope ────────────────────────────────────────────

    private func makeEnvelope(operation: String, params: [String: Any]?) throws -> Data {
        var envelope: [String: Any] = [
            "apiVersion": Self.expectedApiVersion,
            "requestId": UUID().uuidString,
            "operation": operation,
            "caller": ["surface": surface, "name": "Spectra.app"],
        ]
        if let params { envelope["params"] = params }
        do {
            return try JSONSerialization.data(withJSONObject: envelope, options: [])
        } catch {
            throw DaemonError.malformedResponse("could not encode request: \(error.localizedDescription)")
        }
    }

    private func decodeResult(status: Int, body: Data) throws -> Data {
        guard
            let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
        else {
            throw DaemonError.malformedResponse("HTTP \(status): non-JSON body")
        }
        if let ok = obj["ok"] as? Bool, ok == true {
            let result = obj["result"] ?? NSNull()
            return (try? JSONSerialization.data(withJSONObject: result, options: [])) ?? Data("null".utf8)
        }
        // Error envelope → actionable DaemonError.
        if let err = obj["error"] as? [String: Any] {
            let code = (err["code"] as? String) ?? "internal_error"
            let message = (err["message"] as? String) ?? "Daemon error (HTTP \(status))"
            let hint = err["hint"] as? String
            if message.range(of: "CGS_REQUIRE_INIT", options: .caseInsensitive) != nil
                || message.range(of: "window server", options: .caseInsensitive) != nil {
                throw DaemonError.apiError(
                    code: "daemon_unhealthy",
                    message: "The daemon is running but not attached to the window server, so it cannot capture.",
                    hint: "Quit and reopen the Spectra menu-bar app from a logged-in desktop session.")
            }
            throw DaemonError.apiError(code: code, message: message, hint: hint)
        }
        throw DaemonError.malformedResponse("HTTP \(status): not a contract envelope")
    }

    // ─── Backward-compatible surface for the menu-bar app ────
    //
    // The ViewModel + WalkthroughPlanner still speak in MCP tool names. These
    // shims map a tool call to a frozen-contract operation (Swift mirror of
    // src/mcp/forward.ts) and forward over the socket, so app callers compile
    // unchanged while routing through the apiVersion-2 contract.

    /// Version probe — derived from `health` (the contract has no /api/version).
    public func probeVersion(timeout _: TimeInterval = 0.5) async throws -> VersionInfo {
        let info = try await health()
        return VersionInfo(apiVersion: info.apiVersion, daemonVersion: info.daemonVersion)
    }

    /// Map an MCP tool name + arguments to a CoreApi operation and forward it.
    /// Returns the raw `result` JSON (same contract the old callTool returned).
    @discardableResult
    public func callTool(name: String, arguments: [String: Any]) async throws -> Data {
        let (operation, params) = try Self.mapTool(name: name, arguments: arguments)
        return try await call(operation: operation, params: params)
    }

    /// No-op retained for source compatibility (there is no MCP session state
    /// over the unix socket).
    public func resetSession() {}

    static func mapTool(name: String, arguments: [String: Any]) throws -> (String, [String: Any]?) {
        func pick(_ keys: [String]) -> [String: Any] {
            var out: [String: Any] = [:]
            for k in keys where arguments[k] != nil { out[k] = arguments[k] }
            return out
        }
        switch name {
        case "spectra_connect": return ("createSession", pick(["target", "name", "record", "repoPath"]))
        case "spectra_snapshot": return ("snapshot", pick(["sessionId", "screenshot"]))
        case "spectra_act": return ("act", pick(["sessionId", "elementId", "action", "value"]))
        case "spectra_step": return ("step", pick(["sessionId", "intent"]))
        case "spectra_analyze": return ("analyze", pick(["sessionId", "viewport"]))
        case "spectra_discover": return ("discover", pick(["sessionId", "maxDepth", "maxScreens", "captureStates", "clean", "outputDir"]))
        case "spectra_walkthrough": return ("walkthrough", pick(["sessionId", "steps", "clean"]))
        case "spectra_llm_step": return ("llmStep", pick(["sessionId", "actions", "continueOnError"]))
        case "spectra_record": return ("recordTerminal", pick(["command", "timeout", "watch_files", "outputDir"]))
        case "spectra_replay": return ("replayTerminal", pick(["file", "search", "commands_only"]))
        case "spectra_library": return ("library", arguments)
        case "spectra_demo": return ("demo", arguments)
        case "spectra_capture":
            switch arguments["type"] as? String {
            case "screenshot": return ("screenshot", pick(["sessionId", "preset", "mode", "elementId", "region", "aspectRatio", "clean", "quality"]))
            case "start_recording": return ("startRecording", pick(["sessionId", "preset", "fps", "codec", "bitrate", "hardware", "composite"]))
            case "stop_recording": return ("stopRecording", pick(["sessionId", "preset"]))
            default: throw DaemonError.malformedResponse("spectra_capture: unknown type")
            }
        case "spectra_session":
            switch arguments["action"] as? String {
            case "list": return ("listSessions", pick(["includeClosed"]))
            case "get": return ("getSession", pick(["sessionId"]))
            case "run": return ("getRun", pick(["sessionId"]))
            case "close": return ("closeSession", pick(["sessionId"]))
            case "close_all": return ("closeAllSessions", nil)
            case "record_llm_usage": return ("recordLlmUsage", pick(["sessionId", "usage"]))
            default: throw DaemonError.malformedResponse("spectra_session: unknown action")
            }
        default:
            throw DaemonError.malformedResponse("unknown tool: \(name)")
        }
    }

    // ─── Unix-socket HTTP/1.1 (single request, Connection: close) ──

    private func send(operation: String, body: Data) async throws -> (Int, Data) {
        let request = buildHttpRequest(path: "/api/v1/\(operation)", body: body)
        let endpoint = NWEndpoint.unix(path: socketPath)
        let connection = NWConnection(to: endpoint, using: .tcp)

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<(Int, Data), Error>) in
            let box = ResumeOnce(continuation)
            let queue = DispatchQueue(label: "spectra.daemon-client")

            // Overall timeout guard.
            queue.asyncAfter(deadline: .now() + timeout) {
                if box.tryClaim() {
                    connection.cancel()
                    box.resume(throwing: DaemonError.daemonDown(hint: "Request timed out. \(kDaemonDownHint)"))
                }
            }

            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    connection.send(content: request, completion: .contentProcessed { sendErr in
                        if let sendErr {
                            if box.tryClaim() {
                                connection.cancel()
                                box.resume(throwing: DaemonError.daemonDown(hint: "\(sendErr.localizedDescription). \(kDaemonDownHint)"))
                            }
                            return
                        }
                        receiveAll(connection: connection) { result in
                            switch result {
                            case .success(let raw):
                                if box.tryClaim() {
                                    connection.cancel()
                                    do {
                                        let (status, payload) = try parseHttpResponse(raw)
                                        box.resume(returning: (status, payload))
                                    } catch {
                                        box.resume(throwing: error)
                                    }
                                }
                            case .failure(let err):
                                if box.tryClaim() {
                                    connection.cancel()
                                    box.resume(throwing: DaemonError.daemonDown(hint: "\(err.localizedDescription). \(kDaemonDownHint)"))
                                }
                            }
                        }
                    })
                case .failed(let err):
                    if box.tryClaim() {
                        connection.cancel()
                        box.resume(throwing: DaemonError.daemonDown(hint: "\(err.localizedDescription). \(kDaemonDownHint)"))
                    }
                case .cancelled:
                    break
                default:
                    break
                }
            }
            connection.start(queue: queue)
        }
    }

    private func buildHttpRequest(path: String, body: Data) -> Data {
        var head = ""
        head += "POST \(path) HTTP/1.1\r\n"
        head += "Host: spectra.local\r\n"
        head += "Content-Type: application/json\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Connection: close\r\n"
        head += "\r\n"
        var data = Data(head.utf8)
        data.append(body)
        return data
    }
}

// ─── Helpers (non-isolated) ─────────────────────────────────

/// One-shot continuation guard — Network callbacks can fire more than once.
private final class ResumeOnce: @unchecked Sendable {
    private let continuation: CheckedContinuation<(Int, Data), Error>
    private let lock = NSLock()
    private var done = false
    init(_ continuation: CheckedContinuation<(Int, Data), Error>) { self.continuation = continuation }
    func tryClaim() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }
    func resume(returning value: (Int, Data)) { continuation.resume(returning: value) }
    func resume(throwing error: Error) { continuation.resume(throwing: error) }
}

/// Read from the connection until it completes (server closed after response).
private func receiveAll(connection: NWConnection, completion: @escaping @Sendable (Result<Data, Error>) -> Void) {
    var buffer = Data()
    func step() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { chunk, _, isComplete, error in
            if let chunk, !chunk.isEmpty { buffer.append(chunk) }
            if let error {
                completion(.failure(error)); return
            }
            if isComplete {
                completion(.success(buffer)); return
            }
            step()
        }
    }
    step()
}

/// Parse an HTTP/1.1 response into (statusCode, body). Splits on the first
/// CRLFCRLF; ignores chunked encoding (the daemon sends Content-Length or
/// Connection: close with a single JSON body).
private func parseHttpResponse(_ raw: Data) throws -> (Int, Data) {
    let separator = Data("\r\n\r\n".utf8)
    guard let range = raw.range(of: separator) else {
        throw DaemonError.malformedResponse("no header/body separator")
    }
    let headerData = raw.subdata(in: raw.startIndex..<range.lowerBound)
    let body = raw.subdata(in: range.upperBound..<raw.endIndex)
    guard let headerText = String(data: headerData, encoding: .utf8) else {
        throw DaemonError.malformedResponse("non-UTF8 headers")
    }
    // Status line: "HTTP/1.1 200 OK"
    guard
        let statusLine = headerText.split(separator: "\r\n").first,
        case let parts = statusLine.split(separator: " "),
        parts.count >= 2,
        let status = Int(parts[1])
    else {
        throw DaemonError.malformedResponse("unparseable status line")
    }
    return (status, body)
}
