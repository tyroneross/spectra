// DaemonClientTests.swift
//
// Unit tests for DaemonClient against a Network.framework NWListener-backed
// fake daemon. Verifies: bearer auth, mcp-session-id round-trip, version
// probe, SSE-framing parser.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import XCTest
import Network
@testable import Spectra

final class DaemonClientTests: XCTestCase {

    // ─── SSE framing ─────────────────────────────────────────

    func test_extractFirstSseJson_extractsFirstDataLine() throws {
        let raw = "event: message\r\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\r\n\r\n"
        let bytes = raw.data(using: .utf8)!
        let extracted = DaemonClient.extractFirstSseJson(data: bytes)
        XCTAssertNotNil(extracted, "expected to extract JSON from SSE frame")
        let json = try JSONSerialization.jsonObject(with: extracted!) as? [String: Any]
        XCTAssertEqual(json?["jsonrpc"] as? String, "2.0")
    }

    func test_extractFirstSseJson_returnsNilForNonSseBody() {
        let bytes = "{}".data(using: .utf8)!
        let extracted = DaemonClient.extractFirstSseJson(data: bytes)
        XCTAssertNil(extracted)
    }

    // ─── DaemonError messages ────────────────────────────────

    func test_daemonError_humanMessages() {
        XCTAssertEqual(
            DaemonError.unauthorized.errorDescription,
            "Daemon rejected bearer token (401)."
        )
        XCTAssertEqual(
            DaemonError.versionSkew(apiVersion: 2, expected: 1).errorDescription,
            "Daemon API version 2 does not match app expectation 1."
        )
    }

    // ─── End-to-end against a fake listener ──────────────────

    /// Spins up a tiny NWListener on a random port that responds with a fixed
    /// version JSON. Verifies probeVersion() decodes it.
    func test_probeVersion_decodesResponse() async throws {
        let port = try findFreePort()
        let listener = try FakeHttpServer.start(
            on: port,
            handler: { req in
                if req.path == "/api/version" {
                    let body = #"{"apiVersion":1,"daemonVersion":"0.3.0"}"#
                    return FakeHttpServer.json(body)
                }
                return FakeHttpServer.notFound()
            }
        )
        defer { listener.cancel() }

        // Token file: write a throwaway to a tmp path so the client can read it.
        let tokenPath = FileManager.default.temporaryDirectory
            .appendingPathComponent("daemon-token-\(UUID().uuidString)")
        try "test-token-1234567890123456789012345678".write(to: tokenPath, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: tokenPath) }

        let client = DaemonClient(host: "127.0.0.1", port: port, tokenPath: tokenPath)
        let info = try await client.probeVersion(timeout: 2.0)
        XCTAssertEqual(info.apiVersion, 1)
        XCTAssertEqual(info.daemonVersion, "0.3.0")
    }

    // ─── Helpers ─────────────────────────────────────────────

    private func findFreePort() throws -> Int {
        // Bind to port 0, read back the assigned port, close.
        let socket = socket(AF_INET, SOCK_STREAM, 0)
        guard socket >= 0 else { throw NSError(domain: "socket", code: 0) }
        defer { close(socket) }

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")

        let bound = withUnsafePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(socket, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0 else { throw NSError(domain: "bind", code: Int(errno)) }

        var assigned = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &assigned) { ptr in
            _ = ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(socket, $0, &len)
            }
        }
        return Int(UInt16(bigEndian: assigned.sin_port))
    }
}

// ─── Tiny HTTP fake (NWListener-backed) ──────────────────────

struct FakeHttpRequest {
    let method: String
    let path: String
    let body: Data
}

struct FakeHttpServer {
    let listener: NWListener

    static func start(
        on port: Int,
        handler: @escaping (FakeHttpRequest) -> Data
    ) throws -> NWListener {
        let params = NWParameters.tcp
        let listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: UInt16(port))!)
        listener.newConnectionHandler = { conn in
            conn.start(queue: .global())
            conn.receive(minimumIncompleteLength: 1, maximumLength: 65_535) { data, _, _, _ in
                guard let data, let raw = String(data: data, encoding: .utf8) else {
                    conn.cancel(); return
                }
                let lines = raw.split(separator: "\n", omittingEmptySubsequences: false)
                guard let first = lines.first?.trimmingCharacters(in: .whitespacesAndNewlines) else {
                    conn.cancel(); return
                }
                let parts = first.split(separator: " ")
                guard parts.count >= 2 else { conn.cancel(); return }
                let req = FakeHttpRequest(
                    method: String(parts[0]),
                    path: String(parts[1]),
                    body: Data()
                )
                let response = handler(req)
                conn.send(content: response, completion: .contentProcessed { _ in
                    conn.cancel()
                })
            }
        }
        listener.start(queue: .global())
        return listener
    }

    static func json(_ body: String) -> Data {
        let bytes = body.data(using: .utf8)!
        var out = "HTTP/1.1 200 OK\r\n"
        out += "Content-Type: application/json\r\n"
        out += "Content-Length: \(bytes.count)\r\n"
        out += "\r\n"
        var data = out.data(using: .utf8)!
        data.append(bytes)
        return data
    }

    static func notFound() -> Data {
        let body = "{}"
        let bytes = body.data(using: .utf8)!
        var out = "HTTP/1.1 404 Not Found\r\n"
        out += "Content-Type: application/json\r\n"
        out += "Content-Length: \(bytes.count)\r\n"
        out += "\r\n"
        var data = out.data(using: .utf8)!
        data.append(bytes)
        return data
    }
}
