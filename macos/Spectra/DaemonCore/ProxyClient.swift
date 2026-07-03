// macos/Spectra/DaemonCore/ProxyClient.swift
//
// M3.G1 flip — the byte-tunnel to the TS backend daemon (ADR-01). For any
// non-native op (per Router) and any non-`/api/v1/` path (incl. SSE `/events`),
// the front door replays the client's buffered request bytes to the backend
// unix socket VERBATIM and streams the response bytes back to the client until
// the backend closes the connection — no HTTP re-parsing, no JSON
// re-serialization on either side. That is what makes SSE and every future
// proxied op "just work" without bespoke handling.
//
// Also carries the dual-run (D-02) shadow-call path: a SEPARATE, normal
// (parsed) request/response round-trip against the backend, used ONLY to
// shape-diff against the native Swift result for observability — it never
// touches the bytes returned to the real client.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

enum ProxyError: Error, CustomStringConvertible {
    case backendUnreachable(String)

    var description: String {
        switch self {
        case .backendUnreachable(let detail): return "backend unreachable: \(detail)"
        }
    }
}

enum ProxyClient {
    /// Open a fresh connection to the backend unix socket. Thrown as
    /// `.backendUnreachable` on any socket()/connect() failure — callers map
    /// this to a `daemon_unhealthy` (503) error envelope for proxied requests
    /// that haven't streamed any client-facing bytes yet.
    private static func connectBackend(_ socketPath: String) throws -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw ProxyError.backendUnreachable("socket() failed: errno \(errno)") }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketPath.utf8)
        guard pathBytes.count < MemoryLayout.size(ofValue: addr.sun_path) else {
            close(fd)
            throw ProxyError.backendUnreachable("backend socket path too long: \(socketPath)")
        }
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            ptr.withMemoryRebound(to: CChar.self, capacity: pathBytes.count + 1) { dst in
                for (i, b) in pathBytes.enumerated() { dst[i] = CChar(bitPattern: b) }
                dst[pathBytes.count] = 0
            }
        }
        let len = socklen_t(MemoryLayout<sockaddr_un>.size)
        let connectRes = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, len) }
        }
        guard connectRes == 0 else {
            let err = errno
            close(fd)
            throw ProxyError.backendUnreachable("connect(\(socketPath)) failed: errno \(err) (\(String(cString: strerror(err))))")
        }
        return fd
    }

    private static func writeAll(_ fd: Int32, _ data: Data) throws {
        try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return }
            var off = 0
            while off < data.count {
                let w = write(fd, base + off, data.count - off)
                if w <= 0 {
                    if w < 0 && errno == EINTR { continue }
                    throw ProxyError.backendUnreachable("write() to backend failed: errno \(errno)")
                }
                off += w
            }
        }
    }

    /// Raw byte-tunnel: connect to the backend, replay `requestBytes` verbatim,
    /// then copy backend response bytes to `clientFD` until the backend closes
    /// (or the client goes away). Works identically for a single JSON
    /// request/response and a long-lived SSE stream — no framing assumptions
    /// on the body/frames. The ONE exception (see `forceConnectionClose`
    /// below): the response's `Connection` header is corrected, because the
    /// front door itself is strictly single-request-per-connection
    /// (`SocketServer.acceptLoop` closes the client fd unconditionally right
    /// after this call returns) while the TS backend answers with its own
    /// `Connection: keep-alive` (Node's http.Server default — verified: Node's
    /// default global Agent also defaults `keepAlive: true`). Forwarding that
    /// header verbatim was a live bug: any keep-alive HTTP/1.1 client (incl.
    /// Node's own default Agent) would pool the now-single-use socket and
    /// reuse it for its NEXT request, which the front door will never read —
    /// the reused write either hangs until the backend's own keep-alive
    /// timeout elapses or races the front door's close(), surfacing as
    /// `ECONNRESET`/"socket hang up". Fixing the header (not the backend's
    /// behavior, not the body) is the minimal correct fix: it tells every
    /// client the truth about what this front door actually does.
    ///
    /// Returns the HTTP status code parsed (read-only peek, never mutated) from
    /// the first response line if present, for the per-request log line only;
    /// `nil` if it couldn't be determined (e.g. zero-byte response).
    @discardableResult
    static func tunnel(clientFD: Int32, requestBytes: Data, backendSocketPath: String) throws -> Int? {
        let backendFD = try connectBackend(backendSocketPath)
        defer { close(backendFD) }

        try writeAll(backendFD, requestBytes)

        var chunk = [UInt8](repeating: 0, count: 32 * 1024)

        // ─── Phase 1: read + fix up the response header block only ───────────
        // Accumulate until the header terminator is seen (it may not arrive in
        // a single read()), rewrite/insert `Connection: close`, then write the
        // corrected header block plus whatever body bytes rode along in the
        // same read(s) — never re-parses or re-serializes anything past the
        // header terminator.
        let sep = Data("\r\n\r\n".utf8)
        var headerBuf = Data()
        var headerRange: Range<Int>?
        var backendEOF = false
        while headerRange == nil {
            let n = read(backendFD, &chunk, chunk.count)
            if n == 0 { backendEOF = true; break }
            if n < 0 {
                if errno == EINTR { continue }
                backendEOF = true
                break
            }
            headerBuf.append(contentsOf: chunk[0..<n])
            headerRange = rangeOf(sep, in: headerBuf)
            // Safety cap only — a real backend response header block is a few
            // hundred bytes; never buffer unboundedly for a malformed/hostile
            // backend. Falls through to the "no terminator observed" path.
            if headerRange == nil && headerBuf.count > Wire.maxBodyBytes { break }
        }

        guard let hRange = headerRange else {
            // No complete header block observed (empty, malformed, or the
            // backend closed before finishing headers) — forward whatever
            // bytes did arrive, verbatim, and stop. Never fabricate a
            // response the backend didn't actually send.
            if headerBuf.isEmpty { return nil }
            let status = parseStatusLine(Array(headerBuf), count: headerBuf.count)
            _ = writeToClient(clientFD, headerBuf)
            return status
        }

        let headerBlock = headerBuf.subdata(in: 0..<hRange.lowerBound)
        let afterHeaders = headerBuf.subdata(in: hRange.upperBound..<headerBuf.count)
        let observedStatus = parseStatusLine(Array(headerBlock), count: headerBlock.count)

        var out = forceConnectionClose(headerBlock)
        out.append(sep)
        out.append(afterHeaders)
        guard writeToClient(clientFD, out) else { return observedStatus }
        if backendEOF { return observedStatus }

        // ─── Phase 2: pure byte copy for everything after the headers ────────
        // Unchanged from before — body bytes and SSE frames are never
        // inspected or rewritten, only relayed until the backend closes (or
        // the client goes away).
        while true {
            let n = read(backendFD, &chunk, chunk.count)
            if n == 0 { break }
            if n < 0 {
                if errno == EINTR { continue }
                break
            }
            if !writeToClient(clientFD, Data(chunk[0..<n])) {
                // Client went away mid-stream; stop tunneling, nothing more to do.
                return observedStatus
            }
        }
        return observedStatus
    }

    /// Writes `data` to `clientFD`, tolerating EINTR. Returns `false` the
    /// instant the client is gone (write() <= 0 and not EINTR) so callers can
    /// stop tunneling without treating a departed client as a hard error.
    @discardableResult
    private static func writeToClient(_ fd: Int32, _ data: Data) -> Bool {
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
            guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return true }
            var off = 0
            while off < data.count {
                let w = write(fd, base + off, data.count - off)
                if w <= 0 {
                    if w < 0 && errno == EINTR { continue }
                    return false
                }
                off += w
            }
            return true
        }
    }

    /// Rewrites (or inserts) the `Connection` header in an HTTP response
    /// header block to `close`. `headerBlock` is "STATUS-LINE\r\nHeader:
    /// value\r\n...\r\nHeader: value" (no trailing CRLF — the caller appends
    /// the `\r\n\r\n` terminator separately). Best-effort: if the header block
    /// somehow isn't valid UTF-8 (never observed in practice — HTTP headers
    /// are ASCII), returns it unchanged rather than losing bytes.
    private static func forceConnectionClose(_ headerBlock: Data) -> Data {
        guard let str = String(data: headerBlock, encoding: .utf8) else { return headerBlock }
        var lines = str.components(separatedBy: "\r\n")
        var replaced = false
        for i in 1..<max(lines.count, 1) where i < lines.count {
            if lines[i].lowercased().hasPrefix("connection:") {
                lines[i] = "Connection: close"
                replaced = true
            }
        }
        if !replaced { lines.append("Connection: close") }
        return Data(lines.joined(separator: "\r\n").utf8)
    }

    /// Read-only peek at "HTTP/1.1 NNN ..." in the leading bytes of a response
    /// chunk. Never allocates a copy of the whole response, never rewrites it.
    private static func parseStatusLine(_ bytes: [UInt8], count: Int) -> Int? {
        let prefix = "HTTP/1.1 "
        guard count > prefix.count else { return nil }
        let data = Data(bytes[0..<min(count, 64)])
        guard let s = String(data: data, encoding: .utf8), s.hasPrefix(prefix) else { return nil }
        let rest = s.dropFirst(prefix.count)
        let digits = rest.prefix(while: { $0.isNumber })
        return Int(digits)
    }

    // ─── dual-run shadow calls (D-02) ─────────────────────────────────────────

    /// A parsed (non-tunnel) round-trip to the backend for the SAME operation
    /// the native handler just served, used only to shape-diff for dual-run
    /// observability. Constructs its own well-formed envelope (apiVersion 2,
    /// synthetic requestId) — this is a fresh outgoing request Swift originates
    /// itself, not a re-serialization of a tunneled request, so it does not
    /// touch ADR-01's "no re-serialization" guarantee for real client traffic.
    static func shadowCall(operation: String, params: Any?, backendSocketPath: String) throws -> Any? {
        let backendFD = try connectBackend(backendSocketPath)
        defer { close(backendFD) }

        var envelope: [String: Any] = [
            "apiVersion": Wire.apiVersion,
            "requestId": "dual-run-\(UUID().uuidString)",
        ]
        if let params { envelope["params"] = params }
        let body = (try? JSONSerialization.data(withJSONObject: envelope)) ?? Data("{}".utf8)

        // Mirrors src/client/transport.ts's own header set (incl. the Host
        // sentinel some HTTP stacks want even over a unix socket) so the
        // backend's parser sees an identically-shaped request to a real client.
        var head = "POST \(Wire.apiRoutePrefix)\(operation) HTTP/1.1\r\n"
        head += "Host: spectra.local\r\n"
        head += "Content-Type: application/json\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        var request = Data(head.utf8)
        request.append(body)
        try writeAll(backendFD, request)

        var response = Data()
        var chunk = [UInt8](repeating: 0, count: 32 * 1024)
        while true {
            let n = read(backendFD, &chunk, chunk.count)
            if n <= 0 {
                if n < 0 && errno == EINTR { continue }
                break
            }
            response.append(contentsOf: chunk[0..<n])
            if response.count > Wire.maxBodyBytes { break }
        }
        guard let sep = rangeOf(Data("\r\n\r\n".utf8), in: response) else {
            throw ProxyError.backendUnreachable("dual-run shadow call: malformed HTTP response for \(operation)")
        }
        let jsonBody = response.subdata(in: sep.upperBound..<response.count)
        guard
            let top = try? JSONSerialization.jsonObject(with: jsonBody, options: [.fragmentsAllowed]),
            let obj = top as? [String: Any]
        else {
            throw ProxyError.backendUnreachable("dual-run shadow call: non-JSON response for \(operation)")
        }
        return obj["result"]
    }

    private static func rangeOf(_ needle: Data, in haystack: Data) -> Range<Int>? {
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

// ─── shape hashing + diff for dual-run divergence (D-02) ─────────────────────
// A "shape" ignores leaf values and volatile fields, capturing only the JSON
// structure (key sets, nesting, element type) — log-only, never a correctness
// gate. Deterministic across runs so equal shapes hash equal.

enum ShapeDiff {
    /// FNV-1a 64-bit, hex-encoded. No cryptographic requirement here — this is
    /// an observability signal (divergence detection), not a security boundary.
    private static func fnv1aHex(_ s: String) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        let prime: UInt64 = 0x0000_0100_0000_01B3
        for byte in s.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* prime
        }
        return String(format: "%016llx", hash)
    }

    /// Canonical, order-independent shape string: objects render as
    /// `{sortedKey:shape,...}`, arrays as `[elementShape]` (first element only —
    /// window/session lists are homogeneous), leaves as their JSON type name.
    static func shapeString(_ value: Any?) -> String {
        guard let value, !(value is NSNull) else { return "null" }
        switch value {
        case let dict as [String: Any]:
            let parts = dict.keys.sorted().map { "\($0):\(shapeString(dict[$0]!))" }
            return "{\(parts.joined(separator: ","))}"
        case let arr as [Any]:
            guard let first = arr.first else { return "[]" }
            return "[\(shapeString(first))]"
        case is NSNumber:
            return "number"
        case is String:
            return "string"
        default:
            return "unknown"
        }
    }

    static func hash(_ value: Any?) -> String { fnv1aHex(shapeString(value)) }

    /// Dot-path diff between two values' shapes; returns the sorted list of
    /// paths whose shape differs (key added/removed, or leaf type changed).
    static func divergentPaths(ts: Any?, swift: Any?, prefix: String = "$") -> [String] {
        var out: [String] = []
        switch (ts, swift) {
        case (let a as [String: Any], let b as [String: Any]):
            let keys = Set(a.keys).union(b.keys)
            for key in keys.sorted() {
                let path = "\(prefix).\(key)"
                guard let av = a[key], let bv = b[key] else {
                    out.append(path)
                    continue
                }
                out.append(contentsOf: divergentPaths(ts: av, swift: bv, prefix: path))
            }
        case (let a as [Any], let b as [Any]):
            if let af = a.first, let bf = b.first {
                out.append(contentsOf: divergentPaths(ts: af, swift: bf, prefix: "\(prefix)[]"))
            } else if a.isEmpty != b.isEmpty {
                out.append(prefix)
            }
        default:
            if shapeString(ts) != shapeString(swift) { out.append(prefix) }
        }
        return out.sorted()
    }
}

/// Appends D-02 JSONL rows to ~/.spectra/logs/dual-run.jsonl. Log-only, never
/// affects the response served to the real client; failures to write are
/// swallowed (best-effort observability, not a correctness path).
final class DualRunRecorder: @unchecked Sendable {
    private let logPath: String
    private let queue = DispatchQueue(label: "spectra.daemon.dualrun")

    init(logPath: String) { self.logPath = logPath }

    func record(op: String, tsResult: Any?, swiftResult: Any?) {
        let tsHash = ShapeDiff.hash(tsResult)
        let swiftHash = ShapeDiff.hash(swiftResult)
        let divergent = tsHash == swiftHash ? [] : ShapeDiff.divergentPaths(ts: tsResult, swift: swiftResult)
        let row: [String: Any] = [
            "ts": JSON.nowMillis(),
            "op": op,
            "tsShapeHash": tsHash,
            "swiftShapeHash": swiftHash,
            "divergentPaths": divergent,
        ]
        queue.async { [logPath] in
            guard let data = try? JSONSerialization.data(withJSONObject: row) else { return }
            let dir = (logPath as NSString).deletingLastPathComponent
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            var line = data
            line.append(contentsOf: [0x0A])  // \n
            if let handle = FileHandle(forWritingAtPath: logPath) {
                handle.seekToEndOfFile()
                handle.write(line)
                try? handle.close()
            } else {
                FileManager.default.createFile(atPath: logPath, contents: line)
            }
        }
    }
}
