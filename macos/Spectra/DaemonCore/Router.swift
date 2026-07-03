// macos/Spectra/DaemonCore/Router.swift
//
// M3.G1 flip — the front-door routing table (ADR-02, D-01). Decides, per
// operation, whether a request is served natively by this daemon's
// HandlerRegistry or byte-tunneled to the TS backend daemon (ProxyClient).
//
// CRITICAL (T-02b, the split-brain guard): Swift already registers live,
// SessionStore-backed handlers for the 6 session-coupled ops (SessionOps.swift)
// even though they are NOT supposed to serve real traffic yet — sessions/live
// driver handles exist ONLY in the TS process (src/core/session.ts). A routing
// config that lists any of those 6 in `native:[]` would silently serve
// wrong-but-well-formed answers from Swift's own (empty/divergent) SessionStore.
// The loader below therefore REFUSES TO BOOT the moment such a config is seen —
// this is non-negotiable and is not a decorative check (T-03 proves it actually
// gates dispatch, not just config parsing).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

/// D-01 routing decision for a single operation.
enum RouteDecision {
    case native
    case proxy
}

/// Fail-closed routing-config errors. Every case here MUST cause the daemon to
/// refuse to boot (nonzero exit, clear stderr) — see main.swift.
enum RoutingConfigError: Error, CustomStringConvertible {
    case unreadable(path: String, underlying: String)
    case malformedJSON(path: String, detail: String)
    case unsupportedVersion(path: String, version: Int)
    case sessionOpsInNative(path: String, offending: [String])

    var description: String {
        switch self {
        case .unreadable(let path, let underlying):
            return "routing config \(path) could not be read: \(underlying)"
        case .malformedJSON(let path, let detail):
            return "routing config \(path) is malformed: \(detail)"
        case .unsupportedVersion(let path, let version):
            return "routing config \(path) has unsupported version \(version) (only version 1 is recognized)"
        case .sessionOpsInNative(let path, let offending):
            return """
            routing config \(path) lists session-coupled op(s) \(offending.joined(separator: ", ")) in \
            native:[] — REFUSING TO BOOT. Sessions/live driver handles exist only in the TS daemon \
            process; serving these natively under Swift's own SessionStore risks split-brain, \
            wrong-but-well-formed answers. Lifting this denylist is an explicit `version: 2` migration \
            shipped together with G2's createSession flip — never a one-line config edit.
            """
        }
    }
}

/// The front-door routing table. Immutable once loaded; one instance lives for
/// the daemon process lifetime.
final class Router: @unchecked Sendable {
    /// The 6 ops whose correctness depends on the TS daemon's in-memory
    /// SessionManager (src/core/session.ts:51). D-01 v1 fail-closes these out
    /// of native:[] unconditionally — see RoutingConfigError.sessionOpsInNative.
    static let sessionCoupledOps: Set<String> = [
        "listSessions", "getSession", "getRun", "closeSession", "closeAllSessions", "recordLlmUsage",
    ]

    /// Compiled-in production default (§Routing table at flip): the 5
    /// session-independent G1 ops. Used whenever SPECTRA_ROUTING_CONFIG is
    /// absent/empty.
    static let defaultNativeOps: Set<String> = [
        "health", "getPermissions", "requestPermissions", "listWindows", "library",
    ]

    /// Dual-run (D-02) applies only to these native READ ops — never
    /// requestPermissions (TCC prompt side effect) or library (writes).
    static let dualRunEligibleOps: Set<String> = ["health", "getPermissions", "listWindows"]

    let nativeOps: Set<String>
    let configSource: String

    init(nativeOps: Set<String>, configSource: String) {
        self.nativeOps = nativeOps
        self.configSource = configSource
    }

    func route(for operation: String) -> RouteDecision {
        nativeOps.contains(operation) ? .native : .proxy
    }

    func isDualRunEligible(_ operation: String) -> Bool {
        Router.dualRunEligibleOps.contains(operation) && nativeOps.contains(operation)
    }

    // ─── loader (fail-closed) ──────────────────────────────────────────────────

    /// On-disk schema (D-01): `{ "version": 1, "native": ["op", ...] }`.
    private struct RoutingConfigFile: Decodable {
        let version: Int
        let native: [String]
    }

    /// Load the routing config per §Env Contract: SPECTRA_ROUTING_CONFIG names a
    /// JSON file; absent/empty env → compiled-in production default. Throws a
    /// RoutingConfigError (never a silent fallback) on ANY of: unreadable file,
    /// malformed JSON, unrecognized shape, unsupported version, or a
    /// session-coupled op present in native:[]. Callers (main.swift) MUST treat
    /// every thrown error as fatal — refuse to boot.
    static func loadConfig(environment: [String: String] = ProcessInfo.processInfo.environment) throws -> Router {
        guard let path = environment["SPECTRA_ROUTING_CONFIG"], !path.isEmpty else {
            // Compiled-in default. Self-check the invariant even here — a future
            // edit to defaultNativeOps that adds a session op must also fail
            // closed, not just config-file edits.
            let offending = sessionCoupledOps.intersection(defaultNativeOps)
            guard offending.isEmpty else {
                throw RoutingConfigError.sessionOpsInNative(path: "<compiled-in default>", offending: offending.sorted())
            }
            return Router(nativeOps: defaultNativeOps, configSource: "<compiled-in default>")
        }

        let data: Data
        do {
            data = try Data(contentsOf: URL(fileURLWithPath: path))
        } catch {
            throw RoutingConfigError.unreadable(path: path, underlying: "\(error)")
        }

        let decoded: RoutingConfigFile
        do {
            decoded = try JSONDecoder().decode(RoutingConfigFile.self, from: data)
        } catch {
            throw RoutingConfigError.malformedJSON(path: path, detail: "\(error)")
        }

        guard decoded.version == 1 else {
            throw RoutingConfigError.unsupportedVersion(path: path, version: decoded.version)
        }

        let nativeSet = Set(decoded.native)
        // Fail-closed denylist. Session-coupled ops may be listed native ONLY in
        // the standalone G1-verify topology — where BOTH hold: no proxy backend
        // is configured AND the harness sets SPECTRA_STANDALONE_SESSION_OPS=1 (an
        // explicit, harness-only opt-in that must NEVER appear in a launchd plist).
        // In that topology the daemon serves every op from its own SessionStore
        // (verify-g1-suite.ts's all-11-native config), so there is no divergent
        // writer to split-brain against. In EVERY other case — a backend is
        // configured, OR the standalone flag is absent — the denylist is enforced.
        // The AND-flag closes the double-misconfig hole (Fable rev 3): an
        // all-11-native config accidentally deployed with the backend env dropped
        // from the plist would otherwise silently serve `listSessions: []` while
        // the real TS daemon still owns live sessions. Lifting for the backend
        // case remains a `version: 2` migration, never a silent runtime fallback.
        let hasProxyBackend = !((environment["SPECTRA_PROXY_BACKEND_SOCKET"] ?? "").isEmpty)
        let standaloneOptIn = environment["SPECTRA_STANDALONE_SESSION_OPS"] == "1"
        if hasProxyBackend || !standaloneOptIn {
            let offending = sessionCoupledOps.intersection(nativeSet)
            guard offending.isEmpty else {
                throw RoutingConfigError.sessionOpsInNative(path: path, offending: offending.sorted())
            }
        }

        return Router(nativeOps: nativeSet, configSource: path)
    }
}
