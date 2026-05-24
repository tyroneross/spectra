// DaemonClient.swift
//
// URLSession-backed HTTP client for the Spectra daemon.
//
// Captures `mcp-session-id` response header on `initialize` and echoes it on
// every subsequent request (the MCP SDK's StreamableHTTPServerTransport in
// stateful mode rejects requests without it — verified during C1 smoke).
//
// Auth: bearer token read from ~/.spectra/daemon.token at construction time.
// Bind: only ever talks to 127.0.0.1.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

public enum DaemonError: Error, LocalizedError {
    case daemonUnreachable(String)
    case unauthorized
    case versionSkew(apiVersion: Int, expected: Int)
    case malformedResponse(String)
    case protocolError(String)
    case tokenMissing(path: String)
    case http(status: Int, body: String)

    public var errorDescription: String? {
        switch self {
        case .daemonUnreachable(let reason): return "Daemon not reachable: \(reason)"
        case .unauthorized: return "Daemon rejected bearer token (401)."
        case .versionSkew(let api, let expected):
            return "Daemon API version \(api) does not match app expectation \(expected)."
        case .malformedResponse(let detail): return "Malformed daemon response: \(detail)"
        case .protocolError(let detail): return "MCP protocol error: \(detail)"
        case .tokenMissing(let path):
            return "Daemon token file missing at \(path). Is the daemon running?"
        case .http(let status, let body):
            return "HTTP \(status): \(body.prefix(200))"
        }
    }
}

public struct VersionInfo: Codable, Equatable, Sendable {
    public let apiVersion: Int
    public let daemonVersion: String
}

/// Bearer-token-backed HTTP client. Thread-safe under typical SwiftUI usage
/// because URLSession is itself thread-safe and we serialize state mutation
/// (mcpSessionId, lastInitializeId) through an actor.
public actor DaemonClient {
    public static let expectedApiVersion = 1
    public static let defaultPort: Int = 47823
    public static let defaultHost: String = "127.0.0.1"

    // ─── Configuration ───────────────────────────────────────
    private let host: String
    private let port: Int
    private let session: URLSession
    private let tokenPath: URL
    private var cachedToken: String?
    private var mcpSessionId: String?
    private var requestSeq: Int = 0

    public init(
        host: String = DaemonClient.defaultHost,
        port: Int = DaemonClient.defaultPort,
        tokenPath: URL = URL(fileURLWithPath: NSString(string: "~/.spectra/daemon.token").expandingTildeInPath),
        session: URLSession? = nil
    ) {
        self.host = host
        self.port = port
        self.tokenPath = tokenPath

        if let custom = session {
            self.session = custom
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 30
            config.timeoutIntervalForResource = 120
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
    }

    // ─── Public entry points ─────────────────────────────────

    /// Probe the daemon with a short-timeout `GET /api/version`. Returns
    /// version info on success; throws `DaemonError.daemonUnreachable` otherwise.
    public func probeVersion(timeout: TimeInterval = 0.2) async throws -> VersionInfo {
        let url = baseURL.appendingPathComponent("api/version")
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        req.httpMethod = "GET"

        do {
            let (data, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse else {
                throw DaemonError.malformedResponse("not an HTTPURLResponse")
            }
            guard http.statusCode == 200 else {
                throw DaemonError.http(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
            }
            let info = try JSONDecoder().decode(VersionInfo.self, from: data)
            return info
        } catch let urlErr as URLError {
            throw DaemonError.daemonUnreachable(urlErr.localizedDescription)
        }
    }

    /// Ensures the MCP transport is initialized. Captures the
    /// `mcp-session-id` response header for re-use on subsequent calls.
    /// Safe to call multiple times — subsequent calls are no-ops if the
    /// session-id is already cached.
    public func ensureInitialized() async throws {
        if mcpSessionId != nil { return }

        let body: [String: Any] = [
            "jsonrpc": "2.0",
            "id": nextRequestId(),
            "method": "initialize",
            "params": [
                "protocolVersion": "2025-06-18",
                "capabilities": [:],
                "clientInfo": [
                    "name": "Spectra.app",
                    "version": "0.3.0",
                ],
            ],
        ]

        let (_, headers, _) = try await rawMcpCall(jsonObject: body, captureSessionIdFromResponse: true)

        // Server may return mcp-session-id with either casing.
        if let sid = headers["mcp-session-id"] ?? headers["Mcp-Session-Id"] {
            mcpSessionId = sid
        } else {
            // Stateless mode: no session id needed. Still works; cache empty.
            mcpSessionId = ""
        }

        // Required by MCP spec after initialize completes.
        let notify: [String: Any] = [
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        ]
        _ = try await rawMcpCall(jsonObject: notify, captureSessionIdFromResponse: false)
    }

    /// Generic MCP tools/call wrapper. Decodes the result envelope and returns
    /// the parsed content (first text block).
    public func callTool(name: String, arguments: [String: Any]) async throws -> Data {
        try await ensureInitialized()

        let body: [String: Any] = [
            "jsonrpc": "2.0",
            "id": nextRequestId(),
            "method": "tools/call",
            "params": [
                "name": name,
                "arguments": arguments,
            ],
        ]

        let (data, _, _) = try await rawMcpCall(jsonObject: body, captureSessionIdFromResponse: false)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DaemonError.malformedResponse("not a JSON object")
        }
        if let err = json["error"] as? [String: Any] {
            let msg = (err["message"] as? String) ?? "unknown JSON-RPC error"
            throw DaemonError.protocolError(msg)
        }
        guard
            let result = json["result"] as? [String: Any],
            let content = result["content"] as? [[String: Any]],
            let first = content.first,
            let text = first["text"] as? String,
            let textData = text.data(using: .utf8)
        else {
            throw DaemonError.malformedResponse("tools/call response missing content[0].text")
        }
        return textData
    }

    /// Reset cached MCP session id (e.g. after daemon restart / network blip).
    public func resetSession() {
        mcpSessionId = nil
    }

    // ─── Internals ───────────────────────────────────────────

    private var baseURL: URL {
        URL(string: "http://\(host):\(port)")!
    }

    private func nextRequestId() -> Int {
        requestSeq += 1
        return requestSeq
    }

    private func loadToken() throws -> String {
        if let cached = cachedToken { return cached }
        do {
            let raw = try String(contentsOf: tokenPath, encoding: .utf8)
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                throw DaemonError.tokenMissing(path: tokenPath.path)
            }
            cachedToken = trimmed
            return trimmed
        } catch is DaemonError {
            throw DaemonError.tokenMissing(path: tokenPath.path)
        } catch {
            throw DaemonError.tokenMissing(path: tokenPath.path)
        }
    }

    /// Returns (body, lowercased-headers, statusCode).
    private func rawMcpCall(
        jsonObject: [String: Any],
        captureSessionIdFromResponse: Bool
    ) async throws -> (Data, [String: String], Int) {
        let token = try loadToken()
        let url = baseURL.appendingPathComponent("mcp")

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 60
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Streamable HTTP accepts JSON or SSE. Ask for JSON; we don't stream yet.
        req.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        if let sid = mcpSessionId, !sid.isEmpty {
            req.setValue(sid, forHTTPHeaderField: "Mcp-Session-Id")
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: jsonObject)

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw DaemonError.malformedResponse("not an HTTPURLResponse")
        }

        // Lowercase header keys for case-insensitive lookup.
        var headers: [String: String] = [:]
        for (k, v) in http.allHeaderFields {
            if let ks = k as? String, let vs = v as? String {
                headers[ks.lowercased()] = vs
            }
        }

        if http.statusCode == 401 || http.statusCode == 403 {
            throw DaemonError.unauthorized
        }
        if http.statusCode == 202 {
            // notifications/initialized returns 202 with empty body — OK.
            return (Data(), headers, 202)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw DaemonError.http(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }

        // Streamable HTTP can return text/event-stream framing even for a
        // single response. Extract the first JSON payload either way.
        let contentType = headers["content-type"] ?? ""
        let parsedBody: Data
        if contentType.contains("text/event-stream") {
            parsedBody = Self.extractFirstSseJson(data: data) ?? data
        } else {
            parsedBody = data
        }

        if captureSessionIdFromResponse {
            // already captured by caller via headers
        }
        return (parsedBody, headers, http.statusCode)
    }

    /// SSE event-stream frames look like:
    ///   event: message
    ///   data: {"jsonrpc":"2.0",...}
    ///   <blank line>
    /// Returns the first `data:` payload as raw bytes, or nil if not found.
    ///
    /// Note: Swift treats "\r\n" as a single Character grapheme, so split on
    /// the underlying Unicode scalars instead of Character predicates.
    static func extractFirstSseJson(data: Data) -> Data? {
        guard let text = String(data: data, encoding: .utf8) else { return nil }
        // Normalize CRLF/CR to LF, then split on LF.
        let normalized = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        for line in normalized.split(separator: "\n", omittingEmptySubsequences: false) {
            let s = line.trimmingCharacters(in: .whitespaces)
            if s.hasPrefix("data:") {
                let payload = s.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
                return payload.data(using: .utf8)
            }
        }
        return nil
    }
}
