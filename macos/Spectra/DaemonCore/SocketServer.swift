// macos/Spectra/DaemonCore/SocketServer.swift
//
// M3.G1 — the unix-socket front door. A POSIX AF_UNIX/SOCK_STREAM listener
// (mode 0600, peer-credential auth by construction — single-user, no token/TCP),
// hand-rolled HTTP/1.1 framing (single request per connection, Connection: close),
// routing `POST /api/v1/<op>` to the HandlerRegistry. Mirrors src/daemon/server.ts's
// request lifecycle: envelope decode → (capability check) → param dispatch →
// success/error envelope. The M2B oracle's socket client sends the exact framing
// this parses, so wire drift is caught by conformance.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

final class SocketServer: @unchecked Sendable {
    private let registry: HandlerRegistry
    private let context: DaemonContext
    private var listenFD: Int32 = -1
    private let acceptQueue = DispatchQueue(label: "spectra.daemon.accept")
    private let connQueue = DispatchQueue(label: "spectra.daemon.conn", attributes: .concurrent)

    init(registry: HandlerRegistry, context: DaemonContext) {
        self.registry = registry
        self.context = context
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
        guard let (method, path, body) = readRequest(fd) else {
            writeError(fd, requestId: nil, error: DaemonApiError(.badRequest, "Malformed HTTP request", status: 400))
            return
        }
        // Route: POST /api/v1/<op>
        guard method == "POST" else {
            writeError(fd, requestId: nil, error: DaemonApiError(.badRequest, "CoreApi operations require POST", status: 405))
            return
        }
        guard path.hasPrefix(Wire.apiRoutePrefix) else {
            writeError(fd, requestId: nil, error: DaemonApiError(.notFound, "Unknown route \(path)", status: 404))
            return
        }
        let operation = String(path.dropFirst(Wire.apiRoutePrefix.count))

        var requestId: String?
        do {
            let (rid, params) = try JSON.decodeEnvelope(body)
            requestId = rid
            guard let entry = registry.entry(for: operation) else {
                // Unregistered here = not part of this milestone's Swift surface;
                // the routing table keeps it on the TS daemon. Over a direct probe
                // it's not_found.
                throw DaemonApiError(.notFound, "Operation \(operation) not served by this daemon", status: 404)
            }
            // Capability check: the unix socket is single-user (mode 0600), peer
            // credentials grant ALL capabilities — same default as the TS daemon's
            // unix caller. (Restricted-capability probes come with the security
            // group; the default grant is correct for the oracle's G1 run.)
            let result = try entry.handler(params, context)
            writeSuccess(fd, requestId: requestId, result: result)
        } catch let e as DaemonApiError {
            writeError(fd, requestId: requestId, error: e)
        } catch {
            writeError(fd, requestId: requestId, error: DaemonApiError(.internalError, "\(error)", status: 500))
        }
    }

    // ─── HTTP framing ────────────────────────────────────────────────────────
    /// Read a full HTTP/1.1 request: headers until CRLFCRLF, then Content-Length
    /// bytes of body. Returns (method, path, body) or nil on malformed input.
    private func readRequest(_ fd: Int32) -> (String, String, Data)? {
        var buffer = Data()
        let sep = Data("\r\n\r\n".utf8)
        var headerEnd: Int? = nil
        var chunk = [UInt8](repeating: 0, count: 16 * 1024)
        // Read until we have the header terminator.
        while headerEnd == nil {
            let n = read(fd, &chunk, chunk.count)
            if n <= 0 { return nil }
            buffer.append(contentsOf: chunk[0..<n])
            if buffer.count > Wire.maxBodyBytes { return nil }
            headerEnd = range(of: sep, in: buffer)?.lowerBound
        }
        guard let hEnd = headerEnd else { return nil }
        let headerData = buffer.subdata(in: 0..<hEnd)
        guard let headerStr = String(data: headerData, encoding: .utf8) else { return nil }
        let lines = headerStr.split(separator: "\r\n", omittingEmptySubsequences: false).map(String.init)
        guard let requestLine = lines.first else { return nil }
        let parts = requestLine.split(separator: " ").map(String.init)
        guard parts.count >= 2 else { return nil }
        let method = parts[0]
        let path = parts[1]

        var contentLength = 0
        for line in lines.dropFirst() {
            let lower = line.lowercased()
            if lower.hasPrefix("content-length:") {
                contentLength = Int(line.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        // Body = bytes after the separator; read more if needed to reach contentLength.
        let bodyStart = hEnd + sep.count
        var body = buffer.count > bodyStart ? buffer.subdata(in: bodyStart..<buffer.count) : Data()
        while body.count < contentLength {
            let n = read(fd, &chunk, chunk.count)
            if n <= 0 { break }
            body.append(contentsOf: chunk[0..<n])
            if body.count > Wire.maxBodyBytes { return nil }
        }
        if contentLength > 0 && body.count > contentLength {
            body = body.subdata(in: 0..<contentLength)
        }
        return (method, path, body)
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
        case 404: return "Not Found"; case 405: return "Method Not Allowed"; case 500: return "Internal Server Error"
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
