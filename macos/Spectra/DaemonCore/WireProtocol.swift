// macos/Spectra/DaemonCore/WireProtocol.swift
//
// M3.G1 — the frozen daemon wire contract, in Swift. Mirrors src/contract/wire.ts
// (apiVersion 2, unix socket ~/.spectra/daemon.sock mode 0600, POST /api/v1/<op>
// with an enveloped JSON body, JSON response envelope). The Swift daemon-core MUST
// be byte-compatible with this — the M2B conformance oracle verifies it over the
// real socket, so anything here that drifts from wire.ts is caught by the oracle.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

enum Wire {
    static let apiVersion = 2
    static let primarySocketRelativePath = ".spectra/daemon.sock"
    static let socketMode: mode_t = 0o600
    static let apiRoutePrefix = "/api/v1/"
    static let maxBodyBytes = 8 * 1024 * 1024
}

/// The wire error codes (src/contract/wire.ts ApiErrorCode). Universal codes apply
/// to every op; op-specific codes are declared per handler.
enum ApiErrorCode: String {
    case badRequest = "bad_request"
    case unsupportedApiVersion = "unsupported_api_version"
    case unauthorized
    case forbidden
    case capabilityDenied = "capability_denied"
    case daemonUnhealthy = "daemon_unhealthy"
    case internalError = "internal_error"
    case notFound = "not_found"
    case conflict
    case recordingFailed = "recording_failed"
    case permissionDenied = "permission_denied"
}

/// Capabilities (src/contract/wire.ts Capability). Single-user unix socket grants
/// all by default (peer-credential auth via mode 0600), matching the TS daemon.
/// CaseIterable (added for CapabilityPolicy.swift, M3.G1 flip S2) enumerates the
/// full vocabulary for the default all-grant set — purely additive, no case
/// renamed/retyped (P1 pin).
enum Capability: String, CaseIterable {
    case daemonRead = "daemon:read"
    case permissionsRead = "permissions:read"
    case permissionsRequest = "permissions:request"
    case windowsRead = "windows:read"
    case sessionsRead = "sessions:read"
    case sessionsWrite = "sessions:write"
    case uiRead = "ui:read"
    case uiAct = "ui:act"
    case analysisRead = "analysis:read"
    case discoverWrite = "discover:write"
    case mediaCapture = "media:capture"
    case mediaRecord = "media:record"
    case terminalRead = "terminal:read"
    case terminalRecord = "terminal:record"
    case libraryRead = "library:read"
    case libraryWrite = "library:write"
    case demoWrite = "demo:write"
}

/// A handler failure that maps to a wire error envelope (mirrors DaemonApiError).
struct DaemonApiError: Error {
    let code: ApiErrorCode
    let message: String
    let status: Int
    init(_ code: ApiErrorCode, _ message: String, status: Int = 400) {
        self.code = code
        self.message = message
        self.status = status
    }
}

// ─── JSON helpers (params in, result out are arbitrary JSON) ─────────────────

enum JSON {
    /// Decode a request body into an envelope: (requestId, params). params is the
    /// raw JSON value under "params" (nil if absent). apiVersion is validated.
    static func decodeEnvelope(_ body: Data) throws -> (requestId: String?, params: Any?) {
        let top: Any
        if body.isEmpty {
            top = [String: Any]()
        } else {
            do { top = try JSONSerialization.jsonObject(with: body, options: [.fragmentsAllowed]) }
            catch { throw DaemonApiError(.badRequest, "Malformed JSON request body", status: 400) }
        }
        guard let obj = top as? [String: Any] else {
            throw DaemonApiError(.badRequest, "Request envelope must be a JSON object", status: 400)
        }
        // apiVersion: REQUIRED and must equal 2 (mirrors server.ts validateEnvelope
        // → unsupported_api_version on anything !== 2, incl. absent or non-numeric).
        let rawVersion = obj["apiVersion"]
        let version = (rawVersion as? NSNumber)?.intValue ?? (rawVersion as? Int)
        guard let version, version == Wire.apiVersion else {
            throw DaemonApiError(
                .unsupportedApiVersion,
                "Daemon speaks apiVersion \(Wire.apiVersion), got \(rawVersion.map { "\($0)" } ?? "none")",
                status: 400
            )
        }
        // requestId: REQUIRED (server.ts rejects an envelope without it — bad_request).
        guard let requestId = obj["requestId"] as? String else {
            throw DaemonApiError(.badRequest, "Request envelope is missing required `requestId`", status: 400)
        }
        return (requestId, obj["params"])
    }

    /// Serialize a success envelope: {apiVersion, requestId, ok:true, result, timestamp}.
    static func successEnvelope(requestId: String?, result: Any) -> Data {
        var env: [String: Any] = [
            "apiVersion": Wire.apiVersion,
            "ok": true,
            "result": result,
            "timestamp": nowMillis(),
        ]
        if let requestId { env["requestId"] = requestId }
        return (try? JSONSerialization.data(withJSONObject: env)) ?? Data("{}".utf8)
    }

    /// Serialize an error envelope: {apiVersion, requestId?, ok:false, error:{code,message}, timestamp}.
    static func errorEnvelope(requestId: String?, error: DaemonApiError) -> Data {
        var env: [String: Any] = [
            "apiVersion": Wire.apiVersion,
            "ok": false,
            "error": ["code": error.code.rawValue, "message": error.message],
            "timestamp": nowMillis(),
        ]
        if let requestId { env["requestId"] = requestId }
        return (try? JSONSerialization.data(withJSONObject: env)) ?? Data("{}".utf8)
    }

    static func nowMillis() -> Int { Int(Date().timeIntervalSince1970 * 1000) }
}
