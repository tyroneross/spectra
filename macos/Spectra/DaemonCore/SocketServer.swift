// macos/Spectra/DaemonCore/SocketServer.swift
//
// M3.G1 flip — the unix-socket front door. A POSIX AF_UNIX/SOCK_STREAM listener
// (mode 0600, peer-credential auth by construction — single-user, no token/TCP),
// hand-rolled HTTP/1.1 framing (single request per connection, Connection: close
// on the native/local-response paths; raw pass-through framing for anything
// tunneled to the TS backend). Every request now goes through the Router
// (D-01/ADR-02) BEFORE dispatch: native ops hit the HandlerRegistry (mirrors
// src/daemon/server.ts's request lifecycle: envelope decode → capability check →
// param dispatch → success/error envelope); everything else — including
// unregistered-at-this-milestone ops and non-`/api/v1/` paths like SSE `/events`
// — byte-tunnels to the TS backend via ProxyClient (ADR-01).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

final class SocketServer: @unchecked Sendable {
    private let registry: HandlerRegistry
    private let context: DaemonContext
    private let router: Router
    private let proxyBackendSocket: String?
    private let dualRunEnabled: Bool
    private let dualRunRecorder: DualRunRecorder?
    private var listenFD: Int32 = -1
    private let acceptQueue = DispatchQueue(label: "spectra.daemon.accept")
    private let connQueue = DispatchQueue(label: "spectra.daemon.conn", attributes: .concurrent)

    /// TS body-limit parity (T-07): mirrors src/daemon/server.ts's MAX_JSON_BYTES
    /// (1 MiB) EXACTLY — oversized-body probes must get the identical
    /// status(413)/code(bad_request) pair from both daemons. Wire.maxBodyBytes
    /// (8 MiB, WireProtocol.swift, S2-owned) remains a coarser hard ceiling on
    /// the raw header-read phase only, purely for memory safety; this smaller
    /// constant is what actually fires for parity.
    private let tsBodyLimitBytes = 1024 * 1024

    init(
        registry: HandlerRegistry,
        context: DaemonContext,
        router: Router,
        proxyBackendSocket: String?,
        dualRunEnabled: Bool,
        dualRunRecorder: DualRunRecorder?
    ) {
        self.registry = registry
        self.context = context
        self.router = router
        self.proxyBackendSocket = proxyBackendSocket
        self.dualRunEnabled = dualRunEnabled
        self.dualRunRecorder = dualRunRecorder
    }

    /// Bind + listen on the unix socket, then accept connections until stopped.
    func start(socketPath: String) throws {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw POSIXError(errno: errno, ctx: "socket()") }

        // Remove any stale socket file, then bind.
        unlink(socketPath)
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketPath.utf8)
        guard pathBytes.count < MemoryLayout.size(ofValue: addr.sun_path) else {
            close(fd); throw DaemonApiError(.internalError, "socket path too long: \(socketPath)")
        }
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            ptr.withMemoryRebound(to: CChar.self, capacity: pathBytes.count + 1) { dst in
                for (i, b) in pathBytes.enumerated() { dst[i] = CChar(bitPattern: b) }
                dst[pathBytes.count] = 0
            }
        }
        let len = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bindRes = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) }
        }
        guard bindRes == 0 else { close(fd); throw POSIXError(errno: errno, ctx: "bind(\(socketPath))") }
        chmod(socketPath, Wire.socketMode)
        guard listen(fd, 64) == 0 else { close(fd); throw POSIXError(errno: errno, ctx: "listen") }

        listenFD = fd
        FileHandle.standardError.write(Data("[spectra-daemon] listening on \(socketPath) (mode 0600)\n".utf8))
        if let backend = proxyBackendSocket, !backend.isEmpty {
            FileHandle.standardError.write(Data("[spectra-daemon] proxying non-native ops to \(backend)\n".utf8))
        } else {
            FileHandle.standardError.write(Data("[spectra-daemon] no proxy backend configured — non-native ops resolve not_found\n".utf8))
        }
        FileHandle.standardError.write(Data("[spectra-daemon] routing config: \(router.configSource) (native: \(router.nativeOps.sorted().joined(separator: ", ")))\n".utf8))

        acceptQueue.sync {}  // ensure queue is live
        acceptLoop()
    }

    private func acceptLoop() {
        while true {
            let clientFD = accept(listenFD, nil, nil)
            if clientFD < 0 {
                if errno == EINTR { continue }
                break
            }
            connQueue.async { [weak self] in
                self?.handleConnection(clientFD)
                close(clientFD)
            }
        }
    }

    // ─── one HTTP/1.1 request/response per connection ────────────────────────
    private func handleConnection(_ fd: Int32) {
        let start = DispatchTime.now()
        switch readRawRequest(fd) {
        case .malformed:
            writeError(fd, requestId: nil, error: DaemonApiError(.badRequest, "Malformed HTTP request", status: 400))
        case .oversized:
            writeError(fd, requestId: nil, error: DaemonApiError(.badRequest, "Request body exceeds daemon limit", status: 413))
            logLine(op: "-", route: "-", status: 413, start: start)
        case .ok(let method, let path, let body, let rawBytes):
            dispatch(fd: fd, method: method, path: path, body: body, rawBytes: rawBytes, start: start)
        }
    }

    /// Mirrors `eventsRoute` in src/contract/wire.ts (`/api/v1/events`). SSE
    /// lives under the `/api/v1/` prefix by path shape but is GET-only and
    /// TS-owned streaming — it must never hit the POST-only API-op guard
    /// below. No Swift-side constant exists yet to import from wire.ts, so
    /// this literal is kept in exact lockstep with that string.
    private static let eventsRoute = "/api/v1/events"

    /// Route: `/api/v1/<op>` goes through the Router (native vs proxy); every
    /// other path (incl. SSE `/events`) tunnels to the backend wholesale,
    /// regardless of HTTP method — TS owns those semantics entirely (ADR-01).
    private func dispatch(fd: Int32, method: String, path: String, body: Data, rawBytes: Data, start: DispatchTime) {
        guard path.hasPrefix(Wire.apiRoutePrefix) else {
            dispatchNonApi(fd: fd, path: path, rawBytes: rawBytes, start: start)
            return
        }

        // SSE /events sits under the /api/v1/ prefix but is not a CoreApi op:
        // it's a GET-only streaming tunnel to the TS backend (ADR-01). Route
        // it through the same non-API byte-tunnel path BEFORE the POST-only
        // guard below, so it never gets bounced with 405. Every other
        // /api/v1/<op> path is unaffected and still requires POST.
        if path == Self.eventsRoute {
            dispatchNonApi(fd: fd, path: path, rawBytes: rawBytes, start: start)
            return
        }

        guard method == "POST" else {
            writeError(fd, requestId: nil, error: DaemonApiError(.badRequest, "CoreApi operations require POST", status: 405))
            logLine(op: path, route: "reject", status: 405, start: start)
            return
        }

        let operation = String(path.dropFirst(Wire.apiRoutePrefix.count))
        switch router.route(for: operation) {
        case .native:
            dispatchNative(fd: fd, operation: operation, body: body, start: start)
        case .proxy:
            dispatchProxy(fd: fd, operation: operation, body: body, rawBytes: rawBytes, start: start)
        }
    }

    /// Non-`/api/v1/` paths (SSE `/events`, anything else) — pure byte tunnel
    /// when a backend is configured; otherwise the pre-flip not_found behavior,
    /// unchanged.
    private func dispatchNonApi(fd: Int32, path: String, rawBytes: Data, start: DispatchTime) {
        guard let backend = proxyBackendSocket, !backend.isEmpty else {
            writeError(fd, requestId: nil, error: DaemonApiError(.notFound, "Unknown route \(path)", status: 404))
            logLine(op: path, route: "proxy", status: 404, start: start)
            return
        }
        do {
            let status = try ProxyClient.tunnel(clientFD: fd, requestBytes: rawBytes, backendSocketPath: backend)
            logLine(op: path, route: "proxy", status: status ?? 0, start: start)
        } catch {
            writeError(fd, requestId: nil, error: DaemonApiError(.daemonUnhealthy, "Backend daemon unreachable: \(error)", status: 503))
            logLine(op: path, route: "proxy", status: 503, start: start)
        }
    }

    /// Native dispatch: capability gate (P1 — CapabilityPolicy.shared.assert,
    /// S2-owned) BEFORE the handler runs, mirroring src/daemon/security.ts's
    /// assertCapabilities-before-param-dispatch ordering. Then optional
    /// dual-run shadow diff (D-02), log-only, never affecting the response.
    private func dispatchNative(fd: Int32, operation: String, body: Data, start: DispatchTime) {
        var requestId: String?
        do {
            let (rid, params) = try JSON.decodeEnvelope(body)
            requestId = rid
            guard let entry = registry.entry(for: operation) else {
                // Configured native but never registered by main.swift — defensive
                // fallback only; the compiled-in 5-op default always registers.
                throw DaemonApiError(.notFound, "Operation \(operation) not served by this daemon", status: 404)
            }
            try CapabilityPolicy.shared.assert(entry.requiredCapabilities, operation: operation)
            let result = try entry.handler(params, context)
            writeSuccess(fd, requestId: requestId, result: result)
            logLine(op: operation, route: "native", status: 200, start: start)
            maybeDualRun(operation: operation, params: params, swiftResult: result)
        } catch let e as DaemonApiError {
            writeError(fd, requestId: requestId, error: e)
            logLine(op: operation, route: "native", status: e.status, start: start)
        } catch {
            writeError(fd, requestId: requestId, error: DaemonApiError(.internalError, "\(error)", status: 500))
            logLine(op: operation, route: "native", status: 500, start: start)
        }
    }

    /// Proxy dispatch: pure byte tunnel when a backend is configured (no JSON
    /// parsing of the request at all — TS validates and answers). With no
    /// backend configured (e.g. Gate A's native-only regression run), preserve
    /// the exact pre-flip behavior: not_found, still echoing requestId when the
    /// body happens to decode (best-effort — never fatal on decode failure
    /// here, since the op was going to be not_found either way).
    private func dispatchProxy(fd: Int32, operation: String, body: Data, rawBytes: Data, start: DispatchTime) {
        guard let backend = proxyBackendSocket, !backend.isEmpty else {
            let requestId = (try? JSON.decodeEnvelope(body))?.requestId
            writeError(fd, requestId: requestId, error: DaemonApiError(.notFound, "Operation \(operation) not served by this daemon", status: 404))
            logLine(op: operation, route: "proxy", status: 404, start: start)
            return
        }
        do {
            let status = try ProxyClient.tunnel(clientFD: fd, requestBytes: rawBytes, backendSocketPath: backend)
            logLine(op: operation, route: "proxy", status: status ?? 0, start: start)
        } catch {
            writeError(fd, requestId: nil, error: DaemonApiError(.daemonUnhealthy, "Backend daemon unreachable: \(error)", status: 503))
            logLine(op: operation, route: "proxy", status: 503, start: start)
        }
    }

    /// D-02: shadow-call the backend for the 3 dual-run-eligible read ops when
    /// SPECTRA_DUAL_RUN=1 and a backend is configured. Log-only; a shadow-call
    /// failure still produces a JSONL row (never a starved dual-run op) but
    /// never touches the response already written to the real client.
    private func maybeDualRun(operation: String, params: Any?, swiftResult: Any) {
        guard dualRunEnabled, let recorder = dualRunRecorder else { return }
        guard router.isDualRunEligible(operation) else { return }
        guard let backend = proxyBackendSocket, !backend.isEmpty else { return }
        do {
            let tsResult = try ProxyClient.shadowCall(operation: operation, params: params, backendSocketPath: backend)
            recorder.record(op: operation, tsResult: tsResult, swiftResult: swiftResult)
        } catch {
            recorder.record(op: operation, tsResult: ["__shadowCallError": "\(error)"] as [String: Any], swiftResult: swiftResult)
        }
    }

    // ─── observability (Item 7): per-request router log line ─────────────────
    private func logLine(op: String, route: String, status: Int, start: DispatchTime) {
        let elapsedNs = DispatchTime.now().uptimeNanoseconds &- start.uptimeNanoseconds
        let ms = Double(elapsedNs) / 1_000_000
        let line = String(format: "[spectra-router] op=%@ route=%@ status=%d ms=%.2f\n", op, route, status, ms)
        FileHandle.standardError.write(Data(line.utf8))
    }

    // ─── HTTP framing ────────────────────────────────────────────────────────
    private enum RawRequest {
        case ok(method: String, path: String, body: Data, rawBytes: Data)
        case malformed
        case oversized
    }

    /// Read a full HTTP/1.1 request: headers until CRLFCRLF, then Content-Length
    /// bytes of body. `rawBytes` reconstructs exactly what the client sent
    /// (header block + body, in order) for verbatim tunnel replay — never
    /// re-parsed or re-serialized on the proxy path. `.oversized` fires the
    /// instant the declared/accumulated body exceeds the TS-parity limit
    /// (T-07), before reading further.
    private func readRawRequest(_ fd: Int32) -> RawRequest {
        var buffer = Data()
        let sep = Data("\r\n\r\n".utf8)
        var headerEnd: Int? = nil
        var chunk = [UInt8](repeating: 0, count: 16 * 1024)
        while headerEnd == nil {
            let n = read(fd, &chunk, chunk.count)
            if n <= 0 { return .malformed }
            buffer.append(contentsOf: chunk[0..<n])
            if buffer.count > Wire.maxBodyBytes { return .malformed }
            headerEnd = range(of: sep, in: buffer)?.lowerBound
        }
        guard let hEnd = headerEnd else { return .malformed }
        let headerData = buffer.subdata(in: 0..<hEnd)
        guard let headerStr = String(data: headerData, encoding: .utf8) else { return .malformed }
        let lines = headerStr.split(separator: "\r\n", omittingEmptySubsequences: false).map(String.init)
        guard let requestLine = lines.first else { return .malformed }
        let parts = requestLine.split(separator: " ").map(String.init)
        guard parts.count >= 2 else { return .malformed }
        let method = parts[0]
        let path = parts[1]

        var contentLength = 0
        for line in lines.dropFirst() {
            let lower = line.lowercased()
            if lower.hasPrefix("content-length:") {
                contentLength = Int(line.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        // TS body-limit parity (T-07): src/daemon/server.ts's readBody rejects
        // with status 413 / code bad_request the instant accumulated size
        // exceeds MAX_JSON_BYTES (1 MiB) — mirror that exactly, before reading
        // any further body bytes.
        if contentLength > tsBodyLimitBytes { return .oversized }

        let bodyStart = hEnd + sep.count
        var body = buffer.count > bodyStart ? buffer.subdata(in: bodyStart..<buffer.count) : Data()
        while body.count < contentLength {
            let n = read(fd, &chunk, chunk.count)
            if n <= 0 { break }
            body.append(contentsOf: chunk[0..<n])
            if body.count > tsBodyLimitBytes { return .oversized }
        }
        if contentLength > 0 && body.count > contentLength {
            body = body.subdata(in: 0..<contentLength)
        }
        let headerBlock = buffer.subdata(in: 0..<min(bodyStart, buffer.count))
        let rawBytes = headerBlock + body
        return .ok(method: method, path: path, body: body, rawBytes: rawBytes)
    }

    private func writeSuccess(_ fd: Int32, requestId: String?, result: Any) {
        writeHttp(fd, status: 200, reason: "OK", body: JSON.successEnvelope(requestId: requestId, result: result))
    }
    private func writeError(_ fd: Int32, requestId: String?, error: DaemonApiError) {
        writeHttp(fd, status: error.status, reason: reason(for: error.status), body: JSON.errorEnvelope(requestId: requestId, error: error))
    }

    private func writeHttp(_ fd: Int32, status: Int, reason: String, body: Data) {
        var head = "HTTP/1.1 \(status) \(reason)\r\n"
        head += "Content-Type: application/json\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(body)
        out.withUnsafeBytes { raw in
            var off = 0
            let base = raw.bindMemory(to: UInt8.self).baseAddress!
            while off < out.count {
                let w = write(fd, base + off, out.count - off)
                if w <= 0 { break }
                off += w
            }
        }
    }

    private func reason(for status: Int) -> String {
        switch status {
        case 200: return "OK"; case 400: return "Bad Request"; case 403: return "Forbidden"
        case 404: return "Not Found"; case 405: return "Method Not Allowed"; case 413: return "Payload Too Large"
        case 500: return "Internal Server Error"; case 503: return "Service Unavailable"
        default: return "Status"
        }
    }

    private func range(of needle: Data, in haystack: Data) -> Range<Int>? {
        guard needle.count <= haystack.count else { return nil }
        let end = haystack.count - needle.count
        var i = 0
        while i <= end {
            if haystack.subdata(in: i..<(i + needle.count)) == needle { return i..<(i + needle.count) }
            i += 1
        }
        return nil
    }
}

struct POSIXError: Error, CustomStringConvertible {
    let code: Int32
    let ctx: String
    init(errno code: Int32, ctx: String) { self.code = code; self.ctx = ctx }
    var description: String { "\(ctx): errno \(code) (\(String(cString: strerror(code))))" }
}
