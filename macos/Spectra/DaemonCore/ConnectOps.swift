// macos/Spectra/DaemonCore/ConnectOps.swift
//
// M3.G2 (S1) — createSession: the sole Driver-construction seam per
// DriverProtocol.swift's doc comment (mirrors src/mcp/tools/connect.ts's
// single `new NativeDriver()`/`new CdpDriver()` call site, connect.ts:122 —
// every other handler resolves a driver ABSTRACTLY via
// `ctx.driverRegistry.get(sessionId)`, never constructs one).
//
// Target split (ADR-04, ND-3): this handler serves EXACTLY two target
// shapes natively —
//   - macos appName            -> NativeDriver via S2's frozen
//                                  `makeNativeDriver(appName:)` factory
//   - `fake:...` (seed-gated)  -> FakeDriver (FakeDriver.swift, this file's
//                                  sibling), ONLY when
//                                  SPECTRA_CONFORMANCE_SEED=1
// web (`http(s)://`) and `sim:` targets are NOT constructed here at all —
// S6's Router decides BEFORE dispatch that those targets tunnel to the TS
// backend (createSession is an affinity op keyed on TARGET, not
// sessionId — see DriverProtocol.swift's D-03 doc). If one somehow reaches
// this handler anyway (a routing-layer bug, not a client error), this
// handler fails loudly (500) rather than silently fabricating a driver it
// has no business owning.
//
// NO ownership bookkeeping here (ADR-04 rev 2): store-presence IS the
// routing signal for every later op against this session. The only
// obligation this handler has is that the session is inserted into
// SessionStore (via `ctx.sessions.create`) BEFORE the response is written.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

func registerConnectOps(_ registry: HandlerRegistry) {
    // Capabilities per src/contract/wire.ts: createSession: ['sessions:write', 'ui:read'].
    registry.register("createSession", capabilities: [.sessionsWrite, .uiRead]) { params, ctx in
        try handleCreateSession(params, ctx)
    }
}

// ─── Target classification (mirrors src/mcp/context.ts detectPlatform, plus
//     the G2-only `fake:` seed arm, which has no TS-side equivalent at all —
//     it is a Swift-only, seed-gated addition per ADR-06) ────────────────────

private enum ConnectTargetKind {
    case macos(appName: String)
    case fakeSeed(rawTarget: String)
    /// web (`http(s)://`) or `sim:` — S6's Router must tunnel these BEFORE
    /// this handler is ever invoked (ND-3). Reaching this handler with one
    /// of these is a routing-layer invariant violation, not a valid request
    /// this handler can serve.
    case tunnelOnly(String)
}

private func classifyTarget(_ target: String) -> ConnectTargetKind {
    if target.hasPrefix("http://") || target.hasPrefix("https://") {
        return .tunnelOnly(target)
    }
    if target.hasPrefix("sim:") {
        return .tunnelOnly(target)
    }
    if target.hasPrefix("fake:") {
        return .fakeSeed(rawTarget: target)
    }
    return .macos(appName: target)
}

// ─── Handler ────────────────────────────────────────────────────────────────

private func handleCreateSession(_ params: Any?, _ ctx: DaemonContext) throws -> Any {
    let dict = (params as? [String: Any]) ?? [:]
    guard let target = dict["target"] as? String, !target.isEmpty else {
        throw DaemonApiError(.badRequest, "target is required", status: 400)
    }
    let name = dict["name"] as? String
    let recordOnly = (dict["record"] as? Bool) == true
    // repoPath: accepted ONLY for storage-anchoring parity (connect.ts's
    // C2.6 comment — anchors storageRoot under the supplied repo so a
    // launchd-spawned daemon writes into `<repo>/.spectra/` instead of
    // `~/.spectra/`). This G2 slice does NOT port the launcher
    // (`launchRepo`/connect.ts:57-59) — no owner is assigned to that port in
    // the M3.G2 wave, so `repoPath` here never triggers an actual launch,
    // only affects WHERE the session directory lands. A `launched` result
    // field is therefore never populated by this handler (matches its
    // optional/absent-when-not-launched shape in CreateSessionResult).
    let repoPath = dict["repoPath"] as? String

    switch classifyTarget(target) {
    case .tunnelOnly(let raw):
        throw DaemonApiError(
            .internalError,
            "createSession target '\(raw)' is web/sim-scoped and must be tunneled by the router, not served natively",
            status: 500
        )

    case .fakeSeed(let raw):
        guard ctx.conformanceSeedEnabled else {
            throw DaemonApiError(
                .badRequest,
                "fake: targets require SPECTRA_CONFORMANCE_SEED=1",
                status: 400
            )
        }
        let sessionId = shortSessionId()
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let sessionName = name ?? "fake-session-\(sessionId)"
        // Mirrors fakes.ts's FakeDriver.snapshot(): platform 'web'. The
        // literal `fake:...` string is preserved on the stored target's
        // `url` field purely for session-record fidelity (nothing reads it
        // back to reconstruct a real connection — FakeDriver.connect(_:)
        // never validates its target).
        let driverTarget = SpectraDriverTarget(url: raw)

        ctx.sessions.create(
            id: sessionId, name: sessionName, platform: "web",
            target: driverTarget, repoPath: repoPath, now: now
        )

        let driver = FakeDriver()
        try driver.connect(target: driverTarget)
        ctx.driverRegistry.set(sessionId, driver: driver)

        let snap = try driver.snapshot()
        return [
            "sessionId": sessionId,
            "platform": "web",
            "elementCount": snap.elements.count,
            "snapshot": SnapshotSerialize.serializeSnapshot(snap),
        ] as [String: Any]

    case .macos(let appName):
        let sessionId = shortSessionId()
        let now = Int(Date().timeIntervalSince1970 * 1000)
        // TS parity (session.ts:372-383 generateName): a macos session's
        // default name is the APP-NAME SLUG (lowercased, whitespace->dashes),
        // NOT "session-<id>". This is contract-visible AND load-bearing:
        // session.name feeds startRecording's window-title hint chain
        // (RecordingOps:674/:698 -> SingleWindowRecording selectSingleWindow's
        // HARD title filter) — the "session-<id>" default could never match a
        // real window title, convicted by V-C step 6 (2026-07-03).
        let sessionName = name ?? appName.lowercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: "-")
        let driverTarget = SpectraDriverTarget(appName: appName)

        // Session goes into the store REGARDLESS of what happens next
        // (matches connect.ts:73-80's own ordering — `ctx.sessions.create`
        // runs before any driver construction/connect attempt; a later
        // driver failure below does not roll this back, exactly like the
        // TS reference implementation does not).
        ctx.sessions.create(
            id: sessionId, name: sessionName, platform: "macos",
            target: driverTarget, repoPath: repoPath, now: now
        )

        if recordOnly {
            // Record-only macOS sessions skip the AX snapshot entirely
            // (parity with connect.ts:98-118 — Screen-Recording-only grant
            // path; recording resolves its target window independently and
            // never touches the AX element inventory). NO driver is
            // constructed or registered for this session — exactly like
            // connect.ts, which returns before `createDriver()`/
            // `ctx.drivers.set(...)`.
            return [
                "sessionId": sessionId,
                "platform": "macos",
                "elementCount": 0,
                "snapshot": "",
            ] as [String: Any]
        }

        let driver: Driver
        do {
            // CONTRACT (DriverProtocol.swift §6a): throws — not a two-phase
            // construct-then-connect — if the app can't be reached at all;
            // on success the returned driver is already ready for
            // snapshot()/act()/screenshot(), no further connect() call
            // needed. The factory itself doesn't know about DaemonApiError
            // (§6a) — mapping to the wire error taxonomy is this handler's
            // job.
            driver = try makeNativeDriver(appName: appName)
        } catch {
            throw DaemonApiError(
                .internalError,
                "Failed to connect to macOS app '\(appName)': \(error)",
                status: 500
            )
        }
        ctx.driverRegistry.set(sessionId, driver: driver)

        let snap = try driver.snapshot()
        return [
            "sessionId": sessionId,
            "platform": "macos",
            "elementCount": snap.elements.count,
            "snapshot": SnapshotSerialize.serializeSnapshot(snap),
        ] as [String: Any]
    }
}

/// 8-char lowercase-hex id — same length/character-class convention as
/// TS's `randomUUID().slice(0, 8)` (not byte-identical; session ids are
/// opaque per-call-random on both sides of the port and are cross-leg
/// normalized by V-B's differential comparator, not compared literally).
private func shortSessionId() -> String {
    String(UUID().uuidString.prefix(8)).lowercased()
}
