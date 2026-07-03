// macos/Spectra/DaemonCore/BridgeClient.swift
//
// M3.G2 (S2) — stdio line-JSON RPC client to the EXISTING spectra-native AX
// helper binary (native/swift/main.swift, compiled to
// ~/.spectra/bin/spectra-native by src/native/compiler.ts — NOT this file's
// job to build it; a missing binary is a startup-time failure, not a compile
// step here). The contract spec is `src/native/bridge.ts`'s `NativeBridge`:
// same request shape ({id, method, params?} newline-delimited JSON on
// stdin), same response shape ({id, result} | {id, error:{code,message}} on
// stdout), same timeouts (5s per-request, 30s heartbeat interval, 2s
// heartbeat timeout), same "ping" handshake on start, same shared-singleton
// lifecycle ("don't close bridge — shared across sessions").
//
// ND-2: this is a SUBPROCESS client (Process + pipes) — never in-process
// AXUIElement. The helper is not owned by this W0 slice; a needed helper
// change is a FINDING, not something this file works around.
//
// The Driver protocol's methods (DriverProtocol.swift) are synchronous
// `throws`, not async — so `send(_:params:timeout:)` below blocks the
// calling thread on a semaphore while a background readability handler
// assembles stdout lines and resolves pending requests by id. This mirrors
// bridge.ts's Promise-per-request correlation table, just synchronously.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

/// Thrown for any bridge-transport-level failure: process wouldn't start,
/// request timed out, process died mid-request, or the native side returned
/// a JSON-RPC `error`. Callers (NativeDriver) that must never surface a
/// throw for an element/action-level failure (frozen Driver contract) catch
/// this and degrade to `success:false`; callers for which a bridge failure
/// IS the failure (connect(), computerUse's transport errors) let it
/// propagate.
struct BridgeError: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

/// Shared subprocess client for the native AX helper. One instance per
/// daemon process (`.shared`) — every NativeDriver session and every
/// ComputerUseOps session talks to the SAME helper subprocess, matching
/// bridge.ts's `getSharedBridge()` singleton. Internally thread-safe: id
/// allocation, the pending-request table, and stdin writes are all guarded
/// by one lock, so concurrent `send()` calls from different sessions
/// interleave safely via id correlation (mirrors bridge.ts's correctness
/// argument, which relies on Node's single-threaded event loop for the same
/// property — Swift needs the explicit lock since callers here are real
/// concurrent threads, not interleaved microtasks).
final class BridgeClient: @unchecked Sendable {
    static let shared = BridgeClient()

    static let requestTimeoutSeconds: TimeInterval = 5.0
    static let heartbeatIntervalSeconds: TimeInterval = 30.0
    static let heartbeatTimeoutSeconds: TimeInterval = 2.0

    private let lock = NSLock()
    private var process: Process?
    private var stdinHandle: FileHandle?
    private var stdoutBuffer = Data()
    private var nextId = 0
    private var pending: [Int: (Result<[String: Any], Error>) -> Void] = [:]
    private var isReady = false
    private var heartbeatTimer: DispatchSourceTimer?

    init() {}

    /// Mirrors bridge.ts's `ready` getter.
    private var ready: Bool {
        lock.lock(); defer { lock.unlock() }
        return isReady && process != nil && (process?.isRunning ?? false)
    }

    /// Resolves the compiled helper's path. `SPECTRA_NATIVE_HELPER_PATH`
    /// (test/override hook, mirrors the SPECTRA_HOME-style override pattern
    /// already used elsewhere in DaemonCore) takes precedence; production
    /// default is compiler.ts's `BINARY_PATH` (`~/.spectra/bin/spectra-native`).
    private func resolveBinaryPath() -> String {
        let env = ProcessInfo.processInfo.environment
        if let override = env["SPECTRA_NATIVE_HELPER_PATH"], !override.isEmpty {
            return override
        }
        let home = env["HOME"] ?? NSHomeDirectory()
        return (home as NSString).appendingPathComponent(".spectra/bin/spectra-native")
    }

    /// Mirrors bridge.ts's `start()`: spawn if not already running, set
    /// ready=true, then round-trip a "ping" (via `send`, which — since ready
    /// is now true — proceeds straight to the wire instead of recursing back
    /// into `start()`), then arm the heartbeat.
    func start() throws {
        if ready { return }
        try spawnProcess()
        lock.lock(); isReady = true; lock.unlock()
        _ = try send("ping", params: [:], timeout: BridgeClient.requestTimeoutSeconds)
        armHeartbeat()
    }

    private func spawnProcess() throws {
        let path = resolveBinaryPath()
        guard FileManager.default.isExecutableFile(atPath: path) else {
            throw BridgeError(
                message: "Native AX helper not found or not executable at \(path). "
                + "Build it via the TS compiler (src/native/compiler.ts ensureBinary) first."
            )
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: path)
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        proc.standardInput = stdinPipe
        proc.standardOutput = stdoutPipe
        proc.standardError = stderrPipe

        proc.terminationHandler = { [weak self] _ in self?.handleProcessExit() }

        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            self?.appendStdout(data)
        }
        // Drain stderr so the child never blocks on a full pipe buffer
        // (mirrors bridge.ts's stderr listener — a debug-log sink, not parsed).
        stderrPipe.fileHandleForReading.readabilityHandler = { _ in }

        do {
            try proc.run()
        } catch {
            throw BridgeError(message: "Failed to spawn native AX helper at \(path): \(error)")
        }

        lock.lock()
        process = proc
        stdinHandle = stdinPipe.fileHandleForWriting
        stdoutBuffer.removeAll()
        lock.unlock()
    }

    private func handleProcessExit() {
        lock.lock()
        let callbacks = Array(pending.values)
        pending.removeAll()
        process = nil
        stdinHandle = nil
        isReady = false
        lock.unlock()
        for callback in callbacks {
            callback(.failure(BridgeError(message: "Native process exited unexpectedly")))
        }
    }

    private func appendStdout(_ data: Data) {
        lock.lock()
        stdoutBuffer.append(data)
        var lines: [Data] = []
        while let range = stdoutBuffer.range(of: Data([0x0A])) {
            lines.append(stdoutBuffer.subdata(in: stdoutBuffer.startIndex..<range.lowerBound))
            stdoutBuffer.removeSubrange(stdoutBuffer.startIndex..<range.upperBound)
        }
        lock.unlock()
        for line in lines { handleLine(line) }
    }

    /// Mirrors bridge.ts's `handleLine`: parse JSON, ignore non-JSON /
    /// unknown-id lines (never crashes the read loop on a malformed line),
    /// resolve the pending request by id.
    private func handleLine(_ line: Data) {
        guard !line.isEmpty else { return }
        guard
            let obj = try? JSONSerialization.jsonObject(with: line, options: [.fragmentsAllowed]),
            let dict = obj as? [String: Any],
            let idAny = dict["id"]
        else { return }
        let id = (idAny as? NSNumber)?.intValue ?? (idAny as? Int)
        guard let requestId = id else { return }

        lock.lock()
        let callback = pending.removeValue(forKey: requestId)
        lock.unlock()
        guard let callback else { return }

        if let errorObj = dict["error"] as? [String: Any] {
            let code = (errorObj["code"] as? NSNumber)?.intValue ?? -1
            let message = errorObj["message"] as? String ?? "Native bridge error"
            callback(.failure(BridgeError(message: "Native error \(code): \(message)")))
        } else {
            let result = (dict["result"] as? [String: Any]) ?? [:]
            callback(.success(result))
        }
    }

    /// Mirrors bridge.ts's `send(method, params)`: auto-starts if not ready,
    /// writes one newline-delimited JSON request, blocks (via semaphore) up
    /// to `timeout` for the correlated response, then returns/throws.
    @discardableResult
    func send(_ method: String, params: [String: Any] = [:], timeout: TimeInterval = BridgeClient.requestTimeoutSeconds) throws -> [String: Any] {
        if !ready { try start() }

        let id: Int = {
            lock.lock(); defer { lock.unlock() }
            nextId += 1
            return nextId
        }()

        let semaphore = DispatchSemaphore(value: 0)
        var outcome: Result<[String: Any], Error> = .failure(
            BridgeError(message: "Native request '\(method)' timed out after \(Int(timeout))s. The target app may be unresponsive.")
        )
        lock.lock()
        pending[id] = { result in
            outcome = result
            semaphore.signal()
        }
        let handle = stdinHandle
        lock.unlock()

        guard let handle else {
            lock.lock(); pending.removeValue(forKey: id); lock.unlock()
            throw BridgeError(message: "Native bridge process is not running")
        }

        var message: [String: Any] = ["id": id, "method": method]
        if !params.isEmpty { message["params"] = params }
        guard let data = try? JSONSerialization.data(withJSONObject: message, options: []) else {
            lock.lock(); pending.removeValue(forKey: id); lock.unlock()
            throw BridgeError(message: "Failed to encode native request for '\(method)'")
        }
        var line = data
        line.append(0x0A)

        do {
            try handle.write(contentsOf: line)
        } catch {
            lock.lock(); pending.removeValue(forKey: id); lock.unlock()
            throw BridgeError(message: "Failed writing to native bridge stdin: \(error)")
        }

        let waitResult = semaphore.wait(timeout: .now() + timeout)
        if waitResult == .timedOut {
            lock.lock(); pending.removeValue(forKey: id); lock.unlock()
            throw BridgeError(message: "Native request '\(method)' timed out after \(Int(timeout))s. The target app may be unresponsive.")
        }

        switch outcome {
        case .success(let dict): return dict
        case .failure(let err): throw err
        }
    }

    private func armHeartbeat() {
        lock.lock()
        heartbeatTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "spectra.bridge.heartbeat"))
        timer.schedule(deadline: .now() + BridgeClient.heartbeatIntervalSeconds, repeating: BridgeClient.heartbeatIntervalSeconds)
        timer.setEventHandler { [weak self] in self?.performHeartbeat() }
        heartbeatTimer = timer
        lock.unlock()
        timer.resume()
    }

    private func performHeartbeat() {
        do {
            _ = try send("ping", params: [:], timeout: BridgeClient.heartbeatTimeoutSeconds)
        } catch {
            restart()
        }
    }

    /// Mirrors bridge.ts's `restart()`: stop the heartbeat, kill the process,
    /// clear ready state, start fresh.
    private func restart() {
        lock.lock()
        heartbeatTimer?.cancel()
        heartbeatTimer = nil
        let proc = process
        process = nil
        stdinHandle = nil
        isReady = false
        lock.unlock()
        proc?.terminate()
        try? start()
    }

    /// Full teardown: best-effort graceful "quit" then terminate. NEVER
    /// throws (graceful degradation — matches Driver.disconnect()'s
    /// never-throws contract, which is BridgeClient's only caller for this).
    func close() {
        lock.lock()
        heartbeatTimer?.cancel()
        heartbeatTimer = nil
        let proc = process
        let handle = stdinHandle
        process = nil
        stdinHandle = nil
        isReady = false
        let callbacks = Array(pending.values)
        pending.removeAll()
        lock.unlock()

        for callback in callbacks {
            callback(.failure(BridgeError(message: "Bridge closing")))
        }

        if let handle {
            let quit = try? JSONSerialization.data(withJSONObject: ["id": 0, "method": "quit"], options: [])
            if var line = quit {
                line.append(0x0A)
                try? handle.write(contentsOf: line)
            }
        }
        proc?.terminate()
    }
}
