# Spectra Native-Swift Migration Plan

- **Status:** REVISED DRAFT v2 — plan-critic findings F1–F5 applied; awaiting re-critique + user ratification
- **Date:** 2026-07-01 (rev. same day) · **Tier:** Phase 2 plan synthesis (Fable)
- **Inputs:** Phase 1 Assess verdicts (adopted verbatim); repo survey 2026-07-01; plan-critic verdict (needs-rework, F1–F5)
- **Beachhead (verified, not greenfield):** `macos/` XcodeGen menu-bar app — `Spectra.xcodeproj`, `project.yml` (bundle `dev.spectra.app`, v0.3.0, LSUIElement, hardened runtime, team Q6TB8685V9, macOS 14.0 target, Swift 5.10), 27 Swift files / 4,186 LOC across Daemon/LLM/Net/Storage/Views. Plus `native/swift/` — 5,758 LOC of bare-swiftc capture/AX/vision/composite/cursor/sim helpers. This plan **extends `macos/` and re-homes `native/swift/` into it**.

---

## Goal

Migrate Spectra's runtime core from TypeScript to native Swift inside the existing `macos/` XcodeGen project, delivering a single signed-and-notarized `Spectra.app` that owns capture, accessibility, the daemon, web capture, and polish orchestration — while every external client keeps working unchanged behind the **frozen JSON-RPC contract** (`src/contract/contract.snapshot.json`: apiVersion, 30 operations, errorCodes, envelopes, routes). The TS daemon is not deleted until the Swift daemon has proven behavioral identity **operation-group by operation-group** against a purpose-built parity oracle: an **enriched machine-checkable contract spec** + a **socket-level conformance suite** + a **dual-run request/response corpus** (built in M1/M2B, before any cutover).

**Oracle correction (F1):** the prior draft claimed the existing 78-file vitest suite as the black-box parity oracle. Verified false: 74/78 test files import TS internals in-process (`tests/daemon/server.test.ts` constructs `createDaemonRequestHandler` with a fake CoreApi; `tests/daemon/core.test.ts` imports `createDaemonCore`/`CoreApiImplementation`); the only socket-level tests (`tests/mcp/forward.test.ts`) hit a mock daemon (`tests/helpers/mock-daemon.ts`); no `SPECTRA_DAEMON` switch exists anywhere in the repo; and `contract.snapshot.json` captures **names only** (operation + param names, envelope key lists, flat error list — no types, optionality, zod defaults/coercion, result shapes, or op→error mapping). The vitest suite is therefore reframed as the **TS-internal regression suite** — it guards the TS reference implementation while it lives and is **not** the cross-language gate. The cross-language gate is built, validated by mutation, and only then trusted.

## Non-goals

- **No ffmpeg → AVFoundation port** this migration. ffmpeg stays shelled from Swift. (Locked decision; the temptation is a named risk, R3.)
- **No big-bang rewrite.** The daemon cutover is a strangler: a per-operation routing table moves op-groups to Swift one at a time; TS paths stay live until their group passes the oracle.
- **No web-ui rewrite.** Next.js `web-ui/` is kept through the migration; convergence on an MCP-App dashboard starts in M6 and completes after this plan.
- **No Swift MCP server** now. The MCP layer stays a thin TS shim (Swift MCP SDK is Tier-3/lagging; revisit **2026-07-28**).
- **No `.spectra/` storage-layout changes.** It is the frozen cross-language seam.

## Locked decisions (from Phase 1 Assess — restated, not re-litigated)

| Decision | Locked choice |
|---|---|
| ffmpeg | Shell from Swift (not AVFoundation) |
| Pillow | Replace with CoreText |
| MCP server | TS shim forwarding to Swift daemon; revisit Swift SDK 2026-07-28 |
| Web capture | Hand-rolled CDP client ported to Swift, driving real system Chrome (not WKWebView) |
| web-ui | Keep Next.js; MCP App later |
| Packaging | `.app` bundle **non-negotiable** (macOS 26.1 privacy-UI rule) |
| Foundation Models | OPTIONAL mixed-compute grounding/narration; AX-first stays primary; never gates a milestone |
| Build system | Existing XcodeGen project. Heed: **compile ALL targets** every build; watch SourceKit ghosts on newly added files |

---

## Scope map — every `src/` module accounted for (F4)

| Module | LOC | Disposition |
|---|---|---|
| `src/daemon/` + `src/contract/` | 5,867 | Ported in M3 (contract stays the frozen spec source; enriched in M1) |
| `src/mcp/tools/` (13 handlers) | 1,827 | **Part of the daemon port surface** — `src/daemon/core-impl.ts` imports all 13; they execute daemon-side, so they port with their op-group in M3 |
| `src/core/` | 1,392 | Ported in M3 (transitive dependency of the tool handlers — session/normalize/resolve/storage) |
| `src/intelligence/` | 1,534 | Ported in M3 (analyze/discover/framing handlers depend on it) |
| `src/computer-use/` | 861 | Ported in M3 (behind `core-impl`'s computerUse op) |
| `src/library/`, `src/terminal/`, `src/native/`, `src/launcher/` | 2,440 | Daemon-side seams (library/record/replay ops, binary invocation) — ported with their op-group in M3; definitive assignment comes from the M3 import-graph task |
| `src/cdp/` | 951 | Ported in M4 (feeds M3 group G3) |
| `src/pipeline/` + `src/media/` | ~5,668 | Ported in M5 (feeds M3 group G4) |
| `src/mcp/` (transport + registry, minus tools) | — | **Stays TS** — the thin MCP shim (M6); tools move daemon-side per above |
| `src/client/` | 459 | **Stays TS** — daemon socket client used by the shim + CLI; talks only the frozen contract |
| `src/cli/` | 253 | **Stays TS** — thin argv→daemon forwarder ("imports NO core" by design); rides the shim's node dependency; revisit at the 2026-07-28 MCP SDK check |
| `web-ui/` | — | Out of scope (locked: keep Next.js) |

**M3 LOC framing corrected (F4):** the true daemon behavioral surface is **not** 5,867 LOC — it is daemon+contract **plus** the tool handlers and their transitive imports (≈1,827 + 1,392 + 1,534 + 861 + 2,440 ≈ **~13.9k LOC total**). This is exactly why M3 is decomposed (F2) rather than shipped as one XL milestone.

---

## Deliverables — "Done ="

1. **Single signed + notarized `Spectra.app`** (bundle `dev.spectra.app`) containing the daemon, capture/AX/vision helpers, CoreText renderer, CDP client, and polish orchestration. No bare-swiftc binaries in the shipped path.
2. **All registered MCP tools behavior-identical** — enriched contract spec green. (Assess counted 12 tools; `src/mcp/tools/` has 13 tool modules incl. `demo.ts` — reconcile the exact registered count as an M1 baseline task; the parity bar is "every tool registered at baseline".)
3. **Zero `python3`** anywhere in the runtime path (Pillow eliminated).
4. **node required only for the MCP shim** (and dev-time web-ui). Daemon, pipeline, CDP: no node.
5. **Swift daemon passes the full socket-level conformance suite and shows zero-semantic-delta on the dual-run corpus across all 30 contract operations** (see Verification strategy; oracle-erosion control R5). **Test-suite disposition at retirement (F3):** what survives is the socket-level conformance suite, the dual-run corpus harness, the golden-media comparisons, XCTest, and the shim-side MCP tests that exercise the real socket (e.g. `tests/mcp/forward.test.ts`, re-pointed from the mock daemon to the real Swift daemon). The 74/78 TS-internal vitest files are **retired together with the modules they import** — they are regression tests for code that no longer exists, not a parity asset that is lost.
6. **Capture works on macOS 26.1** with Spectra.app listed in System Settings → Privacy & Security (Screen Recording + Accessibility) — verified on-device.

---

## Milestones

Execution-model legend (applies to every milestone): **Sonnet 5** codes; **escalate to Opus** on ambiguous spec or 2 consecutive failures; **Fable** renders the milestone's assess + plan-critic + verification verdict; **Haiku/scripts** for mechanical moves (file re-homing, rename sweeps, import fixups).

### M1 — Bundle & permissions beachhead + contract-spec enrichment

| | |
|---|---|
| **Scope** | Re-home `native/swift/` (5,758 LOC) into the XcodeGen project as framework/executable targets embedded in Spectra.app; wire TS daemon to invoke the embedded binaries (path change only); establish signing/notarization + TCC attribution to `dev.spectra.app`; baseline snapshot of registered MCP tool list. **Oracle part (a) — enrich the contract into a full machine-checkable spec:** export the zod `operationParamSchemas` + result schemas + error semantics to JSON-Schema (`src/contract/contract.spec.json` or equivalent): per-op param **types, optionality, defaults, coercion**, result envelope shapes, and **op→error-code mapping** — everything `contract.snapshot.json` (names only) omits. Baseline-hash both artifacts. |
| **Owned files** | `macos/project.yml`, `macos/Spectra/**` (new groups: Capture, AX, Vision, Composite), `macos/Makefile`, `macos/ExportOptions.plist`; **moves from** `native/swift/**`; `src/contract/**` (spec-export tooling only — snapshot itself stays frozen); TS touch otherwise limited to binary-path constants in `src/native/` + `src/daemon/` config. |
| **Acceptance** | All XcodeGen targets compile (`xcodebuild` on every target — no SourceKit-ghost skips); signed+notarized .app; **on-device macOS 26.1**: Screen Recording + Accessibility grants attribute to Spectra.app in the privacy pane and a real capture succeeds; full vitest suite green (TS daemon, new binary paths — TS-internal regression check, not a parity claim); XCTest smoke per re-homed module; enriched spec generated deterministically from the zod source and hash-pinned in CI. |
| **Effort** | M · **Risk** Low-Med (TCC reset on new signature — R2) |
| **Rollback** | Binary-path constants revert to old `native/swift` build outputs (kept in-tree until M5 accepted). |
| **Standalone value** | Signed .app that survives macOS 26.1's privacy-UI rule; one bundle to grant, not N bare binaries; a real machine-checkable contract spec exists for the first time. |
| **Model** | Haiku/scripts for the file re-home + import sweep; Sonnet for project.yml/target wiring + spec exporter; Fable verdict incl. on-device capture evidence. |

*(F5: the previous "dedupe duplicate `AXComputerUse.swift`" task is removed — verified only ONE copy exists, at `native/swift/AXComputerUse.swift`.)*

### M2A — Pillow → CoreText renderer (lane A)

| | |
|---|---|
| **Scope** | Swift CoreText renderer (text overlays, callouts, badges currently drawn via python3/Pillow in the polish pipeline) as a target in the app bundle; TS pipeline shells it instead of python3. Eliminates the last python3 dependency. |
| **Owned files** | New `macos/Spectra/Render/**` target; TS touch limited to the Pillow-invocation seam in `src/pipeline/` + `src/media/`. |
| **Acceptance** | Golden-frame SSIM/pixel comparison Pillow-vs-CoreText on a fixture set; vitest pipeline tests green; `grep -r python3` over runtime paths = zero hits (behind removal of the flag, below). |
| **Effort** | M · **Risk** Low (rendering divergence is visible and cheap to compare) |
| **Rollback** | `SPECTRA_RENDERER=pillow` env flag keeps the python3 path for one release; open `[CLEANUP] pillow fallback flag` at creation, close before M5 exit. |
| **Standalone value** | Zero-python install; faster overlay rendering. |
| **Model** | Sonnet; Fable verdict on golden-frame diffs. |

### M2B — Parity-oracle construction (lane B, NEW — F1) — **gates all M3 cutover**

| | |
|---|---|
| **Scope** | Build the cross-language gate that the prior draft assumed existed. **(b) Socket-level conformance suite:** generated from `operationParamSchemas` + the M1 enriched spec — for each of the 30 ops: valid-param acceptance, invalid-param rejection with the mapped error code, envelope shape, defaults/coercion behavior — executed **over the real unix socket** against whichever daemon is running. `tests/helpers/mock-daemon.ts` + `tests/mcp/forward.test.ts` are the working seed (the only existing socket-level machinery). Daemon selection via a new env switch (e.g. `SPECTRA_DAEMON_SOCKET=<path>`) — note: **no such switch exists today; this milestone creates it.** **(c) Dual-run corpus recorder + differ:** capture real request/response traffic (replayed vitest flows + scripted real sessions) into a corpus; semantic differ with a **defined normalization table (F5)**: strip/normalize `requestId`, timestamps + durations, absolute paths (session dirs, media paths → shape tokens), PIDs/ports, and unordered-list ordering — documented in `tools/dual-run/README` so the diff is signal, not noise. |
| **Owned files** | New `tests/conformance/**`, new `tools/dual-run/**`; **read-only:** `src/contract/**`, `src/daemon/**`. |
| **Acceptance** | Conformance suite passes against the **TS daemon** (validates the suite before any Swift exists to game it); **mutation validation:** 3 seeded behavior mutations in the TS daemon are each caught by the suite and by the corpus diff (proves the oracle detects); corpus covers all 30 ops incl. error paths; normalization table reviewed by Fable (over-normalization = oracle blindness). |
| **Effort** | M · **Risk** Med (an oracle that passes vacuously is worse than none — hence the mutation gate) |
| **Rollback** | Pure additive tooling; no runtime touch. |
| **Standalone value** | Contract compliance becomes testable for ANY daemon implementation, TS or Swift — useful even if the migration stalled. |
| **Model** | Sonnet generation from schemas; Opus on differ-normalization design; Fable verdict on mutation evidence. |

### M3 — Incremental Swift-daemon cutover (strangler per op-group) — **riskiest milestone, now decomposed (F2)**

| | |
|---|---|
| **Scope** | Port the daemon behavioral surface (~13.9k LOC — see Scope map; **not** the prior draft's 5,867: `core-impl.ts` imports all 13 `src/mcp/tools` handlers, which pull in `src/core`, `src/intelligence`, `src/computer-use`, library/terminal/native seams) to Swift **one op-group at a time** behind a **per-operation routing table** in `LaunchAgentManager`/the socket front-door: each of the 30 contract ops routes to the TS or Swift daemon independently. The routing table **is** both the decomposition and the rollback. **Entry task:** derive the definitive op→group mapping from `core-impl`'s import graph. Indicative groups: **G1** health/session/permissions (health, get/requestPermissions, create/get/list/close sessions, getRun, recordLlmUsage — no capture deps) → **G2** capture/AX/vision (screenshot, snapshot, act, step, observe, analyze, discover, computerUse, llmStep, walkthrough, library, recording + terminal ops) → **G3** web capture (**blocks on M4 CDP port**) → **G4** demo/composite/polish-adjacent (demo, autoRampDemo, recordComposite — **blocks on M5 pipeline port**). `contract.snapshot.json` + the M1 enriched spec are the **spec**; neither changes. |
| **Owned files** | New `macos/Spectra/DaemonCore/**` (port target), `macos/Spectra/Daemon/LaunchAgentManager.swift` (routing table + dual-path launch); **read-only**: `src/daemon/**`, `src/contract/**` (frozen — any snapshot/spec edit is a plan violation, R1). |
| **Acceptance (per op-group — replaces the prior "vitest green with SPECTRA_DAEMON=swift", which referenced a switch and an oracle that did not exist)** | (a) conformance suite green for the group's ops against the Swift daemon over the real socket; (b) dual-run corpus diff = zero semantic deltas for the group's ops; (c) snapshot + enriched spec byte-identical to M1 baseline hashes; (d) XCTest per ported module; (e) mutation spot-check — 3 seeded behavior mutations in the group's Swift code, conformance suite + corpus diff catch all 3; (f) routing-table flip for the group, soak with real MCP-client traffic, then Fable group verdict. Milestone closes when **all 30 ops route to Swift** and (a)–(f) hold suite-wide. |
| **Effort** | XL in aggregate, decomposed into 4 op-group cutovers of M–L each · **Risk** High → Med-per-group (every client touches this seam, but blast radius is one op-group per flip) |
| **Rollback** | Routing table flips any op (or group) back to the TS daemon instantly — both daemons stay installed through M5 acceptance. No big-bang cutover week exists anymore. |
| **Standalone value** | Value ships per group: G1 = daemon control-plane native; G2 = core capture with no node in the loop, inside the signed bundle (TCC-clean); G3/G4 complete the surface. |
| **Model** | Sonnet execution in op-sized chunks; Opus escalation expected here (highest ambiguity); Fable renders every group verdict — no group flip without Fable sign-off on (a)–(f). |

### M4 — CDP web capture in Swift (feeds M3.G3)

| | |
|---|---|
| **Scope** | Port the hand-rolled CDP client (951 LOC, `src/cdp/`) to Swift (WebSocket + DevTools domains used today), driving **real system Chrome**. Wire into the Swift daemon's web-capture operations. **Lands before M3.G3 flips** — the G3 cutover consumes it. |
| **Owned files** | New `macos/Spectra/CDP/**`; **read-only**: `src/cdp/**` (reference implementation, retained until M5). |
| **Acceptance** | Conformance suite green for web-capture ops against the Swift daemon; live capture of a real Chrome session on 26.1; dual-run corpus parity for web-capture ops (extends the corpus with web flows). |
| **Effort** | M · **Risk** Med (protocol edge cases: target attach/detach, OOPIF, flaky WebSocket lifecycle) |
| **Rollback** | M3 routing table keeps web-capture ops on the TS daemon until accepted. |
| **Standalone value** | Web capture with no node; one fewer runtime in the capture path. |
| **Model** | Sonnet; Opus on protocol-edge ambiguity; Fable verdict. |

### M5 — Polish orchestration in Swift (feeds M3.G4) + TS retirement

| | |
|---|---|
| **Scope** | Port pipeline orchestration (~5,668 LOC TS: job graph, zoom/pan math, cursor smoothing, timing, segment assembly) to Swift. **ffmpeg remains shelled** — identical arg construction is part of the port spec. CoreText renderer (M2A) is now called in-process/in-bundle. **Port lands before M3.G4 flips** — the G4 cutover consumes it. After G4 acceptance: retire TS daemon + TS pipeline + `native/swift/` leftovers; close all `[CLEANUP]` flags. **Test-suite disposition at retirement (F3):** the TS-internal vitest suites (74/78 files importing `src/daemon`, `src/pipeline`, `src/core`, etc.) are retired **with** their modules — they were regression tests for the TS reference implementation. Surviving verification assets: `tests/conformance/**`, `tools/dual-run/**` + corpus, golden-media comparisons, XCTest, and shim-side socket tests (`tests/mcp/forward.test.ts` re-pointed at the real daemon). Deliverable 5 is restated in these terms — nothing the plan relies on is deleted. |
| **Owned files** | New `macos/Spectra/Pipeline/**`; retirement commits touch `src/daemon/**`, `src/pipeline/**`, `src/media/**`, `src/cdp/**`, `src/core/**`, `src/intelligence/**`, `src/computer-use/**`, `native/swift/**` (delete), their TS-internal test files, `package.json` (prune runtime deps). |
| **Acceptance** | Golden-video comparisons (SSIM per keyframe + duration/frame-count/audio-offset invariants); conformance suite + corpus diff green for demo/composite ops vs Swift; ffmpeg command-line diff old-vs-new = identical (or Fable-approved delta); mutation spot-check on zoom/pan math; post-retirement: conformance suite still green (proves the surviving suite doesn't depend on retired code). |
| **Effort** | L · **Risk** Med |
| **Rollback** | Pre-retirement: M3 routing table flips demo/composite ops back to TS. Post-retirement: git revert of the retirement commits (kept isolated + atomic for this reason). |
| **Standalone value** | Full record→polish flow native; node fully out of the runtime (shim excepted). |
| **Model** | Sonnet; Haiku for the mechanical retirement sweep; Fable verdict before the retirement commit lands. |

### M6 — MCP Tasks + MCP-App dashboard + optional FM narration

| | |
|---|---|
| **Scope** | Finalize the thin TS MCP shim (stdio → Swift daemon forwarding, `src/mcp/` slimmed to transport + tool registry); add MCP **Tasks** support for long-running record/polish jobs; begin MCP-App dashboard convergence (web-ui stays; dashboard is additive); OPTIONAL Foundation Models narration/grounding tier behind a capability flag — **does not gate this milestone**. Execute the 2026-07-28 Swift MCP SDK re-evaluation and record the verdict in this doc. |
| **Owned files** | `src/mcp/**` (slim), new dashboard surface (additive), `macos/Spectra/LLM/**` (FM tier). |
| **Acceptance** | All baseline-registered MCP tools green via the shim (conformance suite as final check; snapshot + spec hashes unchanged); Tasks verified with a long polish job from a real MCP client; FM tier: AX-first output identical with the flag off. |
| **Effort** | M · **Risk** Low (shim is thin by design) |
| **Rollback** | Shim is versioned independently; revert to pre-Tasks shim. FM flag defaults off. |
| **Standalone value** | Long jobs stop blocking MCP clients; dashboard entry point exists. |
| **Model** | Sonnet; Fable final migration verdict. |

---

## Dependency graph

```
M1 (bundle & permissions + enriched contract spec)
 ├──> M2A (CoreText)          — lane A (independent of daemon)
 ├──> M2B (parity oracle)     — lane B; GATES every M3 group flip
 └──> M3 (strangler cutover)  — critical path, spans four op-group flips
        G1 health/session ──> G2 capture/AX ──> G3 web ──> G4 demo/polish
                                                   ▲            ▲
                                              M4 (CDP)      M5-port (pipeline; needs M2A)
        all 30 ops on Swift ──> M5-retirement ──> M6 (MCP shim/Tasks/dashboard)
```

- **Critical path:** M1 → M2B → M3.G1 → … → M3.G4 → M5-retirement → M6.
- **Parallelizable:** M2A ∥ M2B ∥ early M3 porting (disjoint files: Render vs conformance/dual-run vs DaemonCore). M4 ∥ M3.G1–G2 (CDP is disjoint from the early groups). M5-port ∥ M3.G3 (Pipeline vs CDP/DaemonCore).
- **Ordering rule (F2):** a dependency port (M4 CDP, M5 pipeline) must be **accepted before** its consuming op-group flips (G3, G4). No group flips without M2B accepted. There is no "cutover week" — flips serialize per group through the shared routing table; nothing else touches launchd/routing state during a flip.

## Risks & mitigations

| # | Risk | Concrete control |
|---|---|---|
| R1 | **Contract drift** — Swift daemon "improves" envelopes/errors and silently forks the contract | `contract.snapshot.json` **and** the M1 enriched spec frozen at baseline hashes; CI check fails any commit that changes either; per-group conformance + corpus diff must be zero-delta before that group's flip |
| R2 | **TCC permission reset** — new bundle signature wipes Screen Recording/Accessibility grants; silent black-frame captures | Stable bundle ID + team (`dev.spectra.app` / Q6TB8685V9) and consistent signing identity from M1 onward; preflight check in the daemon (extend existing `screen-recording-preflight`) that hard-fails with a re-grant prompt instead of capturing black; on-device 26.1 grant test in every milestone's acceptance that touches capture; expect exactly one user-visible re-grant at M1 — flagged for ratification below |
| R3 | **ffmpeg-port temptation** — mid-M5 scope creep into AVFoundation | Named non-goal; M5 acceptance includes ffmpeg-arg-diff = identical; **path-scoped CI grep (F5):** fail on NEW `import AVFoundation` appearing in the polish-orchestration paths only (`macos/Spectra/Pipeline/**`, `macos/Spectra/Render/**`) — capture code legitimately imports AVFoundation (e.g. re-homed `SingleWindowRecording.swift` in the Capture group) and is exempt |
| R4 | **MCP spec lag** — Swift MCP SDK immature; shim becomes accidental permanent architecture | Shim scoped to transport-only (no business logic — logic lives behind the daemon contract, so a future Swift MCP server swaps in cleanly); calendar tripwire 2026-07-28 re-evaluation recorded in this doc |
| R5 | **Oracle erosion** — the conformance suite, enriched spec, or corpus differ get "fixed" to make the Swift daemon pass, destroying the parity spine | During M3–M5, `tests/conformance/**`, the enriched spec, and the differ's normalization table are **read-only except via a Fable-approved oracle-change note** appended to this doc (each note: artifact, old/new behavior, why the old one was wrong); per-group mutation spot-checks (M3e, M5) prove the oracle still detects seeded behavior changes; over-normalization in the differ is treated as erosion |

## Verification strategy

**Parity spine (rebuilt per F1):** the M1 **enriched machine-checkable contract spec** (types, optionality, defaults/coercion, result shapes, op→error mapping — hash-frozen in CI alongside `contract.snapshot.json`) + the M2B **socket-level conformance suite** + the M2B **dual-run corpus**. Everything cross-language hangs off this spine. The vitest suite is explicitly **not** on the spine.

1. **Socket-level conformance suite (M2B → every M3 group, M4, M5, M6):** generated from `operationParamSchemas` + the enriched spec; runs over the real unix socket against whichever daemon the routing table selects; the gate any daemon — TS or Swift — must pass.
2. **Dual-run corpus diff (M2B → every M3 group flip):** recorded request corpus replayed to TS and Swift daemons; semantic diff (normalization per the F5 table: requestId, timestamps/durations, absolute paths, PIDs/ports, unordered ordering) must be empty for a group's ops before that group flips.
3. **TS-internal vitest suite (regression, not parity):** stays green against the TS daemon while TS modules live — guards the reference implementation the Swift port is diffed against; retired with its modules at M5 (F3). Never cited as cross-language evidence.
4. **Mutation spot-checks (per oracle and per ported group):** seed 3 deliberate behavior mutations, confirm conformance suite + corpus diff catch all 3 — validates the oracle detects (M2B on the TS daemon; M3 per group; M5).
5. **XCTest per ported module:** unit-level, added as each module lands; all targets compiled every build (XcodeGen gotcha).
6. **Golden-media comparisons:** frame SSIM for CoreText (M2A); video SSIM + duration/frame/audio invariants + ffmpeg-arg diff (M5).
7. **On-device macOS 26.1 capture test:** real grant flow + real capture, at M1 and at every milestone whose changes touch the capture path. Never inferred from compile-green.
8. **Fable verdict gate:** no milestone (or M3 op-group flip) closes, and no TS retirement commit lands, without a Fable verification verdict citing the evidence above.

## Model org for execution

Fable = assess, plan-critic, verification verdicts (this doc; every milestone + op-group gate; oracle-change approvals). Opus = orchestration + escalation target (ambiguous spec, 2 consecutive execution failures, cross-file surprise — expected mainly in M3/M4, plus the M2B differ-normalization design). Sonnet 5 = default coding execution. Haiku/scripts = mechanical work (M1 re-home, import sweeps, M5 retirement sweep). A/B/C parallel variants only where architecture genuinely diverges — anticipated only for the M2B dual-run transport design; everywhere else the locked decisions remove the fork.

## Open items for user ratification

1. **Cutover mechanics & TS-daemon retention window** — plan says: per-operation routing table from M3.G1, groups flip individually, both daemons installed until M5 acceptance, then atomic retirement commits. Ratify the window and the per-group (vs per-milestone) flip cadence.
2. **node stays for the MCP shim** — "zero node" is NOT a deliverable of this migration; the shim (plus `src/client/` + `src/cli/`) keeps node until the 2026-07-28 Swift MCP SDK re-evaluation (and possibly beyond). Ratify.
3. **One-time TCC re-grant at M1** — moving to the signed bundle resets Screen Recording/Accessibility once for every existing install. Ratify the UX (preflight prompt) and timing.

## Changelog / oracle-change notes

- 2026-07-01 — Plan authored (Fable, Phase 2). Baseline note: Assess counted 12 MCP tools; `src/mcp/tools/` contains 13 modules (incl. `demo.ts`) — M1 baseline task reconciles the registered count.
- 2026-07-01 — **Rev 2 (Fable, post-plan-critic, verdict needs-rework).** F1: parity oracle rebuilt — enriched contract spec (M1) + socket-level conformance suite + dual-run corpus (new M2B) replace the false "unmodified vitest green with SPECTRA_DAEMON=swift" gate (no such switch existed; 74/78 vitest files are TS-internal); vitest reframed as TS-internal regression suite. F2: M3 rescoped to strangler-per-operation cutover via routing table (G1→G4); M4/M5 ports reordered to land before their consuming groups flip. F3: retirement test disposition stated explicitly (Deliverable 5, M5). F4: scope map added covering computer-use/core/intelligence/cli/client (+ library/terminal/native/launcher); M3 LOC corrected 5,867 → ~13.9k behavioral surface. F5: phantom AXComputerUse dedupe task removed; R3 AVFoundation check path-scoped; dual-run diff normalization defined.
