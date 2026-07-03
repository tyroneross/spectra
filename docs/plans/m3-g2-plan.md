# Plan: M3.G2 — Capture/AX op group ported to the Swift daemon-core (session-affinity strangler increment)

<!-- checklist
Item 1 — Auth guard: unix socket mode-0600 peer-credential auth + capability gate carry over unchanged (src/daemon/security.ts mirror: WireProtocol.swift Capability enum + CapabilityPolicy.swift). G2 delta: the 16 G2 ops must REGISTER in CapabilityPolicy with the same capability vocabulary the TS daemon asserts (missingCapabilitiesForOperation parity) — F-18, proven by the Gate-D-style manual mutation (T-26) exactly as G1's GV-4a.
Item 2 — External APIs: N/A: no new external API calls. All traffic stays on the existing local unix-socket wire contract (src/contract/contract.spec.json, hash-frozen). ffmpeg/helper binaries are local subprocesses, not APIs.
Item 3 — Rate-limit criterion: N/A: no paid API calls. (llmStep executes a CLIENT-built plan — the daemon never holds an LLM key; verified in src/mcp/tools/llm-step.ts header.)
Item 4 — Discoverability: N/A: daemon/infra only, no UI surface. CLI/MCP surface unchanged.
Item 5 — Server/client boundary: N/A: not a Next.js app. The binding boundary is the frozen wire contract (contract.spec.json + wire.ts envelope), enforced by the conformance oracle — unchanged from G1.
Item 6 — Concurrency: Swift SessionStore + the two recording registries are each single-writer, serialized on their own queue/actor. Rev 2: NO separate ownership map — store-presence IS the routing signal (D-02, ADR-04 addendum), so there is no map-vs-store write race by construction. listSessions merge (F-16) reads both stores with deterministic ordering (Swift-owned first, then backend, each sorted by createdAt then id). closeAllSessions fans out native-then-backend, aggregates counts. FakeDriver is per-session state, no sharing. Conformance chains keep --no-file-parallelism (G1 GV-2 durable fix).
Item 7 — Observability: SocketServer logLine (SocketServer.swift:248) gains the route origin (native = store-hit, proxy = store-miss/unlisted); dual-run JSONL rows via DualRunRecorder (ProxyClient.swift:369) for new dual-run-eligible ops; t02-masks.json class-pattern ledger carries over + the G2 pre-ruled classes (§Volatile-field map); G2 differential report + excluded-set JSON with per-entry class; on-device gate red/green evidence (.build-loop/flip-evidence/gate-g2-ondevice.txt); TCC spike evidence (.build-loop/flip-evidence/gate-g2-tcc-spike.txt).
Item 8 — Input validation: server-side param validation at the Swift dispatch boundary for all 16 ops (mirrors the TS hardening pass fda8626: malformed → deterministic bad_request AFTER the capability check; void/all-optional wire edges handled). T-20 includes the boundary-value arms. Rev 2: affinity routing itself decodes the envelope pre-route (SG-1a) — decode failure on an affinity op = bad_request, never a silent tunnel.
Item 9 — Stable ID traceability: U-04 → F-10..F-18 → D-02/D-03/D-04 → T-20..T-28; ADR-04..ADR-07. Chain example: U-04 → F-16 (router v2) → D-02 (store-presence signal) → T-23/T-24.
Item 10 — JSON spec object: present (§Spec Object).
Item 11 — Blocking-and-novel question gate: ZERO open questions. ND-1..ND-5 directions USER-APPROVED (relayed by orchestrator, 2026-07-03); ND-1's implementation refined per plan-critic PC-1 (store-presence, §ADR-04 addendum) and ND-2's sequencing per PC-2 (spike after S2+S7 land, under the production launch context) — directions unchanged. All other unknowns resolved from code (✅ anchors in §Depends-on) or labeled [ASSUMED].
Item 12 — Low-reversibility ADRs: ADR-04 (routing v2 session-affinity + rev-2 store-presence addendum), ADR-05 (helper-binary subprocess reuse vs in-process AX/SCK), ADR-06 (FakeDriver conformance seam), ADR-07 (G1 pin lift for SessionOps.swift/SessionStore.swift under named ownership).
Item 13 — Analytical lens: DSM for the op×dependency decomposition (driver seam, stores, helpers); Pugh for the routing-increment selection AND the within-affinity mechanism selection (§ADR-04).
Item 14 — Handoff document: docs/plans/m3-g2-plan.handoff.md (implementer briefs W0/S1–S7 with ADR/test pointers; rev 2).
Item 15 — Synthesis dimensions: N/A: no UI surface.
Item 16 — Risk reason: S6 `runtime protocol` (routing/dispatch modes in SocketServer/Router/ProxyClient), S1/S2 `security boundary` (capability registration + TCC-adjacent AX/SCK paths), C10 `deployment` (live flip).
Item 17 — UI input/output contract: N/A: no UI surface.
Item 19 — Env-var manifest: N/A: no new external service. Internal env contract deltas in §Env Contract (SPECTRA_ROUTING_CONFIG version 2 schema; SPECTRA_CONFORMANCE_SEED widening; SPECTRA_CONFORMANCE_MILESTONE + SPECTRA_CONFORMANCE_FAKE_TARGET [ASSUMED names, reversible]).
-->

status: revision 2 — critic-hardened (plan-critic PC-1..PC-7 + scope-auditor SG-1..SG-5 applied; anchors verified against code). ND-1..ND-5 directions USER-APPROVED (orchestrator-relayed, 2026-07-03). Awaiting plan-critic + scope-auditor re-run, then fan-out.
modifies_api: true
scope_auditor_status: run 1 complete (SG-1..SG-5 applied in this rev); re-run pending on the rev-2 delta
author: Advisor (Frontier/Fable)
trigger: rev 2 — plan-critic + scope-auditor findings on rev 1 (scope-blindness in the 7-way fan-out: unowned dispatch-plane files, unowned snapshot/act handlers, loose W0 freeze, harness pin conflicts) + PC design gaps (ownership-map duplicated state; unrunnable spike sequencing; per-op mask whack-a-mole; FakeDriver-overfit residual)
risk_reason: runtime protocol

## Goal

Port the 16-op capture/AX group (G2) to the Swift daemon-core behind the already-live Swift front door, using **session-affinity routing** (routing config version 2): sessions Swift creates natively (macOS AX targets) are served natively end-to-end; sessions that require the not-yet-ported CDP driver (web targets) keep tunneling to the TS backend byte-transparently until M4.

**Falsifiable success, split pre-/post-flip (PC-6):**
- **Pre-flip acceptance (gates the flip commit C10):** T-20 headless conformance green on the milestone-widened allowlist · T-21 differential chains 3× consecutively fully green (each chain includes the G1 31/31 arm) · T-22 route fingerprint · T-23 v2 loader fail-closed proven · T-24 store-presence routing proven both directions · T-25 on-device native-integration gate executed with red/green evidence (incl. the production-context TCC probe) · T-26 capability-gate mutation red/green · T-27 merge/fan-out determinism.
- **Post-flip (part of DONE, after C10 — Gate E2, pauses for user):** T-28 live soak with dual-run rows + rogue-daemon detector quiet + rollback drill v2→v1 executed <2 min.

## The exact G2 op set — counted, not trusted

Contract (`src/contract/contract.spec.json`) = **30 operations** ✅ (verified by grep of top-level operation keys). G1 = 11 control-plane ops (live). G4 = 3 pipeline ops (`recordComposite`, `demo`, `autoRampDemo` — block on M5). **G2 = 30 − 11 − 3 = 16 ops** ✅:

`createSession` · `snapshot` · `observe` · `act` · `step` · `llmStep` · `walkthrough` · `screenshot` · `analyze` · `discover` · `computerUse` · `startRecording` · `stopRecording` · `getRecording` · `recordTerminal` · `replayTerminal`

The mapping doc's "(14 ops)" header is stale — its own list and G1 plan-correction #4 both say 16. `docs/plans/m3-op-group-mapping.md` gets a one-line correction in C2 (docs-only, W0).

**What each op actually needs (from the TS import graph — verified by reading the handlers ✅):**

| Op | Driver? | Native machinery | LLM? | Headless success path? |
|---|---|---|---|---|
| createSession | constructs one (CDP\|Native\|Sim by target) | AX bridge for macos targets | no | web→CDP (proxied); macos→AX (no); `fake:`→seed seam (yes) |
| snapshot / observe / act / step / llmStep / walkthrough | `ctx.drivers.get(sessionId)` — driver-agnostic | none beyond the driver | **no** (llmStep executes a client-built plan; step/walkthrough use heuristic resolve + intelligence/states) | yes, vs FakeDriver |
| analyze / discover | driver | deterministic intelligence/ (importance, states, framing) | no | yes, vs FakeDriver |
| screenshot | driver.screenshot() | PNG decode/crop/encode; CDP-only "clean" is a no-op for native | no | yes, vs FakeDriver (fixed PNG) |
| startRecording / stopRecording | session (macos+appName required) | spectra-native helper (ScreenCaptureKit) via stdio JSON-RPC + cursor-sampler binary + shelled ffmpeg probes | no | **no** (real display + screen-recording TCC) |
| getRecording | none | in-memory registries | no | yes (seeded record) |
| recordTerminal | none | PTY + cast writer + optional fs watcher | no | **yes** (PTY is headless-safe) |
| replayTerminal | none | pure .cast file parse | no | **yes** (fixture cast) |
| computerUse | none (sessionless; targets app/pid) | AX bridge in computer-use port + vision fallback | no | error-taxonomy only (success needs real AX grant) |

## Depends-on (reads-from) — verified anchors vs assumptions

**Verified ✅ (read in this authoring pass):** CDP single seam (`connect.ts:122`); SocketServer dispatch switch has only `.native`/`.proxy` arms (SocketServer.swift:156-159) and `logLine` is a SocketServer private (:248); `ProxyClient.tunnel` returns only the status (`-> Int?`, ProxyClient.swift:104) — no response-body capture; `DualRunRecorder` lives in ProxyClient.swift (:369); front-door harness pins a hardcoded v1 `PRODUCTION_ROUTING_CONFIG` (front-door.ts:62, written at :147) and `FrontDoorHarnessOptions` has no routing/env override; `SessionStore.sessionDirLocked` is private (SessionStore.swift:590); FakeDriver emits `Date.now()` timestamps (fakes.ts:75-76); payload-generator's `'target'` case always emits the web fixture URL (payload-generator.ts:79-87); llmStep/walkthrough/analyze/step have no LLM dependency; G2 handlers never import `pipeline`.

**Assumed:** §Assumptions below.

## Locked Decisions

- Inherited from G1 rev 3.5 wholesale: frozen wire contract; fail-closed data-driven routing; differential-not-absolute gate; route fingerprint for native ops; calibrated + class-pattern masks (closed six-op scope); structural comparison for generated artifacts; continue-on-fail with one report; deterministic-set flake = FINDING never mask; 3-consecutive-green-chains acceptance bar; backend-aware fail-closed rule; --no-file-parallelism; temp-HOME/SPECTRA_HOME isolation; `.spectra/` is PROTECTED real data; never trigger the login keychain; pins-are-law within a rev.
- **Analytical lens: DSM** (op × driver × store × helper dependency matrix drove the S1–S7 partition) **+ Pugh** twice: routing-increment selection and the within-affinity mechanism (both recorded in ADR-04).
- The proven G1 execution pattern is reused: MECE parallel Sonnet-5 implementers → Opus integration → adversarial differential gate → Fable group verdict → live activation with user pause.
- ffmpeg STAYS shelled (M5 rule); no new AVFoundation in polish paths. G2's only ffmpeg use is the existing shelled probes (black-frame guard, probeVideo).
- Model org: Sonnet-5 implementers, Opus orchestration/integration, Fable (Advisor + critics) verdicts. Dispatch tiers per work item below.
- **(rev 2) The G2 volatile-field map in §Verification is an Advisor pre-ruling** — the fan-out does not stop-and-rule per op; any volatility OUTSIDE that map still requires a fresh ruling (observed-need discipline unchanged).

## Novel Decisions — USER-APPROVED (orchestrator-relayed, 2026-07-03)

| ID | Decision (as approved; rev-2 refinements noted) | blocking-test | Status |
|---|---|---|---|
| ND-1 | **Routing config version 2 = session-affinity routing**: per-op `native:[]` for sessionless ops; session-scoped ops route by ownership; `listSessions` = deterministic merge; `closeAllSessions` = fan-out. **Rev-2 implementation refinement (PC-1): the ownership signal is STORE-PRESENCE, not a separate map** — a hit in Swift's own SessionStore / recording registry routes native; a miss tunnels. See ADR-04 addendum. | blocking-test: T-23, T-24, T-27 | APPROVED (direction); impl refined this rev |
| ND-2 | **Reuse the existing native helper binaries as subprocesses** — no in-process AXUIElement/ScreenCaptureKit in daemon-core for G2. **Rev-2 sequencing refinement (PC-2): the TCC spike runs once S2's helper-spawn + S7's probe script exist, and MUST run under the production launch context (launchd plist), not a dev shell** — TCC attribution keys on parent chain / responsible process / signature, so dev-shell green does not transfer. | blocking-test: T-25 (step 1) | APPROVED (direction); sequencing refined this rev |
| ND-3 | **`sim:` targets stay proxied in G2** — Swift's createSession serves macos (+`fake:` seed) natively; web AND sim targets tunnel to TS. | blocking-test: T-24 (target-split arm) | APPROVED |
| ND-4 | **G4 cross-daemon session references degrade gracefully**: `recordComposite`/`demo` (proxied, TS-implemented) called with a Swift-owned sessionId will not find that session in TS — composite still records (sessionId optional in its contract), session status/artifact attach skipped. Documented behavior delta until M5. | blocking-test: T-24 (G4-degradation arm) | APPROVED |
| ND-5 | **The on-device gate (T-25, user-present) is the acceptance path for the real AX/ScreenCaptureKit success paths.** Rev 2 extends the gate to 9 steps so all four previously-uncovered ops (observe/analyze/step/llmStep) also execute against NativeDriver (PC-4). | blocking-test: T-25 | APPROVED |

Zero open questions.

## Scope

Swift daemon-core (`macos/Spectra/DaemonCore/`) gains: a `Driver` protocol + FakeDriver + NativeDriver(bridge-client); createSession with target-split; the run/step/artifact/recording-status session model; snapshot/act handlers; the step engine (resolve/actions ports); the intelligence ports (importance/states/framing); screenshot + recording + terminal + computerUse handlers; Router v2 with store-presence affinity **including the SocketServer dispatch-plane and ProxyClient tunnel-variant work it physically requires (SG-1)**; conformance-harness widening (external-mode, fixture-context, front-door options, payload-generator fake-target — SG-2) + the G2 gates. TS backend `src/` is **not modified** (the strangler contract: TS keeps serving proxied traffic unchanged).

### Out of scope

M4 (CDP-in-Swift — Codex) and any web-native serving · M5/G4 (pipeline, recordComposite/demo/autoRampDemo stay proxied) · sim-native serving (ND-3) · GUI app changes · signing/notarization (except the ADR-05 fallback rung if the TCC spike demands it — user decision) · MCP shim changes · widening the rev-3.5 class-mask op scope beyond §Volatile-field map (Advisor ruling required for anything outside it) · retiring any TS code (M5-retirement) · optional envelope metadata emission · edits to the 4 allowlist-importer test files (conformance.test.ts, capability-gate, external-mode.test.ts, corpus/corpus.test.ts — SG-5: they must need ZERO edits).

## Dependency map — M4 / M5 / Codex, per op

**Verified single-seam finding holds ✅** (the CdpDriver is constructed only at `src/mcp/tools/connect.ts:122`; every other handler resolves `ctx.drivers.get(sessionId)`).

| Dependency | Ops affected | G2 treatment |
|---|---|---|
| **M4 (CDP port, Codex — idle)** | createSession(**web** target) + the web-session coverage of snapshot/observe/act/step/llmStep/walkthrough/screenshot/analyze/discover | **No wait.** Store-presence affinity keeps web sessions TS-owned/proxied automatically. Coordination instead of dependency: **W0 freezes `DriverProtocol.swift` (signatures AND behavioral contracts) and posts a rally handoff to Codex** so M4's CdpDriver implements the frozen protocol; G3 then = sessions created native for web targets, zero new ops. |
| **M5 (pipeline port, Codex — idle)** | none of the 16 (verified: G2 handlers import media/intelligence/computer-use/native, never pipeline ✅) | No dependency. G2's ffmpeg use = shelled probes only. |
| **SimBridge** | createSession(`sim:`) + sim-session coverage | Proxied (ND-3). |
| **Existing Swift helpers** (native/swift/AXBridge, MediaCapture, CompositeCapture --list-windows, cursor-sampler, screen-recording preflight) | snapshot/act (AX), startRecording/stopRecording (SCK), computerUse (AX), listWindows (already live) | Reused as subprocesses (ADR-05). **Contract sources (PC-7):** the AX bridge RPC contract is `src/native/bridge.ts` (ping/snapshot/press/setValue framing, 5s request timeout, 30s heartbeat) with the helper side in `native/swift/main.swift`+`AXBridge.swift`; the recording RPC contract is `src/daemon/core-impl.ts` `NativeRecordingProcess` (startRecording/stopRecording/quit; 15s/45s/1s timeouts) with the helper side in `native/swift/MediaCapture.swift`. S2/S4 code BridgeClient against those files, byte-for-byte on the wire framing. |

## Routing at the G2 flip (the flip increment — D-03, rev 2)

Config schema version 2: `{ "version": 2, "native": [...], "affinity": [...], "merge": [...], "fanout": [...] }` — loader fail-closed on: unknown version, overlap between lists, a session-scoped op in plain `native:[]`, an op in `affinity`/`merge`/`fanout` with no Swift handler registered, malformed JSON (boot-refusal, T-23). Version 1 configs stay valid verbatim (rollback target).

| Bucket | Ops | Behavior |
|---|---|---|
| `native` (sessionless, Swift serves all traffic) | G1's 5 + `recordTerminal`, `replayTerminal`, `computerUse` | Direct native dispatch |
| `affinity` (route by store-presence) | `createSession` (by TARGET: macos/`fake:`→native, web/sim→tunnel) · `snapshot` `observe` `act` `step` `llmStep` `walkthrough` `screenshot` `analyze` `discover` `startRecording` `stopRecording` (SessionStore presence) · `getSession` `getRun` `closeSession` `recordLlmUsage` (SessionStore presence) · `getRecording` (recording-registry presence via the RecordingOwnership protocol) | Store hit → native; miss → byte-tunnel (fail-safe: TS answers not_found for truly unknown ids, byte-transparent) |
| `merge` | `listSessions` | Union of Swift store + backend store, deterministic order (T-27) |
| `fanout` | `closeAllSessions` | native close + tunneled close, aggregated counts (T-27) |
| proxy (unlisted) | `recordComposite`, `demo`, `autoRampDemo` | Unchanged tunnel (G4) |

**Dispatch-plane consequences (SG-1 — this is S6's real surface, not just Router.swift):**
- (a) Affinity routing must decode the request envelope (extract `sessionId`/`recordingId`/`target`) BEFORE the route decision — v1's proxy path is a pure byte tunnel that never parses JSON. `route(for:)` becomes params-aware for affinity ops only; `native`/proxy buckets keep the parse-free fast path. Decode failure on an affinity op = deterministic `bad_request` (never a silent tunnel of garbage).
- (b) `merge`/`fanout` are NEW dispatch modes combining a native handler call with a backend call — new arms in SocketServer's dispatch switch (today `.native`/`.proxy` only, SocketServer.swift:156-159).
- (c) The `origin:` route log lands in SocketServer's private `logLine` (:248): route + store-hit/miss.
- (d) `merge`/`fanout` (and the dual-run path) need a ProxyClient variant that CAPTURES the backend response body — `tunnel()` returns only the status today (ProxyClient.swift:104). Rev-2 note: store-presence routing means tunneled `createSession` responses do NOT need parsing for ownership (the map is gone) — body capture is needed only for merge/fanout/dual-run.
- (e) `DualRunRecorder` (ProxyClient.swift:369) gains the new dual-run-eligible read ops.
- (f) Native `createSession`'s store insertion happens in `dispatchNative`'s result path — the session must be in the store before the response is written (routing race impossible by construction).

The v1 `sessionCoupledOps` denylist is superseded by construction: those ops move to `affinity`, where Swift serves ONLY sessions present in its own store — the split-brain the v1 denylist guarded against cannot occur for backend-owned sessions (they never resolve in Swift's store; they tunnel). The guard's spirit survives as the T-23 invariants. Restart semantics: an empty store tunnels everything — automatic, no state to lose (rev-2 improvement over the rev-1 map).

Standing note honored: `recordLlmUsage.result.entries` was flagged "weakest mask on record — re-examine when G2 touches usage recording" (rev 3.2). S7 re-derives that mask against the affinity-routed op (T-21 arm).

## Verification design (the G2 gate — three classes)

**V-A — Headless contract conformance (milestone-gated allowlist widening — SG-5).** ADR-06 seam: `SPECTRA_CONFORMANCE_SEED=1` additionally seeds FakeDriver-backed sessions in Swift (mirroring `tests/conformance/lib/fakes.ts` semantics — fixed element tree, deterministic act results, fixed PNG for screenshot), and createSession accepts a `fake:` target ONLY under the seed flag. **The `SWIFT_G1_VERIFIABLE_OPS` export name and the derived-skip-set semantics are KEPT (pin P4);** a milestone env gate — `SPECTRA_CONFORMANCE_MILESTONE=g2` [ASSUMED name, reversible], same widen-only pattern as `SPECTRA_CONFORMANCE_PROXY_FIDELITY` (external-mode.ts:91) — widens the exported set by the 13 headless-verifiable G2 ops: `snapshot observe act step llmStep walkthrough analyze discover screenshot createSession getRecording recordTerminal replayTerminal`. Default (env unset) stays byte-identical to G1 behavior, so the 4 importer test files (conformance.test.ts, capability-gate, external-mode.test.ts, corpus/corpus.test.ts) need ZERO edits and G1-only daemons still verify. `startRecording`/`stopRecording`/`computerUse` stay out of the headless allowlist for SUCCESS paths (real SCK/AX) but get dedicated headless **error-taxonomy arms** (not_found, recording_failed on non-macos session, permission_denied mapping, conflict on double-start, bad_request boundary values). recordTerminal (real PTY) and replayTerminal (fixture .cast) exercise their FULL real paths headlessly.

**V-B — Differential semantic parity, TS vs Swift (the adversarial gate).** Both legs drive identical deterministic fixtures: TS direct with its in-process FakeDriver seeds vs Swift front door with the ADR-06 seeds; recordTerminal runs a fixed command; replayTerminal parses the same committed cast. Comparison inherits the rev-3.5 machinery verbatim (byte-equality for deterministic ops; closed six-op class-pattern masks with typed guards; structural mode for `recordTerminal.timeline`; route fingerprint; per-run mask ledger + audit) **plus the pre-ruled G2 volatile-field map below (PC-3) — the whole map is ruled NOW, in this plan, so the fan-out never stops to re-litigate a foreseeable flake:**

### G2 volatile-field map (Advisor pre-ruling)

| Op / surface | Volatile field(s) — why | Pre-ruled treatment (class · guard) |
|---|---|---|
| act/observe/snapshot/step/llmStep/walkthrough | durations; `result.snapshot`/`finalSnapshot` embed FakeDriver `Date.now()` timestamps (fakes.ts:75-76); `screenshotPath` | rev-3.5 classes UNCHANGED (closed six-op set: duration · embedded-content · temp-path) **+ NEW structural floor on masked embedded-content** (below) |
| createSession | `result.sessionId` — each leg generates its own UUID | NEW `generated-id` cross-leg NORMALIZATION: leg-local session/recording ids mapped to stable tokens before compare · guard: non-empty string, referentially consistent within its leg. (`error.message` per-op mask stands) |
| screenshot | `result.path` (temp path — existing per-op mask); the PNG FILE bytes differ by construction (CoreGraphics re-encode vs TS encoder) | envelope compared as today; NEW `generated-image-content` artifact probe: both legs' files decode, equal pixel dimensions, non-empty · bytes NOT compared |
| recordTerminal | `result.timeline` (structural, rev 3.3) · `castFile` (temp-path) · `duration` (duration class) | existing classes. `outputSize`/`lines` are DETERMINISTIC for the fixed command — a flake there is a FINDING, not a mask |
| replayTerminal | none (fixed fixture) | pure byte-equality — rev 3.3's explicit exclusion stands |
| getRecording/getSession/getRun/listSessions (seeded reads) | `updatedAt`/`createdAt`/`startedAt` leaves — the rev-3.5 "named-but-not-pre-approved claimant" | `stateful-read-timestamp` class **CONDITIONALLY pre-approved by this ruling**: auto-applies on first OBSERVED flake (observed-need preserved — the mask activates on evidence, the ruling is already written) · ledger `mode: class-pattern` · guard: number > 0 or ISO string, both legs |
| analyze/discover | none expected (deterministic scoring over FakeDriver) | byte-equality; flake = FINDING |
| computerUse/startRecording/stopRecording (headless legs) | error-taxonomy arms only | byte-equality on error shapes (code + status; message per existing free-text class rules) |

**Structural floor for masked embedded-content (PC-4 tightening):** element count equal · role sequence equal · labels equal after id normalization · **bounds are numeric 4-tuples with non-negative width/height · `enabled` boolean and `actions` string-array type parity · `value` presence parity.** A masked field may not hide a semantic divergence. Any volatile path OUTSIDE this map = stop, Advisor ruling, citing rev 3.5 precedent. Acceptance: **3 consecutive fully-green chains** (each including the G1 31/31 arm + B-e2e).

**V-C — On-device native-integration gate (user-present, scripted, once before flip — T-25, 9 steps rev 2).** Ordered script (`verify-g2-ondevice.sh`), each step emitting red/green evidence to `.build-loop/flip-evidence/gate-g2-ondevice.txt`: (1) **TCC-attribution probe under the PRODUCTION launch context** — the daemon-core launched via its launchd plist (not a dev shell) spawns the AX helper + screen-recording preflight; both probes return `granted` (falsifier for ND-2; on failure ADR-05's fallback rung fires: stable signing identity + user re-grant); (2) createSession(macos) against the repo's `native/swift/TestApp` → real AX snapshot, ≥1 actionable element; (3) `act` press on a TestApp button, state change verified by re-snapshot; (4) `computerUse` snapshot + act vs TestApp; (5) `screenshot` full → non-empty decodable non-black PNG; (6) `startRecording`→`stopRecording` on the TestApp window → mp4 exists, probeVideo succeeds, black-frame guard passes; (7) `discover`/`walkthrough` one-pass against TestApp; **(8) `observe` + `analyze` on the TestApp session — element scoring/state detection over a REAL AX tree; (9) `step` with an intent resolving a TestApp control + a 1-action `llmStep` plan executed natively.** With steps 8–9, every one of the 16 ops' native path is either V-C-exercised or an explicit classed excluded-set entry — no op ships native on FakeDriver evidence alone (PC-4). Both-ways-fail discipline: anything the host cannot do that day is a classed excluded-set entry, audited — never a silent skip.

**Residual risk, honestly scoped (PC-4):** V-C exercises each native path once, on one app, on one host — it proves reachability + integration, not distributional behavior. The standing mitigations are W0's BEHAVIORAL protocol freeze (FakeDriver and NativeDriver conform to the same written semantics, so the fake cannot drift into a private dialect) and S3's TS-test-vector XCTest ports running against FakeDriver in CI-shape runs.

**Why this three-class design is sound (the falsifier for the design itself):** V-A alone could pass with a Swift port that never touches real AX (fake-driver overfit) — V-C exists to kill that, now over all 16 ops. V-C alone is a one-shot manual pass — V-A/V-B keep every regression thereafter caught headlessly. V-B catches semantic drift between the TS and Swift implementations of resolve/intelligence/serialize — the class where compile-green hides real bugs (G1 convicted 2 such bugs; the heuristic-engine ports are G2's analog risk surface).

## Work items (MECE parallel batch — machine-readable, rev 2)

`parallel_batch: m3-g2-wave-1` · `parallel_skipped_reason: none` — W0 serial interface-freeze, then 7 parallel Sonnet implementers (S1–S7) with disjoint owned-file sets (S6 owns the dispatch plane: Router+SocketServer+ProxyClient+HandlerRegistry+main; S1–S5 export `register(into:)`; all 16 handlers owned). Machine-readable record below.

```yaml
parallel_batch: m3-g2-wave-1
pre_step:
  id: W0
  dispatch_tier: sonnet   # bounded interface authorship; Advisor reviews before fan-out
  goal: >
    Freeze, in DriverProtocol.swift (code + doc-comment contracts), ALL cross-agent symbols (SG-3):
    (a) the Driver protocol — method signatures AND behavioral contracts (act on unknown/stale element
    returns success:false + fresh snapshot, never throws; snapshot element ids sequential e1..eN per
    snapshot; screenshot returns PNG data; connect validates target) so FakeDriver (S1) and NativeDriver
    (S2) cannot diverge semantically (PC-4);
    (b) the concrete DriverRegistry class (get/set/remove by sessionId, single-writer) — declared here,
    populated by S1, consumed by S3/S4;
    (c) the DaemonContext extension contract — exact field names/types S6 adds to DaemonContext in
    HandlerRegistry.swift (driverRegistry, recordingOwnership, sessionStore access) — written here,
    landed by S6 as its first slice;
    (d) SessionStore's frozen public write surface for S3/S4: addStep/addDecision/addArtifact/
    setRecordingStatus + a PUBLIC sessionDir(_:) accessor (today private sessionDirLocked,
    SessionStore.swift:590 — S1 exposes);
    (e) the 5 register-hook signatures S6 wires: registerConnectOps / registerAxOps / registerStepOps /
    registerCaptureRecordingOps / registerTerminalOps — exact names frozen;
    (f) the NativeDriver factory signature S1 calls (makeNativeDriver(appName:) throws -> Driver) and the
    one-method RecordingOwnership protocol (ownsRecording(_:) -> Bool; S4 implements, S6 consumes).
    Plus: D-03 v2 config schema doc; mapping-doc count fix; rally handoff to Codex (M4's CdpDriver
    implements the frozen protocol; post-freeze changes need an Advisor ruling).
  owned_files: [macos/Spectra/DaemonCore/DriverProtocol.swift, docs/plans/m3-op-group-mapping.md]
agents:
  - id: S1
    name: session-driver-core
    dispatch_tier: sonnet
    goal: createSession target-split handler; session run/step/artifact/recording-status model on SessionStore (incl. the W0-frozen public write surface + public sessionDir); FakeDriver + seed-hook widening (ADR-06); DriverRegistry population
    owned_files: [macos/Spectra/DaemonCore/ConnectOps.swift, macos/Spectra/DaemonCore/FakeDriver.swift, macos/Spectra/DaemonCore/SessionStore.swift, macos/Spectra/DaemonCore/SessionOps.swift]
    note: SessionOps.swift/SessionStore.swift G1 pin lifted per ADR-07 — S1 is the named single owner this rev
  - id: S2
    name: ax-engine
    dispatch_tier: sonnet
    goal: BridgeClient (stdio JSON-RPC per src/native/bridge.ts + core-impl NativeRecordingProcess contracts, ADR-05); NativeDriver (W0 factory); role-normalization + snapshot-serialization ports; the snapshot and act OP HANDLERS (SG-4 — pure driver passthrough + serialization, which S2 owns); computerUse ops + AX error mapping (permission_denied parity)
    owned_files: [macos/Spectra/DaemonCore/BridgeClient.swift, macos/Spectra/DaemonCore/NativeDriver.swift, macos/Spectra/DaemonCore/RoleNormalize.swift, macos/Spectra/DaemonCore/SnapshotSerialize.swift, macos/Spectra/DaemonCore/SnapshotOps.swift, macos/Spectra/DaemonCore/ActOps.swift, macos/Spectra/DaemonCore/ComputerUseOps.swift]
  - id: S3
    name: step-intelligence-engine
    dispatch_tier: sonnet
    goal: resolve/actions ports (intent matcher, action selection); step/llmStep/walkthrough/observe handlers (observe = composition, stays here); intelligence ports (importance/states/framing); analyze/discover handlers — behavior-parity with TS proven by ported TS test vectors as XCTest + V-B, not by eyeball
    owned_files: [macos/Spectra/DaemonCore/Resolve.swift, macos/Spectra/DaemonCore/Actions.swift, macos/Spectra/DaemonCore/StepOps.swift, macos/Spectra/DaemonCore/Intelligence.swift, macos/Spectra/DaemonCore/AnalyzeOps.swift, macos/Spectra/DaemonCore/DiscoverOps.swift]
  - id: S4
    name: media-recording
    dispatch_tier: sonnet
    goal: screenshot handler (modes full/element/region/auto; CoreGraphics PNG decode/crop/encode; artifact writes); startRecording/stopRecording/getRecording orchestration + registries (implements RecordingOwnership); cursor-sampler client; shelled ffmpeg probes
    owned_files: [macos/Spectra/DaemonCore/CaptureOps.swift, macos/Spectra/DaemonCore/RecordingOps.swift, macos/Spectra/DaemonCore/FfmpegProbe.swift]
  - id: S5
    name: terminal
    dispatch_tier: sonnet
    goal: recordTerminal (openpty + cast writer + timeline, multi-recorder port) and replayTerminal (cast parser/search/commands) — both fully headless-verifiable
    owned_files: [macos/Spectra/DaemonCore/TerminalOps.swift, macos/Spectra/DaemonCore/CastParser.swift]
  - id: S6
    name: router-v2-dispatch-plane
    dispatch_tier: sonnet
    risk_reason: runtime protocol
    goal: >
      Router v2 loader (fail-closed per D-03 invariants) + params-aware route(for:) (SG-1a);
      SocketServer dispatch: merge/fanout arms in the dispatch switch (:156-159), pre-route envelope
      decode for affinity ops, origin in logLine (:248), native-createSession store insertion in
      dispatchNative's result path; ProxyClient: body-capturing tunnel variant for merge/fanout +
      DualRunRecorder widening; DaemonContext extension per W0 (c); HandlerRegistry + main.swift wiring
      of the 5 W0-frozen register hooks; flip config file
    owned_files: [macos/Spectra/DaemonCore/Router.swift, macos/Spectra/DaemonCore/SocketServer.swift, macos/Spectra/DaemonCore/ProxyClient.swift, macos/Spectra/DaemonCore/HandlerRegistry.swift, macos/Spectra/DaemonCore/main.swift]
  - id: S7
    name: gate-harness
    dispatch_tier: sonnet
    goal: >
      external-mode: milestone env gate widening (KEEP the SWIFT_G1_VERIFIABLE_OPS export name +
      derived skip-set; default byte-identical; the 4 importer test files need ZERO edits — SG-5);
      fixture-context: fake-target seeding path; front-door.ts: APPEND-ONLY FrontDoorHarnessOptions
      (routingConfig override + extraEnv) with the v1-pinned PRODUCTION_ROUTING_CONFIG default KEPT
      so Gate-B's G1 regression stays byte-identical (SG-2); payload-generator.ts: seed-gated fake:
      branch in the 'target' case (:79-87) so the generic suite exercises Swift's native createSession;
      verify-g2-suite.ts (V-A + V-B runner: rev-3.5 comparator + the pre-ruled G2 map: generated-id
      normalization, image artifact probe, structural floor, conditional stateful-read-timestamp);
      verify-g2-ondevice (9-step V-C script + TCC-spike runner); recordLlmUsage mask re-derivation
    owned_files: [tests/conformance/lib/external-mode.ts, tests/conformance/lib/fixture-context.ts, tests/conformance/lib/front-door.ts, tests/conformance/lib/payload-generator.ts, macos/Spectra/DaemonCore/verify-g2-suite.ts, macos/Spectra/DaemonCore/verify-g2-ondevice.sh, macos/Spectra/DaemonCore/verify-g2-ondevice.ts]
merge_plan: >
  Opus integrates (registry wiring conflicts impossible by construction — S1–S5 export the 5 W0-frozen
  register hooks, only S6 edits HandlerRegistry/SocketServer/ProxyClient/main). TCC spike (T-25 step 1,
  production launch context) runs as soon as S2's BridgeClient + S7's probe runner land — BEFORE S2/S4
  success-path acceptance. Then V-A → V-B ×3 → V-C (user present) → Fable group verdict → flip commit →
  Gate E2 (user pause).
```

Every file above is owned by exactly one agent (all 16 op handlers now have named owners — snapshot/act to S2, SG-4); no G2 agent touches TS `src/` production code, the frozen contract, the 4 allowlist-importer test files, or the still-pinned GUI/daemon-runner files. ✅ MECE by construction.

## Commit table

| # | Commit subject | Owner | Depends on |
|---|---|---|---|
| C1 | docs(plans): m3-g2 spec rev 2 (critic-hardened) | Advisor | — |
| C2 | feat(daemon-core): W0 freeze — Driver protocol + behavioral contracts + shared symbols + v2 schema; mapping-doc fix | W0 | C1 |
| C3 | feat(daemon-core): session/driver core — createSession target-split, run model, public write surface, FakeDriver seed | S1 | C2 |
| C4 | feat(daemon-core): AX engine — bridge client, NativeDriver, snapshot/act handlers, computerUse | S2 | C2 |
| C5 | feat(daemon-core): step engine + intelligence — step/llmStep/walkthrough/observe/analyze/discover | S3 | C2 |
| C6 | feat(daemon-core): screenshot + recording ops (RecordingOwnership) | S4 | C2 |
| C7 | feat(daemon-core): terminal record/replay | S5 | C2 |
| C8 | feat(daemon-core): Router v2 store-presence affinity + SocketServer merge/fanout dispatch + ProxyClient body-capture/dual-run + registry wiring | S6 | C3 (store model), C2 |
| C9 | test(conformance): milestone-gated allowlist + harness options + fake-target + differential/on-device gate runners | S7 | C2 (runs against C3–C8 as they land) |
| C10 | chore(flip): G2 routing flip (config v2 active) | Opus | pre-flip acceptance complete (T-20..T-27, V-B ×3, T-25 evidence incl. TCC step) |
| C11 | test(conformance): Swift-baseline corpus refresh (post-verdict rule) | S7 | C10 |

## F-Criteria (functional)

| ID | Criterion | Pass condition | Falsifier (what proves it failed) | Grader |
|---|---|---|---|---|
| T-20 | Headless contract conformance (V-A) | Suite vs Swift front door under `SPECTRA_CONFORMANCE_MILESTONE=g2`: 0 failed; error-taxonomy arms green; boundary-value/param-validation arms green; **with the milestone env UNSET the run is byte-identical to G1 behavior and the 4 importer files show zero diff** | any RED; a claimed-headless G2 op silently skipped; wrong error code/status; any importer-file edit (scope breach); default-mode behavior change | vitest external-mode |
| T-21 | Differential semantic parity (V-B) | 3 consecutive fully-green chains; deterministic ops byte-equal; pre-ruled G2 map applied with typed guards + structural floor; generated-id normalization referentially consistent; image artifact probe green; ledger audited | unmasked divergence outside the pre-ruled map; a mask/normalization hiding structural drift (count/role/label/bounds/type); a deterministic-set flake; class hit at envelope level | verify-g2-suite.ts |
| T-22 | Route fingerprint | Native-served G2 ops show the native fingerprint; proxied legs carry backend metadata both legs | a "native" op secretly tunneled, or vice versa | verify-g2-suite.ts |
| T-23 | v2 loader fail-closed | Boot-refusal on: unknown version; session-scoped op in plain native:[]; affinity/merge/fanout op with no registered handler; list overlap; malformed JSON. Each proven by a red boot attempt. v1 config still boots (rollback path) | daemon boots under any invalid config; v1 config rejected | XCTest + suite |
| T-24 | Store-presence routing | Swift-created (fake:/macos) session → native serve (fingerprint); backend-created (web) → byte-transparent tunnel; unknown sessionId → tunneled not_found passthrough; createSession target-split arms; affinity-op envelope-decode failure → bad_request (never a tunnel); G4-degradation arm: recordComposite w/ Swift-owned sessionId still records, no 500 | any cross-serve; a Swift answer for a backend session; a tunnel mutation; garbage tunneled on an affinity op | verify-g2-suite.ts |
| T-25 | On-device native-integration (V-C, 9 steps) | All 9 scripted steps green with evidence file — step 1 (TCC probe) executed under the launchd/plist production context; steps 2–9 cover every G2 op's native path (or classed exclusions) | any step red without a classed excluded-set entry; step 1 run from a dev shell (invalid — must be production context); evidence file absent | verify-g2-ondevice.sh + user |
| T-26 | Capability-gate parity | The 16 ops registered in CapabilityPolicy; manual mutation (remove assert → RED, restore → GREEN) evidence on file, GV-4a style | mutation does not bite (gate decorative) | manual mutation + suite |
| T-27 | Merge/fan-out semantics | listSessions = deterministic union (both-store fixture, ×5 order-stable); closeAllSessions closes both sides, counts aggregate; body-capturing tunnel variant proven byte-faithful on the captured leg | order instability; a session listed twice or dropped; fan-out leaves a side open; capture variant mutates the tunneled bytes | vitest |
| T-28 | Post-flip soak + rollback (Gate E2) | live flip, dual-run soak rows for new dual-run-eligible ops, rogue-daemon detector quiet, rollback drill v2→v1 executed <2 min | rollback exceeds 2 min or leaves mixed routing | drill script + user |

## Q-Criteria (quality)

| Criterion | Pass condition | Grader |
|---|---|---|
| swiftc | daemon-core compiles clean (swiftc 6.2.4, all files) | build |
| tsc | `tsc --noEmit` exits 0 (harness additions only) | CI |
| Mask-ledger audit | class/normalization entries ⊆ the pre-ruled G2 map + rev-3.5 classes; resolved paths beneath `result.`; typed guards executed; growth WARNs examined; conditional stateful-read-timestamp activations evidenced; recordLlmUsage mask re-derived, no weaker than rev 3.2 | Fable verdict |
| Excluded-set audit | every V-A/V-C exclusion classed + justified; count monotonicity explained | Fable verdict |
| Importer-file freeze | `git diff` over conformance.test.ts / capability-gate / external-mode.test.ts / corpus.test.ts = empty (SG-5) | CI grep |
| No dormant code | FakeDriver + fake-target reachable only under SPECTRA_CONFORMANCE_SEED=1; absent from production dispatch (grep + T-23 arm) | suite + review |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| TCC attribution: helpers spawned by the Swift daemon don't inherit usable grants under the PRODUCTION launch context (ND-2 ⚠️ unverified) | medium | Spike = T-25 step 1, runs as soon as S2 BridgeClient + S7 probe runner land, under the launchd plist (PC-2); S2/S4 success-path acceptance is CONDITIONAL on spike green; fallback rung = stable signing identity + user re-grant (ADR-05) |
| Semantic drift in the heuristic ports (resolve/importance/states/framing) — compile-green, behavior-wrong | high (largest port surface) | W0 behavioral protocol freeze; S3 ports TS test vectors as XCTest; V-B structural floor + byte-compare on deterministic fixtures; V-C steps 8–9 |
| Affinity pre-route envelope decode adds a parse to hot paths | low | decode fires ONLY for affinity-bucket ops (native/proxy buckets keep the byte-tunnel fast path); latency parity criterion carries over from rev 3.1 |
| listSessions merge divergence under concurrent close | low | merge reads are store snapshots; T-27 ×5; deterministic ordering rule |
| G1 chain regression while G2 lands | low | every V-B chain includes the full G1 31/31 arm + B-e2e; front-door default stays v1-pinned (SG-2) |
| Codex/M4 builds against a drifting driver interface | medium | W0 freezes signatures AND behavioral contracts in C2 + rally handoff; post-freeze changes need an Advisor ruling |
| Scope: ~16.3k LOC TS behavioral surface, G2 is the bulk | medium | MECE partition + per-item acceptance; anything not green stays proxied (per-bucket flip reversible by config) |

## Activation Map

- **Router v2 + dispatch plane (F-16)** — trigger: daemon boot with `SPECTRA_ROUTING_CONFIG` pointing at the v2 flip config (C10); verified-live: SocketServer log shows configSource + route/origin decisions on real traffic during Gate E2 soak.
- **createSession native (macos) (F-10)** — trigger: first real `spectra_connect` to a macOS app post-flip; verified-live: native fingerprint + AX snapshot returned (T-25 step 2 pre-proves; soak row confirms).
- **Capture/AX handlers (F-11..F-13)** — trigger: store-presence dispatch on Swift-created sessions; verified-live: dual-run/soak JSONL rows per op with zero unexplained divergence.
- **Terminal ops (F-15)** — trigger: `native:[]` membership at C10; verified-live: recordTerminal produces a playable .cast on a real invocation post-flip.
- **FakeDriver seam (ADR-06)** — trigger: `SPECTRA_CONFORMANCE_SEED=1` only (never production); verified-live: N/A by design — the activation-path check instead proves it CANNOT activate in production (T-23 arm + grep evidence).
- **On-device gate script** — trigger: run once pre-flip with user present; verified-live: evidence file committed.

## ADRs

### ADR-04 — Routing config v2: session-affinity via STORE-PRESENCE (low-reversibility)
**Increment selection (Pugh, unchanged from rev 1):** (a) wait for M4, flip all 16 per-op — rejected: blocks G2 on an idle external workstream, contradicts the verified single-seam finding; (b) per-target sub-routing only — rejected: split-brain for web sessions, exactly what the v1 denylist prevents; (c) **session-affinity (chosen, user-approved ND-1)**.
**Within-affinity mechanism (rev-2 Pugh, PC-1):** (i) explicit ownership map (rev-1 design) — rejected: D-02 as a map is DUPLICATED state (the SessionStore/recording registry already knows what Swift owns), adds a create-vs-first-op write race and restart semantics that store-presence gets for free, and requires parsing tunneled createSession responses (a new ProxyClient obligation with its own failure mode); (ii) origin-encoded session ids (e.g. a `swift-` prefix) — rejected: stateless and restart-proof, but it changes the wire-visible id format (corpus/conformance byte-diffs against a hash-frozen contract), cannot retro-encode TS-created ids (asymmetric), and couples routing correctness to a client-visible string a stale client could craft; (iii) **store-presence (ADOPTED): a lookup in Swift's own SessionStore (sessions) / recording registry (recordings) IS the ownership signal — hit→native, miss→tunnel.** Behaviorally identical to the map's fail-safe ("unknown→tunnel"), zero new state, race-free by construction (the session is in the store before createSession's response is written), restart-trivial (empty store tunnels everything). The map's only residual advantage — logging "backend" vs "never-seen" — is observability, not correctness; the log records hit/miss. **Tradeoffs:** merge/fan-out ops lose pure byte-tunneling (Swift-computed — T-27); affinity ops pay an envelope decode pre-route (scoped to the affinity bucket). **Rollback:** config v2→v1 restores G1 routing verbatim (<2 min drill, T-28); no ownership state exists to migrate or discard.

### ADR-05 — Native machinery via existing helper subprocesses, not in-process frameworks (low-reversibility for TCC)
**Alternatives:** in-process AXUIElement + ScreenCaptureKit in daemon-core — rejected for G2: new TCC surface on an ad-hoc-signed, frequently-recompiled binary (grants are per-code-signature; every rebuild would orphan them), larger port, discards proven code. **Chosen:** spawn the same helpers the TS daemon spawns today over their existing stdio contracts. **Contract sources (PC-7):** AX bridge — `src/native/bridge.ts` (client framing, ping handshake, 5s timeouts, 30s heartbeat) ↔ `native/swift/main.swift`/`AXBridge.swift`; recording — `src/daemon/core-impl.ts` `NativeRecordingProcess` (startRecording/stopRecording/quit, 15s/45s/1s timeouts) ↔ `native/swift/MediaCapture.swift`; window list — CompositeCapture `--list-windows` (already live in G1). **Open risk:** TCC attribution from the Swift-daemon parent ⚠️ untested → T-25 step 1 spike, run under the launchd production context (PC-2 — dev-shell green does not transfer); fallback: stable signing identity for daemon-core + one-time re-grant (user action). **Rollback:** none needed pre-flip; post-flip = config rollback.

### ADR-06 — FakeDriver conformance seam in the Swift daemon (reversible, but a standing test contract)
An external daemon has no in-process seam (the reason Tier-2 seeding exists). G2 needs the orchestration layer verified headlessly, so the Swift daemon mirrors the harness's own FakeDriver under `SPECTRA_CONFORMANCE_SEED=1` + `fake:` target. **Alternatives:** real headless Chrome via CDP (blocks on M4); TestApp AX (blocks on TCC/GUI — V-C's job). **Guards:** unreachable without the env flag; T-23 proves a production boot cannot dispatch to it; **both drivers conform to W0's written behavioral contracts, so the fake cannot drift into a private dialect (PC-4).** Fake fixtures mirror `tests/conformance/lib/fakes.ts` exactly (including its `Date.now()` volatility, which the pre-ruled map handles) so V-B compares like against like.

### ADR-07 — G1 pin lift for SessionOps.swift / SessionStore.swift (governance)
G1 rev-2 pinned these as never-edit to protect the frozen G1 surface. G2's session model REQUIRES extending them (including making `sessionDir` public — today `sessionDirLocked` is private, SessionStore.swift:590). The pin is lifted for this rev only, with S1 as the single named owner, and the G1 conformance arm (31/31) in every V-B chain as the non-regression proof. PermissionOps.swift/LibraryOps.swift/SpectraViewModel.swift/daemon-runner.ts pins REMAIN in force (no G2 agent owns them).

## Env Contract (internal deltas)

- `SPECTRA_ROUTING_CONFIG` — now accepts version 2 (schema in D-03); version 1 remains valid (G1 behavior, rollback target).
- `SPECTRA_CONFORMANCE_SEED=1` — widened: also seeds FakeDriver-backed sessions + enables the `fake:` createSession target. Never set in any plist (harness env only — G1 rev-3 rule carries over).
- `SPECTRA_CONFORMANCE_MILESTONE` [ASSUMED name, reversible] — widen-only allowlist gate (`g2` adds the 13 headless G2 ops to the exported `SWIFT_G1_VERIFIABLE_OPS` set); unset = byte-identical G1 behavior. Read at module load only, same as the proxy-fidelity flag.
- `SPECTRA_CONFORMANCE_FAKE_TARGET` [ASSUMED name, reversible] — optional override for the fake target string; read at module load only.
- `SPECTRA_CONFORMANCE_PROXY_FIDELITY` — unchanged (widen-only, T-02-style harness caller).

## Assumptions

- [ASSUMED] Restart semantics under store-presence (empty store → everything tunnels; Swift-owned in-memory sessions lost, parity with TS in-memory loss today) are acceptable — no persistence requirement for G2.
- [ASSUMED] The stdio JSON-RPC contracts of the native helpers are stable enough to code BridgeClient against as-is (exercised daily by the live TS daemon); any needed helper change is a FINDING routed to the Advisor, not a silent edit.
- [ASSUMED names, reversible] `SPECTRA_CONFORMANCE_MILESTONE`, `SPECTRA_CONFORMANCE_FAKE_TARGET`.
- [ASSUMED] The host machine keeps its current accessibility/screen-recording grants for the existing helper binaries through the G2 window (T-25 step 1 re-probes at gate time, under the production launch context).

## Spec Object (JSON)

```json
{
  "needs": [
    {"id": "U-04", "priority": "P0", "text": "Capture/AX ops served natively by the Swift daemon-core, advancing TS-daemon retirement without blocking on M4/M5", "tests": ["T-20", "T-21", "T-24", "T-25"]}
  ],
  "features": [
    {"id": "F-10", "text": "createSession target-split + session run model (public write surface + sessionDir) + FakeDriver seed + DriverRegistry population", "owner": "S1", "adrs": ["ADR-06", "ADR-07"], "tests": ["T-20", "T-24"]},
    {"id": "F-11", "text": "AX engine: bridge client, NativeDriver, snapshot/act op handlers, computerUse", "owner": "S2", "adrs": ["ADR-05"], "tests": ["T-20", "T-21", "T-25"]},
    {"id": "F-12", "text": "Step + intelligence engines (resolve/actions/importance/states/framing) and step/llmStep/walkthrough/observe/analyze/discover", "owner": "S3", "tests": ["T-20", "T-21", "T-25"]},
    {"id": "F-13", "text": "Screenshot modes + artifact writes", "owner": "S4", "tests": ["T-20", "T-21", "T-25"]},
    {"id": "F-14", "text": "startRecording/stopRecording/getRecording + registries (RecordingOwnership) + shelled probes", "owner": "S4", "adrs": ["ADR-05"], "tests": ["T-20", "T-25"]},
    {"id": "F-15", "text": "recordTerminal/replayTerminal (PTY + cast)", "owner": "S5", "tests": ["T-20", "T-21"]},
    {"id": "F-16", "text": "Router v2 store-presence affinity + SocketServer merge/fanout dispatch + ProxyClient body-capture/dual-run + DaemonContext extension", "owner": "S6", "adrs": ["ADR-04"], "tests": ["T-23", "T-24", "T-27"]},
    {"id": "F-17", "text": "G2 verification harness: milestone gate, harness options, fake-target payload branch, V-A/V-B/V-C runners", "owner": "S7", "tests": ["T-20", "T-21", "T-22", "T-25"]},
    {"id": "F-18", "text": "Capability registration + server-side param validation parity for the 16 ops", "owner": "S1-S6 per-handler, audited by S7", "tests": ["T-20", "T-26"]}
  ],
  "data": [
    {"id": "D-02", "text": "Store-presence ownership signal: SessionStore membership (sessions) / recording-registry membership via RecordingOwnership (recordings) IS the affinity routing signal — no separate ownership state (ADR-04 addendum)", "tests": ["T-24"]},
    {"id": "D-03", "text": "routing config schema v2 {version:2, native, affinity, merge, fanout} with fail-closed loader invariants; v1 stays valid (rollback)", "tests": ["T-23"]},
    {"id": "D-04", "text": "Swift session run model: steps, decisions, artifacts, recording status (contract-shape parity with src/core/session.ts records)", "tests": ["T-20", "T-21"]}
  ],
  "tests": ["T-20", "T-21", "T-22", "T-23", "T-24", "T-25", "T-26", "T-27", "T-28"],
  "adrs": ["ADR-04", "ADR-05", "ADR-06", "ADR-07"],
  "novel_decisions_approved": {"by": "user (orchestrator-relayed)", "date": "2026-07-03", "ids": ["ND-1", "ND-2", "ND-3", "ND-4", "ND-5"], "rev2_refinements": ["ND-1: store-presence impl (PC-1)", "ND-2: spike after S2+S7, production launch context (PC-2)"]}
}
```

## Sequencing recommendation (rev 2)

1. **C1/C2 now** (spec rev 2 + W0 full freeze; post the Codex/M4 rally handoff same day — Codex is idle, the frozen protocol is what unblocks M4 usefully).
2. **Wave-1 fan-out S1–S7** (7 parallel Sonnet-5 implementers, MECE files) → **TCC spike as soon as S2's BridgeClient + S7's probe runner land, under the launchd production context** (PC-2); S2/S4 success-path acceptance is conditional on spike green — if it fails, the ADR-05 fallback rung (signing + re-grant) fires before V-C.
3. Opus integration → **V-A → V-B ×3 → V-C 9-step (user present) → Fable group verdict → C10 flip → Gate E2 soak + rollback drill** (pauses for user).
4. G3 = web sessions created native when M4 lands + is accepted (pure widening); G4 = M5. Neither reopens this plan.

## Out of Scope (mirror)

M4/CDP-native web serving · M5/G4 pipeline ops · sim-native serving · GUI · signing/notarization (except the ADR-05 fallback rung — user decision) · TS backend edits · the 4 allowlist-importer test files · volatility treatment beyond §Volatile-field map without an Advisor ruling · retiring TS suites.
