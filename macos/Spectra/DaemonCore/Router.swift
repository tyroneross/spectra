// macos/Spectra/DaemonCore/Router.swift
//
// M3.G2 flip — the front-door routing table, v2 (ADR-04 rev-2, D-01/D-03).
// Decides, per operation, which of FOUR dispatch-plane buckets a request
// falls into — native / affinity / merge / fanout — with everything unlisted
// treated as `.proxy` (byte-tunneled to the TS backend, ADR-01, unchanged).
//
// STORE-PRESENCE (ADR-04 rev-2 addendum, PC-1): there is NO separate ownership
// map. For session-scoped affinity ops the routing signal is a lookup in
// Swift's own SessionStore (`ctx.sessions.contains(sessionId)`,
// SessionPresenceQuerying — DriverProtocol.swift §4 addendum #1); for
// `getRecording` it's `ctx.recordingOwnership?.ownsRecording(recordingId)`
// (DriverProtocol.swift §6b). A store hit routes native; a miss (or an
// absent/malformed key) routes proxy — fail-safe, never a crash, never a
// silent wrong answer (the TS backend answers `not_found` for a truly-unknown
// id, byte-transparent to the caller either way).
//
// CRITICAL (T-02b/T-23, the split-brain guard — carried over from v1):
// a session-coupled op present in plain `native:[]` would silently serve
// wrong-but-well-formed answers from Swift's own (empty/divergent)
// SessionStore. The loader below REFUSES TO BOOT the moment such a config is
// seen, for BOTH v1 and v2 configs — this is non-negotiable (T-03/T-23 prove
// it actually gates dispatch, not just config parsing). v2 adds three more
// boot-refusing invariants (list overlap, unregistered affinity/merge/fanout
// op, unsupported version) — see RoutingConfigError below.
//
// v1 configs (`{"version":1,"native":[...]}`) stay valid VERBATIM — the
// rollback target (T-28, <2 min drill): `bucket(for:)` degrades automatically
// to the v1 native/proxy split when affinityOps/mergeOps/fanoutOps are all
// empty (which a v1-loaded Router always has).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

/// Final native-vs-tunnel decision for a single request, AFTER any
/// store-presence resolution has already happened (for affinity ops) or
/// trivially (for plain native/proxy ops).
enum RouteDecision {
    case native
    case proxy
}

/// D-03 v2 dispatch-plane classification — SocketServer's actual switch key.
/// `.native`/`.proxy` keep v1's parse-free byte-tunnel fast path completely
/// unchanged; `.affinity`/`.merge`/`.fanout` are the G2 dispatch-plane
/// consequences SocketServer implements (dispatch-plane consequences (a)-(f),
/// m3-g2-plan.handoff.md §S6 / m3-g2-plan.md §Routing).
enum RouteBucket {
    case native
    case affinity
    case merge
    case fanout
    case proxy
}

/// Fail-closed routing-config errors. Every case here MUST cause the daemon to
/// refuse to boot (nonzero exit, clear stderr) — see main.swift.
enum RoutingConfigError: Error, CustomStringConvertible {
    case unreadable(path: String, underlying: String)
    case malformedJSON(path: String, detail: String)
    case unsupportedVersion(path: String, version: Int)
    case sessionOpsInNative(path: String, offending: [String])
    case listOverlap(path: String, offending: [String])
    case unregisteredAffinityOp(path: String, offending: [String])

    var description: String {
        switch self {
        case .unreadable(let path, let underlying):
            return "routing config \(path) could not be read: \(underlying)"
        case .malformedJSON(let path, let detail):
            return "routing config \(path) is malformed: \(detail)"
        case .unsupportedVersion(let path, let version):
            return "routing config \(path) has unsupported version \(version) (only version 1 or 2 is recognized)"
        case .sessionOpsInNative(let path, let offending):
            return """
            routing config \(path) lists session-coupled op(s) \(offending.joined(separator: ", ")) in \
            native:[] — REFUSING TO BOOT. Sessions/live driver handles must be routed via store-presence \
            affinity (v2's `affinity`/`merge`/`fanout` buckets) — a session-scoped op served directly out \
            of native:[] risks split-brain, wrong-but-well-formed answers from a divergent Swift store.
            """
        case .listOverlap(let path, let offending):
            return """
            routing config \(path) lists op(s) \(offending.joined(separator: ", ")) in MORE THAN ONE of \
            native/affinity/merge/fanout — REFUSING TO BOOT. Each op must resolve to exactly one \
            dispatch-plane bucket (D-03 v2 invariant).
            """
        case .unregisteredAffinityOp(let path, let offending):
            return """
            routing config \(path) lists op(s) \(offending.joined(separator: ", ")) in affinity/merge/fanout \
            with NO handler registered in HandlerRegistry — REFUSING TO BOOT. An affinity/merge/fanout op \
            with no registered native handler can never actually serve a store hit; that is a config/wiring \
            bug, not a runtime condition to degrade gracefully around.
            """
        }
    }
}

/// The front-door routing table. Immutable once loaded; one instance lives for
/// the daemon process lifetime.
final class Router: @unchecked Sendable {
    /// The 6 ops whose correctness depends on a live, in-process session
    /// store (this daemon's OR the TS backend's — never a divergent copy).
    /// D-01/D-03 fail-close these out of plain `native:[]` unconditionally —
    /// see RoutingConfigError.sessionOpsInNative. Under v2 these ops live in
    /// `affinity` (getSession/getRun/closeSession/recordLlmUsage), `merge`
    /// (listSessions), or `fanout` (closeAllSessions) instead.
    static let sessionCoupledOps: Set<String> = [
        "listSessions", "getSession", "getRun", "closeSession", "closeAllSessions", "recordLlmUsage",
    ]

    /// Advisor ruling (m3-g2-vb-advisor-ruling.md, Item 6/fix-work-list 2a):
    /// the FULL v2 session/recording-scoped invariant canon — the D-03
    /// affinity bucket's 17 ops (`createSession` routed by target, the 14
    /// session-store-presence ops, and `getRecording` routed by
    /// recording-registry presence) UNION `merge`'s `listSessions` UNION
    /// `fanout`'s `closeAllSessions` (19 ops total). This supersedes
    /// `sessionCoupledOps` (the G1-era 6-op denylist) for VERSION-2 CONFIGS
    /// ONLY — v1 configs keep using `sessionCoupledOps` verbatim (byte-
    /// unchanged G1 regression floor, T-28 rollback target). Under v2,
    /// EVERY one of these ops has a real store/registry it must be routed
    /// through (affinity/merge/fanout); none of them may ever legitimately
    /// sit in plain `native:[]` — a v2 config that puts one there risks the
    /// exact split-brain `sessionOpsInNative` exists to prevent, just as
    /// surely as the original G1 six did.
    static let sessionScopedCanonV2: Set<String> = [
        // affinity — createSession (target-routed)
        "createSession",
        // affinity — SessionStore-presence-routed (session-scoped ops)
        "snapshot", "observe", "act", "step", "llmStep", "walkthrough",
        "screenshot", "analyze", "discover", "startRecording", "stopRecording",
        "getSession", "getRun", "closeSession", "recordLlmUsage",
        // affinity — recording-registry-presence-routed
        "getRecording",
        // merge
        "listSessions",
        // fanout
        "closeAllSessions",
    ]

    /// Compiled-in production default (§Routing table at the G1 flip): the 5
    /// session-independent G1 ops. Used whenever SPECTRA_ROUTING_CONFIG is
    /// absent/empty. Deliberately UNCHANGED for G2 — this is the rollback
    /// target (T-28): the production routing config the launchd plist points
    /// at is what actually carries the v2 buckets; the compiled-in fallback
    /// stays byte-identical to G1 so a config-file removal is always a safe,
    /// <2-minute revert to G1 behavior, never a silent widen.
    static let defaultNativeOps: Set<String> = [
        "health", "getPermissions", "requestPermissions", "listWindows", "library",
    ]

    /// Dual-run (D-02) applies only to native READ ops with NO side effect —
    /// never requestPermissions (TCC prompt side effect) or library (writes).
    /// G2 widening: `replayTerminal` is a pure filesystem read (parses a
    /// fixture `.cast`, no PTY/child spawn — that's `recordTerminal`, which is
    /// correctly excluded) — the one G2 native-bucket addition that fits the
    /// existing no-side-effect contract. `computerUse` is excluded: it can
    /// perform a real AX action, not just read.
    static let dualRunEligibleOps: Set<String> = ["health", "getPermissions", "listWindows", "replayTerminal"]

    let nativeOps: Set<String>
    let affinityOps: Set<String>
    let mergeOps: Set<String>
    let fanoutOps: Set<String>
    let version: Int
    let configSource: String

    init(
        nativeOps: Set<String>,
        affinityOps: Set<String> = [],
        mergeOps: Set<String> = [],
        fanoutOps: Set<String> = [],
        version: Int,
        configSource: String
    ) {
        self.nativeOps = nativeOps
        self.affinityOps = affinityOps
        self.mergeOps = mergeOps
        self.fanoutOps = fanoutOps
        self.version = version
        self.configSource = configSource
    }

    /// v1-shape convenience: native-or-proxy only. Retained for anything that
    /// only cares about the binary split; G2 dispatch code should prefer
    /// `bucket(for:)`, which is affinity/merge/fanout-aware.
    func route(for operation: String) -> RouteDecision {
        nativeOps.contains(operation) ? .native : .proxy
    }

    /// D-03 v2 dispatch-plane classification — SocketServer's real switch key
    /// (dispatch-plane consequence (b)). For a v1-loaded Router,
    /// affinityOps/mergeOps/fanoutOps are always empty, so this degrades
    /// automatically to the v1 native/proxy split — no separate code path
    /// needed for v1 vs v2 at the call site.
    func bucket(for operation: String) -> RouteBucket {
        if nativeOps.contains(operation) { return .native }
        if affinityOps.contains(operation) { return .affinity }
        if mergeOps.contains(operation) { return .merge }
        if fanoutOps.contains(operation) { return .fanout }
        return .proxy
    }

    func isDualRunEligible(_ operation: String) -> Bool {
        Router.dualRunEligibleOps.contains(operation) && nativeOps.contains(operation)
    }

    // ─── store-presence affinity resolution (ADR-04 rev-2, D-02) ────────────

    /// Resolves an AFFINITY-bucket op to a concrete native/proxy decision via
    /// store-presence. CALLERS MUST DECODE THE REQUEST ENVELOPE FIRST
    /// (SocketServer dispatch-plane consequence (a)) — this takes
    /// already-parsed params and never touches raw bytes.
    ///
    /// Advisor ruling (Item 4/fix-work-list 2b): THROWS `DaemonApiError`
    /// (`.badRequest`) the instant the identity key THIS ROUTING DECISION
    /// depends on is absent/empty/non-string (`target` for createSession,
    /// `recordingId` for getRecording, `sessionId` for every other affinity
    /// op) — mirroring TS's fda8626 ordering (capability check first, THEN
    /// this bad_request; SocketServer.dispatchAffinity runs the capability
    /// assert BEFORE calling this method). A missing required routing
    /// identity is a decode failure of the AFFINITY ENVELOPE itself (SG-1a),
    /// never a silent store-miss/tunnel — this is correct in BOTH topologies:
    /// with a backend, TS would itself answer bad_request for the same
    /// malformed payload, so parity holds either way. Once the identity key
    /// is present and well-formed, behavior is unchanged from before: a
    /// store/registry MISS still resolves `.proxy` (fail-safe — full param
    /// validation beyond this routing-relevant key stays the handler's job on
    /// the native leg, F-18).
    func resolveAffinity(operation: String, params: [String: Any], ctx: DaemonContext) throws -> RouteDecision {
        switch operation {
        case "createSession":
            // Routed by TARGET, not store-presence — the session doesn't
            // exist in any store yet at createSession time (D-03 §affinity
            // bucket table: "createSession (by TARGET: macos/`fake:`→native,
            // web/sim→tunnel)").
            guard let target = params["target"] as? String, !target.isEmpty else {
                throw DaemonApiError(.badRequest, "createSession requires a non-empty string 'target'", status: 400)
            }
            return Router.isNativeCreateTarget(target) ? .native : .proxy

        case "getRecording":
            guard let recordingId = params["recordingId"] as? String, !recordingId.isEmpty else {
                throw DaemonApiError(.badRequest, "getRecording requires a non-empty string 'recordingId'", status: 400)
            }
            // Fail-closed default (DriverProtocol.swift §6b, verbatim): a nil
            // recordingOwnership (a wiring-order bug — main.swift assigns it
            // before server.start) resolves to `false`/tunnel here, NEVER a
            // force-unwrap or crash on the dispatch path.
            return (ctx.recordingOwnership?.ownsRecording(recordingId) ?? false) ? .native : .proxy

        default:
            // Every other affinity op is session-scoped: getSession, getRun,
            // closeSession, recordLlmUsage, snapshot, act, step, llmStep,
            // walkthrough, screenshot, analyze, discover, startRecording,
            // stopRecording (D-03 §affinity bucket table).
            guard let sessionId = params["sessionId"] as? String, !sessionId.isEmpty else {
                throw DaemonApiError(.badRequest, "\(operation) requires a non-empty string 'sessionId'", status: 400)
            }
            return ctx.sessions.contains(sessionId) ? .native : .proxy
        }
    }

    /// Mirrors `src/mcp/context.ts` detectPlatform's driverType split, for the
    /// ROUTING decision only: macos appName (default case) and the ADR-06
    /// `fake:` conformance seam both route native; web (`http(s)://`) and
    /// `sim:` route proxy (ND-3 — SimBridge/CDP stay TS-owned this rev). The
    /// SPECTRA_CONFORMANCE_SEED gate that makes a `fake:` target actually
    /// SUCCEED is enforced inside S1's ConnectOps handler, not here — this
    /// function answers "does Swift serve this op", never "will it succeed".
    static func isNativeCreateTarget(_ target: String) -> Bool {
        if target.hasPrefix("http://") || target.hasPrefix("https://") { return false }
        if target.hasPrefix("sim:") { return false }
        return true
    }

    // ─── loader (fail-closed, v1 + v2) ───────────────────────────────────────

    /// On-disk schema: v1 `{ "version": 1, "native": ["op", ...] }`; v2 adds
    /// `affinity`/`merge`/`fanout` (D-03). All four op lists are optional on
    /// the wire (an absent list decodes to empty), so a v1 file (which never
    /// declares affinity/merge/fanout at all) decodes unchanged.
    private struct RoutingConfigFile: Decodable {
        let version: Int
        let native: [String]?
        let affinity: [String]?
        let merge: [String]?
        let fanout: [String]?
    }

    /// Load the routing config per §Env Contract: SPECTRA_ROUTING_CONFIG names
    /// a JSON file; absent/empty env → compiled-in production default (always
    /// v1-shaped, G1-identical). Throws a RoutingConfigError (never a silent
    /// fallback) on ANY of: unreadable file, malformed JSON, unrecognized
    /// shape, unsupported version, a session-coupled op in native:[], an
    /// op duplicated across buckets, or an affinity/merge/fanout op with no
    /// registered handler. Callers (main.swift) MUST treat every thrown error
    /// as fatal — refuse to boot.
    ///
    /// `registry` MUST already have every op registered (main.swift calls the
    /// 5 G1+G2 register hooks BEFORE loading the router) — the
    /// unregisteredAffinityOp invariant checks against it.
    static func loadConfig(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        registry: HandlerRegistry
    ) throws -> Router {
        guard let path = environment["SPECTRA_ROUTING_CONFIG"], !path.isEmpty else {
            // Compiled-in default. Self-check the invariant even here — a future
            // edit to defaultNativeOps that adds a session op must also fail
            // closed, not just config-file edits.
            let offending = sessionCoupledOps.intersection(defaultNativeOps)
            guard offending.isEmpty else {
                throw RoutingConfigError.sessionOpsInNative(path: "<compiled-in default>", offending: offending.sorted())
            }
            return Router(nativeOps: defaultNativeOps, version: 1, configSource: "<compiled-in default>")
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

        guard decoded.version == 1 || decoded.version == 2 else {
            throw RoutingConfigError.unsupportedVersion(path: path, version: decoded.version)
        }

        let nativeSet = Set(decoded.native ?? [])
        // affinity/merge/fanout are v2-only buckets — a v1 config that somehow
        // carried these keys anyway (a hand-edited file) is intentionally
        // ignored rather than partially honored, keeping v1's "one list only"
        // semantics exact for the rollback drill.
        let affinitySet: Set<String> = decoded.version == 2 ? Set(decoded.affinity ?? []) : []
        let mergeSet: Set<String> = decoded.version == 2 ? Set(decoded.merge ?? []) : []
        let fanoutSet: Set<String> = decoded.version == 2 ? Set(decoded.fanout ?? []) : []

        // Invariant: the SAME op appears in more than one bucket (v2 only —
        // a v1 config has exactly one list, so overlap is structurally
        // impossible there).
        if decoded.version == 2 {
            var seen: [String: Int] = [:]
            for op in nativeSet { seen[op, default: 0] += 1 }
            for op in affinitySet { seen[op, default: 0] += 1 }
            for op in mergeSet { seen[op, default: 0] += 1 }
            for op in fanoutSet { seen[op, default: 0] += 1 }
            let offending = seen.filter { $0.value > 1 }.map(\.key).sorted()
            guard offending.isEmpty else {
                throw RoutingConfigError.listOverlap(path: path, offending: offending)
            }
        }

        // Invariant: a session-coupled op present in plain native:[].
        // Advisor ruling (m3-g2-vb-advisor-ruling.md, Item 6/fix-work-list
        // 2a): the invariant SET and the standalone carve-out's SCOPE now
        // differ by config version:
        //   - v1: the ORIGINAL G1-six denylist (`sessionCoupledOps`), gated by
        //     the standalone-harness AND-flag carve-out (v1's own — preserved
        //     exactly for the G1-verify all-11-native topology / T-28 rollback
        //     drill: an all-native config is permitted ONLY when no proxy
        //     backend is configured AND the harness opts in explicitly). v1
        //     behavior here is BYTE-UNCHANGED (G1 regression floor).
        //   - v2: the FULL `sessionScopedCanonV2` (17 affinity ops + merge +
        //     fanout — 19 total), with NO carve-out at all — under v2, every
        //     one of those ops always resolves through affinity/merge/fanout
        //     store-presence routing; nothing legitimate ever puts a
        //     session/recording-scoped op in plain `native:[]`, so the
        //     standalone opt-in flag (which exists for the v1-shaped
        //     G1-verify topology only) does not apply here. T-23's "session-
        //     scoped op in plain native:[]" recipe REFUSES TO BOOT under v2
        //     regardless of SPECTRA_STANDALONE_SESSION_OPS/backend config.
        if decoded.version == 2 {
            let offending = sessionScopedCanonV2.intersection(nativeSet)
            guard offending.isEmpty else {
                throw RoutingConfigError.sessionOpsInNative(path: path, offending: offending.sorted())
            }
        } else {
            let hasProxyBackend = !((environment["SPECTRA_PROXY_BACKEND_SOCKET"] ?? "").isEmpty)
            let standaloneOptIn = environment["SPECTRA_STANDALONE_SESSION_OPS"] == "1"
            if hasProxyBackend || !standaloneOptIn {
                let offending = sessionCoupledOps.intersection(nativeSet)
                guard offending.isEmpty else {
                    throw RoutingConfigError.sessionOpsInNative(path: path, offending: offending.sorted())
                }
            }
        }

        // Invariant: an affinity/merge/fanout op with no registered handler
        // (v2 only — v1 never had these buckets to misconfigure). The native
        // bucket deliberately has NO equivalent boot-time check here — it
        // never has (SocketServer.dispatchNative's `registry.entry(for:)`
        // miss is a defensive runtime 404 fallback, unchanged from v1); an
        // affinity/merge/fanout op is different because a store-hit MUST
        // resolve to a real handler for store-presence routing to mean
        // anything at all.
        if decoded.version == 2 {
            let toCheck = affinitySet.union(mergeSet).union(fanoutSet)
            let offending = toCheck.filter { registry.entry(for: $0) == nil }.sorted()
            guard offending.isEmpty else {
                throw RoutingConfigError.unregisteredAffinityOp(path: path, offending: offending)
            }
        }

        return Router(
            nativeOps: nativeSet,
            affinityOps: affinitySet,
            mergeOps: mergeSet,
            fanoutOps: fanoutSet,
            version: decoded.version,
            configSource: path
        )
    }
}
