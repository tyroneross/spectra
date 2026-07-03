// macos/Spectra/DaemonCore/DriverProtocol.swift
//
// M3.G2 — W0 interface freeze (SG-3 / PC-4). This file is the SOLE frozen
// cross-agent symbol surface for the G2 wave: every one of the 7 parallel
// Sonnet implementers (S1-S7) builds against EXACTLY what is declared or
// documented here. Nothing here may be renamed, retyped, or resignatured by
// S1-S7 without a fresh Advisor ruling (mirrors G1's pin discipline, ADR-07).
//
// FROZEN SURFACE INDEX (6 W0 items + 2 scope-auditor addenda):
//   1. `Driver` protocol + behavioral contracts               -> compiled below
//   2. `DriverRegistry` (get/set/remove by sessionId)          -> compiled below
//   3. `DaemonContext` extension contract (fields S6 adds)     -> documented (§3)
//   4. `SessionStore` public write surface + `sessionDir`      -> documented (§4)
//      + `SessionPresenceQuerying` (routing-read addendum #1)  -> compiled below
//   5. The 5 register-hook signatures S6 wires                 -> documented (§5)
//   6. `makeNativeDriver(appName:)` factory                     -> documented (§6a)
//      + `RecordingOwnership` protocol + installation path
//        (routing-read/installation addendum #2)               -> compiled below (§6b)
//   Plus: D-03 v2 routing-config schema (documented, §D-03) and the mapping-
//   doc "14 ops" -> 16 fix (docs/plans/m3-op-group-mapping.md, sibling commit).
//
// Anything declared here as compiled Swift is load-bearing and parses today.
// Anything documented as a comment-only contract (§3, §4 body, §5, §6a,
// §D-03) belongs to a file this W0 slice does NOT own (HandlerRegistry.swift,
// SessionStore.swift, Router.swift, NativeDriver.swift respectively) — S1-S6
// implement those signatures VERBATIM in their owned files; a mismatch is a
// scope violation, not a stylistic choice.
//
// Rally handoff (Codex / M4): M4's CdpDriver conforms to `Driver` below,
// exactly as FakeDriver (S1) and NativeDriver (S2) do. CdpDriver may add its
// own CDP-only supplementary methods (e.g. an escape hatch equivalent to TS
// `Driver.getConnection?`) via a SEPARATE protocol/extension it defines
// itself — that is additive and does not reopen this freeze. Any change to
// the methods/contracts frozen below (post-freeze) requires an Advisor
// ruling, per the plan's Risks table ("Codex/M4 builds against a drifting
// driver interface").
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

// ═══════════════════════════════════════════════════════════════════════════
// §1 — Driver value types (mirror src/core/types.ts: Element, Snapshot,
//      ActionType, ActResult). These are INTERNAL daemon-core types — the
//      wire never carries them directly. `snapshot`'s wire result field is a
//      SERIALIZED STRING (contract.spec.json: SnapshotResult.snapshot has
//      typeText "string"), produced from a DriverSnapshot by S2's
//      SnapshotSerialize.swift (parity with src/core/serialize.ts). Do not
//      treat `.json`-style dictionaries below as wire shapes.
// ═══════════════════════════════════════════════════════════════════════════

/// Mirrors `src/core/types.ts` Platform. Full TS vocabulary kept for forward
/// parity even though G2's two conformers (FakeDriver, NativeDriver) only
/// ever produce `.web` (FakeDriver, matching tests/conformance/lib/fakes.ts)
/// and `.macos` (NativeDriver). Wire-string values are frozen (rawValue) —
/// never reorder/rename cases.
enum DriverPlatform: String, Sendable, CaseIterable {
    case web, macos, ios, watchos, terminal
}

/// Mirrors `src/core/types.ts` Element.bounds `[number, number, number,
/// number]`. A NAMED struct (not a raw `[Double]`) is a deliberate W0
/// decision: a raw 4-element array is an index-order footgun across 3
/// independent agents (S2 produces it, S3's intelligence/resolve reads it,
/// S4's screenshot region-crop reads it) — TS pays that risk with a tuple
/// type; Swift does not have to.
///
/// FROZEN INVARIANT (PC-4 structural floor, quoted verbatim from the plan):
/// "bounds are numeric 4-tuples with non-negative width/height". Conformers
/// MUST uphold this — V-B's structural-floor comparison enforces it
/// end-to-end; this layer does not runtime-assert it (graceful degradation:
/// a malformed bounds value should surface as a V-B FINDING, not crash the
/// daemon mid-dispatch).
struct DriverBounds: Sendable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    /// `[x, y, width, height]` — the exact ordering `src/core/serialize.ts`
    /// destructures (`const [x, y, w, h] = el.bounds`). S2's
    /// SnapshotSerialize.swift renders from this array's ordering.
    var asArray: [Double] { [x, y, width, height] }
}

/// Mirrors `src/core/types.ts` Element.
struct DriverElement: Sendable {
    var id: String
    var role: String
    var label: String
    var value: String?
    var enabled: Bool
    var focused: Bool
    var actions: [String]
    var bounds: DriverBounds
    var parent: String?
}

/// Mirrors `src/core/types.ts` SnapshotMetadata.
struct DriverSnapshotMetadata: Sendable {
    var elementCount: Int
    var stableAtMs: Int?
    var timedOut: Bool?
}

/// Mirrors `src/core/types.ts` Snapshot.
struct DriverSnapshot: Sendable {
    var url: String?
    var appName: String?
    var platform: DriverPlatform
    var elements: [DriverElement]
    /// Wall-clock ms at capture (Date()-equivalent of TS `Date.now()`). This
    /// field is IN the pre-ruled G2 volatile-field map (plan §Verification)
    /// — never assume determinism across two snapshot() calls, even against
    /// FakeDriver.
    var timestampMs: Int
    var metadata: DriverSnapshotMetadata?
}

/// Mirrors `src/core/types.ts` ActionType. Wire-string values frozen —
/// mapped 1:1 from the MCP `act`/`step` params; do not add/rename/reorder.
enum DriverActionType: String, Sendable, CaseIterable {
    case click, type, clear, select, scroll, hover, focus
}

/// Mirrors `src/core/types.ts` ActResult.
struct DriverActResult: Sendable {
    var success: Bool
    var error: String?
    var snapshot: DriverSnapshot
}

// ═══════════════════════════════════════════════════════════════════════════
// §1 (cont'd) — The Driver protocol itself. FROZEN for the G2 wave.
// ═══════════════════════════════════════════════════════════════════════════

/// The driver-agnostic surface every G2 op handler consumes via
/// `ctx.driverRegistry.get(sessionId)` — the Swift analog of the TS daemon's
/// `ctx.drivers.get(sessionId)` single-seam finding (verified: `new
/// CdpDriver()` is constructed in exactly one place, connect.ts:122; every
/// other handler resolves the driver abstractly). FakeDriver (S1) and
/// NativeDriver (S2) — and, post-M4, Codex's CdpDriver — conform to EXACTLY
/// this surface with EXACTLY these semantics. This contract, not a shared
/// eyeball, is what makes "FakeDriver and NativeDriver cannot diverge
/// semantically" (PC-4) an enforceable claim: V-B's differential gate
/// catches drift; this protocol's doc-comments define what drift IS.
///
/// Concurrency (flagged, not solved, here): a Driver instance is looked up
/// per-sessionId via DriverRegistry below. DriverRegistry's get/set/remove
/// are individually thread-safe, but TWO CONCURRENT REQUESTS AGAINST THE
/// SAME sessionId are NOT serialized by the registry — SocketServer
/// dispatches connections concurrently (connQueue is
/// `.concurrent`, SocketServer.swift:28), unlike the TS daemon's
/// single-threaded event loop, where concurrent awaits on one session are at
/// least serialized at the macrotask boundary. Conformers must be
/// internally safe against concurrent calls, OR this must be closed at a
/// higher layer (S6/Router or a per-session dispatch queue) — NOT assumed
/// solved by this file. Residual risk, surfaced for orchestrator review.
protocol Driver: AnyObject {
    /// Establish (or re-establish) the underlying connection for `target`.
    /// CONTRACT: validates `target` EAGERLY — throws immediately if the
    /// target shape is unusable for this driver (mirrors driver.ts:41-43:
    /// NativeDriver throws if `target.appName` is absent). On success the
    /// driver is immediately ready for snapshot()/act()/screenshot() with no
    /// further connect() call required (mirrors driver.ts:47-49's own
    /// snapshot probe during connect).
    func connect(target: SpectraDriverTarget) throws

    /// Return the CURRENT UI state. FROZEN CONTRACT (byte-for-byte across
    /// conformers):
    ///   - element ids are assigned SEQUENTIALLY as "e1", "e2", ..., "eN" in
    ///     traversal order, freshly for THIS call — ids are NOT stable
    ///     across snapshots. A stale id from a prior snapshot is exactly the
    ///     "unknown/stale element" case act() below must handle gracefully.
    ///   - when `metadata` is present, `metadata.elementCount ==
    ///     elements.count`.
    ///   - `timestampMs` is wall-clock at capture — volatile by design (see
    ///     DriverSnapshot doc); never assume repeatability.
    ///   - never returns a partially-populated DriverSnapshot on success —
    ///     either throws, or returns a fully-formed one.
    func snapshot() throws -> DriverSnapshot

    /// Perform `action` on `elementId` (from the MOST RECENT snapshot()).
    /// FROZEN CONTRACT (PC-4's anti-drift clause — mirrors driver.ts:88-129):
    ///   - an UNKNOWN or STALE elementId returns `success: false` with a
    ///     descriptive `error` and a FRESH re-snapshot. It does NOT throw.
    ///   - an action the underlying surface rejects (e.g. an AX press that
    ///     fails) ALSO returns `success: false` + a fresh snapshot — not a
    ///     throw.
    ///   - `throws` is reserved for infrastructure-level failure the caller
    ///     cannot route around (bridge process died, connection lost). This
    ///     is a residual case even TS's own reference implementation doesn't
    ///     fully close (driver.ts:123's `await this.snapshot()` inside its
    ///     own catch block can itself reject) — conformers should still
    ///     prefer `success:false` whenever the failure is attributable to
    ///     the element/action rather than the transport.
    ///   - the returned snapshot is ALWAYS freshly captured POST-action
    ///     (never the pre-action snapshot, never omitted, even on failure).
    func act(elementId: String, action: DriverActionType, value: String?) throws -> DriverActResult

    /// Return a PNG-encoded screenshot of the current driver target — ONE
    /// full-frame image, always. Mode/crop/region handling (full, element,
    /// region, auto) is the CALLER's job (S4's CaptureOps.swift), not the
    /// driver's — mirrors driver.ts:132-137 / FakeDriver's fixed-PNG stub.
    /// CONTRACT: returns decodable, non-empty PNG bytes, or throws.
    func screenshot() throws -> Data

    /// End this session's use of the driver WITHOUT tearing down shared
    /// underlying infrastructure the driver may reuse across sessions (e.g.
    /// NativeDriver's shared bridge process — driver.ts:139-145, "Don't
    /// close bridge — shared across sessions"). NEVER throws: best-effort
    /// state reset only (graceful degradation — a close() failure must
    /// never fail closeSession's response).
    func close()

    /// Full teardown — closes any underlying connection/process THIS
    /// instance owns exclusively. NEVER throws, same rationale as close().
    func disconnect()
}

/// Default no-op for TS `Driver.navigate?` — the ONE optional TS member with
/// a plausible G2-adjacent meaning (Swift protocols cannot mark individual
/// requirements optional, so this is a protocol-extension default instead).
/// FakeDriver and NativeDriver inherit this no-op for free and never need to
/// implement it (G2 drivers have no URL/navigation concept). Reserved for
/// M4's CdpDriver, which WILL meaningfully override this. TS's other
/// optional member, `getConnection?` (a CDP-only raw-connection escape
/// hatch), is intentionally NOT part of this frozen protocol at all — it is
/// out of scope for every G2 conformer; M4/Codex may expose the CDP
/// equivalent via a CdpDriver-only supplementary type without reopening this
/// freeze (see the rally-handoff note at the top of this file).
extension Driver {
    func navigate(url: String) throws {}
}

// ═══════════════════════════════════════════════════════════════════════════
// §2 — DriverRegistry. FROZEN. The single most cross-agent-shared symbol
//      (the exact class of drift G1 already proved painful).
// ═══════════════════════════════════════════════════════════════════════════

/// Maps sessionId -> the live `Driver` instance for that session. Declared
/// here (W0); POPULATED by S1 (ConnectOps.swift, on a successful
/// native/`fake:` createSession); CONSUMED by S2/S3/S4's op handlers via
/// `ctx.driverRegistry.get(sessionId)` — the Swift analog of the TS daemon's
/// `ctx.drivers.get(sessionId)`.
///
/// Web/sim sessions (proxied, per ND-3 + store-presence routing) never get
/// an entry here. A `get` miss for a session that DOES exist in
/// SessionStore means "this session's driver lives in the TS backend" — a
/// ROUTING fact S6 resolves BEFORE dispatch, not an error condition a G2
/// handler needs to detect itself (by construction, an affinity-routed
/// request only ever reaches a native handler when SessionStore already
/// reports a hit — see SessionPresenceQuerying below).
final class DriverRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var table: [String: Driver] = [:]

    /// O(1) lookup. `nil` means "no driver registered for sessionId" —
    /// either the session doesn't exist at all, or it's a proxied/non-native
    /// session. Callers distinguish those two cases via SessionStore, not
    /// via this registry.
    func get(_ sessionId: String) -> Driver? {
        lock.lock(); defer { lock.unlock() }
        return table[sessionId]
    }

    /// Single-writer insert. Overwrites any existing entry for sessionId —
    /// last write wins, no merge (mirrors createSession's own
    /// idempotent-target semantics; a reconnect replaces, not appends).
    func set(_ sessionId: String, driver: Driver) {
        lock.lock(); defer { lock.unlock() }
        table[sessionId] = driver
    }

    /// Removes and returns the entry (if any), so the caller can invoke
    /// `.close()`/`.disconnect()` on the returned driver OUTSIDE this lock —
    /// deliberately avoids holding the registry lock across a driver
    /// teardown call, which could otherwise stall dispatch for unrelated
    /// sessions on SocketServer's concurrent connection queue.
    @discardableResult
    func remove(_ sessionId: String) -> Driver? {
        lock.lock(); defer { lock.unlock() }
        return table.removeValue(forKey: sessionId)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 (routing-read addendum #1, scope-auditor) — SessionPresenceQuerying.
//      FROZEN. The read-side counterpart to §4's write surface below: S6's
//      Router/SocketServer decides native-vs-tunnel by READING SessionStore
//      presence (D-02, ADR-04 rev-2 addendum: store-presence IS the routing
//      signal, no separate ownership map).
// ═══════════════════════════════════════════════════════════════════════════

/// SessionStore (S1-owned this rev, ADR-07 pin-lift) MUST add conformance:
/// `final class SessionStore: @unchecked Sendable, SessionPresenceQuerying`.
///
/// This is a DEDICATED presence check — deliberately distinct from the
/// existing `SessionStore.get(_:) -> SpectraSessionRecord?`
/// (SessionStore.swift:515, used by getSession/getRun's full-record reads)
/// — so S1 remains free to change what `get` does internally (e.g. lazy-seed
/// side effects, richer error surfacing) without silently changing what
/// S6's routing decision observes on the hot path.
protocol SessionPresenceQuerying {
    /// True iff sessionId is present in the store RIGHT NOW.
    ///   - O(1) expected: a lock + dictionary lookup, matching SessionStore's
    ///     existing NSLock-guarded storage (`withLock`).
    ///   - MUST NOT trigger `ensureConformanceSeed` or any other side
    ///     effect. S6 calls this on EVERY affinity-routed request — a
    ///     side-effecting presence check would make routing non-idempotent
    ///     and would let a routing probe silently seed conformance state.
    ///   - Recording-scoped ops (getRecording) do NOT use this — they use
    ///     `RecordingOwnership.ownsRecording(_:)` (§6b below) against a
    ///     separate store.
    func contains(_ sessionId: String) -> Bool
}

// ═══════════════════════════════════════════════════════════════════════════
// §6b (routing-read + installation addendum #2, scope-auditor) —
//      RecordingOwnership. FROZEN protocol (compiled) + FROZEN installation
//      path (documented — the concrete conformer is S4's, built in
//      RecordingOps.swift, a file this W0 slice does not own).
// ═══════════════════════════════════════════════════════════════════════════

/// One-method affinity-read for recording-scoped ops (currently just
/// `getRecording`). S4 implements this on its recording registry/registries
/// (RecordingOps.swift — single-window active recordings + composite
/// recordings, if S4 tracks both as one conformer or two, S4's choice); S6's
/// Router/SocketServer reads it via `ctx.recordingOwnership` for the D-02
/// store-presence routing decision on `getRecording`.
protocol RecordingOwnership {
    /// True iff THIS Swift daemon's own recording registry/registries
    /// contain recordingId right now. Same purity contract as
    /// `SessionPresenceQuerying.contains`: no side effects, safe to call on
    /// every `getRecording` dispatch.
    func ownsRecording(_ recordingId: String) -> Bool
}

// RecordingOwnership INSTALLATION PATH (frozen — documented, not compiled,
// since it spans main.swift/HandlerRegistry.swift, both S6-owned, and
// RecordingOps.swift, S4-owned):
//
// Unlike DriverRegistry (a W0-frozen CONCRETE class DaemonContext can just
// construct inline — `let driverRegistry = DriverRegistry()`), the concrete
// RecordingOwnership conformer is a type S4 defines and W0/S6 don't know by
// name. FROZEN choice (of the two options considered): the register hook
// RETURNS the concrete instance; it does NOT self-install into ctx (S4's
// file has no business knowing DaemonContext's field name, keeping S4 fully
// decoupled from S6's DaemonContext internals):
//
//   func registerCaptureRecordingOps(_ registry: HandlerRegistry) -> RecordingOwnership
//
// S6 (main.swift) wires it explicitly, BEFORE `server.start(...)` —
// boot-time only, single assignment, mirrors CapabilityPolicy
// .validateAtBoot()'s already-established "resolve before first request"
// ordering (HandlerRegistry.swift:35):
//
//   let recordingOwnership = registerCaptureRecordingOps(registry)
//   context.recordingOwnership = recordingOwnership
//
// `DaemonContext.recordingOwnership` is `var recordingOwnership:
// RecordingOwnership?` (S6 adds this field — see §3 below). FAIL-CLOSED
// DEFAULT: if a route decision ever reads `ctx.recordingOwnership` while it
// is still nil (a wiring-order bug), that MUST be treated as
// `ownsRecording == false` (route: tunnel) — never force-unwrap, never crash
// the dispatch path. This mirrors the plan's graceful-degradation default
// everywhere else in G2 (a routing miss tunnels; it never 500s).

// ═══════════════════════════════════════════════════════════════════════════
// §3 — DaemonContext extension contract (documented; landed by S6 in
//      HandlerRegistry.swift — DaemonContext is declared there, not here).
// ═══════════════════════════════════════════════════════════════════════════
//
// S6 adds EXACTLY these two stored properties to the DaemonContext class
// body (Swift extensions cannot add stored properties, so this is a direct
// edit to the class, not a separate `extension DaemonContext { }` block):
//
//   let driverRegistry = DriverRegistry()
//   var recordingOwnership: RecordingOwnership?
//
// `driverRegistry` follows the EXACT pattern already used for `sessions`/
// `library` (HandlerRegistry.swift:18-19: inline-initialized, no external
// wiring needed) — DriverRegistry is a W0-frozen CONCRETE type (§2 above),
// so no factory/installation step is required for it, unlike
// `recordingOwnership` (§6b above), which starts nil and is assigned exactly
// once at boot.
//
// SessionStore access: DaemonContext already exposes `let sessions =
// SessionStore()` (G1, unchanged). S6's Router reads store-presence via
// `ctx.sessions.contains(sessionId)` (SessionPresenceQuerying, §4 above) —
// no new DaemonContext field is needed for that; the existing `sessions`
// field is enough once SessionStore conforms.

// ═══════════════════════════════════════════════════════════════════════════
// §4 — SessionStore public write surface (documented; S1 implements in
//      SessionStore.swift, the sole file granted the ADR-07 pin-lift this
//      rev). D-04 note: the RECORD SHAPES these methods append
//      (SpectraSessionStep, SpectraCaptureRunDecision, SpectraCaptureRunArtifact,
//      SpectraCaptureRunRecording) already exist in SessionStore.swift from
//      G1 — D-04 ("contract-shape parity with src/core/session.ts records")
//      is satisfied by those existing types; W0's only remaining D-04
//      obligation is this write surface + the public sessionDir accessor.
// ═══════════════════════════════════════════════════════════════════════════
//
// Frozen signatures S3 (step/decision/artifact writes) and S4
// (recording-status writes) code against. All FOUR throw
// `DaemonApiError(.notFound, ..., status: 404)` if sessionId is absent —
// mirrors getSession/getRun's existing not-found handling (SessionOps.swift)
// so a session that vanished mid-flight (closeSession racing a step) fails
// the SAME way reads already do:
//
//   func addStep(sessionId: String, step: SpectraSessionStep) throws
//   func addDecision(sessionId: String, decision: SpectraCaptureRunDecision) throws
//   func addArtifact(sessionId: String, artifact: SpectraCaptureRunArtifact) throws
//   func setRecordingStatus(sessionId: String, recording: SpectraCaptureRunRecording) throws -> SpectraCaptureRunRecording
//
// Each append also bumps the owning SpectraSessionRecord's/SpectraCaptureRun's
// `updatedAt` (matches TS SessionManager mutation semantics — this is
// exactly the field the pre-ruled `stateful-read-timestamp` V-B class exists
// to handle). `setRecordingStatus` RETURNS the updated recording record —
// mirrors `src/daemon/core-impl.ts`'s own call shape (`const recording =
// await this.ctx.sessions.setRecordingStatus(...)`), which callers
// immediately pass to their own emit/notify step.
//
// PUBLIC accessor (today PRIVATE `sessionDirLocked`, SessionStore.swift:590
// — S1 EXPOSES/RENAMES this, does not duplicate it under a second name):
//
//   func sessionDir(_ sessionId: String) -> String
//
// Non-throwing — same fallback-to-derived-path behavior as today for an
// untracked id (SessionStore.swift:591-600's existing storageRoot-or-derived
// logic carries over unchanged; only its access level changes).
//
// ROUTING-READ addendum (§4 addendum #1, scope-auditor) — S1 ALSO adds:
//
//   func contains(_ sessionId: String) -> Bool
//   // + conformance: `final class SessionStore: @unchecked Sendable, SessionPresenceQuerying`
//
// (SessionPresenceQuerying protocol is defined and compiled above in this
// file — S1 conforms to it, does not redeclare it.)

// ═══════════════════════════════════════════════════════════════════════════
// §5 — The 5 register-hook signatures (documented; S1-S5 implement in their
//      owned files, S6 wires all 5 into HandlerRegistry.swift/main.swift).
// ═══════════════════════════════════════════════════════════════════════════
//
// Exact signatures S6's main.swift wiring depends on. Each bundles ALL the
// ops its owning agent implements — mirrors G1's established
// `func registerXOps(_ registry: HandlerRegistry)` free-function pattern
// (see `registerHealth` in HandlerRegistry.swift, `registerSessionOps` in
// SessionOps.swift). These are declared here as a TEXTUAL contract, not
// compiled Swift: a free function can only be defined once, and its real
// body belongs to S1-S5's owned files, not this one.
//
//   func registerConnectOps(_ registry: HandlerRegistry)
//     // S1: createSession
//
//   func registerAxOps(_ registry: HandlerRegistry)
//     // S2: snapshot, act, computerUse
//
//   func registerStepOps(_ registry: HandlerRegistry)
//     // S3: step, llmStep, walkthrough, observe, analyze, discover
//
//   func registerCaptureRecordingOps(_ registry: HandlerRegistry) -> RecordingOwnership
//     // S4: screenshot, startRecording, stopRecording, getRecording
//     // ASYMMETRIC — the ONLY one of the 5 with a return value; see the
//     // RecordingOwnership installation path, §6b above.
//
//   func registerTerminalOps(_ registry: HandlerRegistry)
//     // S5: recordTerminal, replayTerminal
//
// S6's main.swift wiring order (boot-time, strictly before `server.start`):
//
//   registerConnectOps(registry)
//   registerAxOps(registry)
//   registerStepOps(registry)
//   let recordingOwnership = registerCaptureRecordingOps(registry)
//   context.recordingOwnership = recordingOwnership
//   registerTerminalOps(registry)
//
// NAMING NOTE (flagged for orchestrator review — see the returned summary):
// an earlier paraphrase of this freeze used `registerComputerUseOps` for
// S2's hook. The AUTHORITATIVE name, per BOTH docs/plans/m3-g2-plan.md
// (§Work items, W0 goal item (e)) and docs/plans/m3-g2-plan.handoff.md (§W0
// item 5) — independently, on the same date — is `registerAxOps`: it
// bundles snapshot+act+computerUse (S2's WHOLE AX-engine surface, all 3 of
// S2's op handlers), not computerUse alone. This file freezes
// `registerAxOps` as the one true name. If a split (computerUse under its
// own hook) was actually intended, that is a scope change from the recorded
// plan and needs an explicit ruling before S2 starts, not a silent rename.

// ═══════════════════════════════════════════════════════════════════════════
// §6a — makeNativeDriver factory (documented; S2 implements in
//      NativeDriver.swift — NativeDriver.swift is not a W0-owned file).
// ═══════════════════════════════════════════════════════════════════════════
//
// S1's createSession(macos) calls this; S2 implements it. Freezes
// CONSTRUCTION — the `Driver` protocol above freezes METHODS only; a driver
// has to come from somewhere, and that "somewhere" must be a name S1 can
// code against before S2's NativeDriver type exists.
//
//   func makeNativeDriver(appName: String) throws -> Driver
//
// CONTRACT: throws (not a two-phase construct-then-connect) if the app
// can't be reached AT ALL (the underlying bridge process won't start) —
// mirrors driver.ts's NativeDriver.connect() eagerly probing via a snapshot
// call (driver.ts:47-49) rather than deferring failure to the first real
// snapshot()/act() call. Callers (S1's ConnectOps.swift) treat a throw here
// as equivalent to createSession's own connect-time failure — this factory
// itself does not know about `DaemonApiError`; mapping to a wire error code
// is S1's job, not S2's.

// ═══════════════════════════════════════════════════════════════════════════
// §D-03 — routing config schema v2 (documented shape only; Router.swift/S6
//      defines the actual `Decodable` type — this is NOT that type, to avoid
//      a duplicate-symbol collision when the whole DaemonCore compiles).
// ═══════════════════════════════════════════════════════════════════════════
//
// On-disk JSON, `SPECTRA_ROUTING_CONFIG` v2:
//
//   {
//     "version": 2,
//     "native":   ["op", ...],   // sessionless ops Swift serves 100%
//     "affinity": ["op", ...],   // session/recording-scoped ops, routed by
//                                // store-presence (SessionPresenceQuerying /
//                                // RecordingOwnership, above)
//     "merge":    ["op", ...],   // e.g. listSessions — deterministic union
//                                // of both stores
//     "fanout":   ["op", ...]    // e.g. closeAllSessions — fan out to both,
//                                // aggregate counts
//   }
//
// Fail-closed loader invariants (T-23 — Router.swift/S6 implements; every
// case below MUST refuse to boot, extending the v1 pattern already
// established in Router.swift's `RoutingConfigError`):
//   - version is neither 1 nor 2                          -> unsupportedVersion
//     (v1 configs, `{"version":1,"native":[...]}`, stay valid VERBATIM —
//     the rollback target, T-28, <2 min drill)
//   - the SAME op appears in more than one of
//     native/affinity/merge/fanout                        -> listOverlap
//   - a session-scoped op (the v1 `sessionCoupledOps` set — its guard's
//     SPIRIT survives even though the v1 denylist itself is superseded by
//     store-presence construction) present in plain `native:[]`
//                                                          -> sessionOpsInNative
//   - an op listed in affinity/merge/fanout with NO handler registered in
//     HandlerRegistry                                     -> unregisteredAffinityOp
//   - malformed JSON / unreadable file                     -> same as v1
//     (RoutingConfigError.unreadable / .malformedJSON)
//
// Dispatch-plane consequence (S6, SG-1a): `route(for:)` becomes
// PARAMS-AWARE for affinity-bucket ops only (must decode sessionId/
// recordingId/target BEFORE routing) — native/proxy buckets keep the
// parse-free byte-tunnel fast path unchanged from v1. A decode failure on an
// affinity op is a deterministic `bad_request` — NEVER a silent tunnel of
// unparsed bytes.
