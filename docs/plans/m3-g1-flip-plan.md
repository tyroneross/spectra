# Plan: M3.G1 Routing Flip — Swift front-door strangler activation

<!-- checklist
Item 1 — Auth guard: unix socket mode-0600 peer-credential auth + capability gate (src/daemon/security.ts: verifyCaller / assertCapabilities / missingCapabilitiesForOperation). Swift mirror: WireProtocol.swift Capability enum + CapabilityPolicy (F-02). Backend socket inherits 0600/peer-auth — asserted by T-02c (socket-0600 ✔). Gate-D manual mutation EXECUTED with red/green evidence (GV-4a ✔).
Item 2 — External APIs: N/A: no new external API calls. All traffic is the existing local unix-socket wire contract (src/contract/contract.spec.json, hash-frozen).
Item 3 — Rate-limit criterion: N/A: no paid API calls.
Item 4 — Discoverability: N/A: daemon/infra only, no UI surface. CLI surface unchanged.
Item 5 — Server/client boundary: N/A: not a Next.js app. The binding boundary is the frozen wire contract (contract.spec.json + wire.ts envelope) — enforced by the conformance oracle.
Item 6 — Concurrency: library index.json — single writer post-flip (VERIFIED by scope-auditor). Swift LibraryStore serializes via its queue. G3 rogue-spawn guard implemented + T-10 green + Q-01 USER-APPROVED (GV-3 closed — approval predated implementation; the plan line was stale). Session ops proxied until G2; D-01 v1 fail-closes them (backend-aware rule, falsifiers green). Test-file race on the shared usage counter fixed durably (--no-file-parallelism).
Item 7 — Observability: router log line; dual-run JSONL; rollback drill evidence; rogue-daemon detector; t02-masks.json (mask+class ledger, audited; rev 3.5 adds class-pattern entries with resolved-path transparency); gate-b-e2e-excluded-set.json (audited, per-entry class).
Item 8 — Input validation: envelope validation + per-handler param validation; T-07 edges GREEN; routing config fail-closed (T-02b GREEN).
Item 9 — Stable ID traceability: U-02 → F-01 → D-01 → T-01/T-02/T-02b/T-02c/T-03; U-03 → F-02 → T-04; U-01 → F-06 → T-08/T-09.
Item 10 — JSON spec object: present (rev 3.1/3.2 texts + verdict deltas).
Item 11 — Blocking-and-novel question gate: ZERO open questions — Q-01 CLOSED (user approved; §Approved Novel Decisions #4). All else resolved or [ASSUMED].
Item 12 — Low-reversibility ADRs: §ADR-01 / §ADR-02 / §ADR-03, full records.
Item 13 — Analytical lens: DSM; Pugh for sequencing.
Item 14 — Handoff document: docs/plans/m3-g1-flip-plan.handoff.md (rev 3.5 — class-mask spec routable to S4).
Item 15 — Synthesis dimensions: N/A: no UI surface.
Item 16 — Risk reason: S1 `runtime protocol`, S2 `security boundary`, S5 `deployment`.
Item 17 — UI input/output contract: N/A: no UI surface.
Item 19 — Env-var manifest: N/A: no new external service (internal env contract in §Env Contract).
-->

status: revision 3.5 — TERMINAL gate ruling (class-based masks for the capture/AX op class, §Gate redesign rev 3.5). GV-1 ✔ · GV-2 ✔ (durable --no-file-parallelism fix; B-e2e stably green ×2: 139 compared / 47 excluded / 0 fail) · GV-3 ✔ CLOSED (Q-01 was user-approved pre-implementation; stale plan line corrected) · GV-4a ✔ (red/green evidence on file) · GV-4b ✔ (22→24 = the 2 listWindows tests). Remaining: land rev-3.5 class masks → 3 consecutive green chains → flip commit → Gate E (pauses for user).
modifies_api: true
scope_auditor_status: run 1 complete; final plan-critic + scope-auditor pass on the rev-3.5 delta before the flip commit
author: Advisor (Frontier/Fable), mode: re-plan + verdict administration (rev 3 → 3.5)
trigger: rev 3.5 — back-to-back full chains exposed B-diff flake on the capture/AX class: run1 llmStep ✗ result.results[0].durationMs, run2 walkthrough ✗ result.duration_ms — both duration-class fields the 3-sample calibration missed

## Goal

Swift daemon-core on the production socket as the front door: 5 session-independent G1 ops native, 25 byte-tunneled to the TS backend, fail-closed data-driven routing, capability parity closed before first real traffic, dual-run soak, <2-minute proven rollback. **Falsifiable success:** T-02 deterministic 31/31 across 3 consecutive chains (rev 3.5), T-02c green on the audited basis, T-02b fail-closed proven, T-04 scoped gate green, T-08 soak with per-op dual-run coverage + zero unexplained divergence, T-09 executed rollback drill. (T-08 is part of DONE.)

## Sequencing Decision (option (a): flip first — user-approved 2026-07-03)

Unchanged; rejections per rev-2 record.

**Plan corrections (cumulative):** (1) no routing table existed — built; (2) session split-brain → 5-op native set + fail-closed denylist; (3) allowlist 10→11, corpus never external-aware; (4) G2 = 16 ops; (5) TS listen override (P3); (6) legacy suites pinned; (7) G2a GUI pin; (8) bootstrap rogue-spawn → guard (Q-01 approved); (9) rev-3 gate redesign + 2 real ProxyClient bugs convicted & fixed; (10) rev-3.1 optional-metadata ruling + corpus out of Gate A; (11) rev-3.2 calibrated mask + guards; (12) rev-3.3 generated-artifact structural class; (13) rev-3.4 T-02c basis errors (native-route corpus, dual-leg state); **(14) rev-3.5 — per-run fixed-sample calibration is inherently unreliable for low-variance volatile fields (durations that alias across 3 samples, ±1ms); the durable fix is class-based masking for the known-generative op class, not per-run sampling or per-op whack-a-mole.**

## Locked Decisions

As rev 3.4 (differential-not-absolute; route fingerprint; calibrated+guarded masks; structural generated-artifact class; corpus-basis validity rules; continue-on-fail), plus:
- **(rev 3.5) Volatility CLASSES, once evidence-approved, are masked by anchored NAME/TYPE PATTERN for the generative op class — calibration is retained as a diagnostic, not the sole detector.** Deterministic ops stay on pure byte-equality: they are the standing tunnel-fidelity proof, and a flake THERE is a finding, never a mask candidate.
- **(rev 3.5) Determinism acceptance bar: 3 consecutive fully-green chains** before the flip commit.

## Approved Novel Decisions (user-confirmed)

1. Flip-first sequencing — approved (2026-07-03).
2. ADR-01 front-door proxy — approved (2026-07-03).
3. 5-op native boundary — approved (2026-07-03).
4. **Q-01 G3 bootstrap guard — APPROVED (user sign-off predated implementation; GV-3 was a stale-doc finding, closed).**

## Scope / Out of scope · Routing table · §G3

Unchanged (rev 3.x = verification gates only; native 5 / proxy 25; backend-aware fail-closed rule; G3 guard live behind approved Q-01).

## Gate redesign rev 3 → 3.4 (retained record)

rev 3: differential two-part Gate B; corpus external-awareness → removal; capability-gate registration scoping; backend-aware Router rule; two REAL ProxyClient bugs convicted & fixed. rev 3.1: route fingerprint; optional contract metadata (zero readers) → Swift omission conformant. rev 3.2: calibrated mask APPLIES + presence/type guards + structural-mask prohibition + ledger + growth WARN. rev 3.3: recordTerminal.timeline structural comparison (generated-recording-content). rev 3.4 GROUP VERDICT: PASS-PENDING-FIX — GV-1 native-route corpus exclusion (landed ✔); GV-2 recordLlmUsage (closed ✔ — root cause was test-FILE parallelism racing the shared usage counter; durable fix `--no-file-parallelism`; B-e2e stably green ×2; the `dual-leg-state-order` excluded entries stand, classed and audited); GV-3 (closed ✔ — user approval predated implementation); GV-4a (closed ✔ — mutation executed: assert removed → capability-gate 10F/21P RED, restored → 31/31 GREEN, evidence at `.build-loop/flip-evidence/gate-d-manual-mutation.txt`; 10 failed = the 11 registered ops minus health under the daemon:read grant — count consistent); GV-4b (closed ✔ — 22→24 = the 2 listWindows allowlist tests, named).

### rev 3.5 — class-based mask ruling (TERMINAL B-diff item)

**Evidence:** two back-to-back full chains each failed B-diff on a DIFFERENT single capture/AX op (run1 llmStep on `result.results[0].durationMs`; run2 walkthrough on `result.duration_ms`) — each a duration-class field that aliased across the 3 direct calibration samples (fast op, same ms value ×3) and diverged ~1ms on the proxy leg. The 14 deterministic proxied ops pass byte-equal EVERY run. A byte tunnel cannot selectively alter one duration field. This is the calibration-under-sampling failure mode named in rev 3.3, now recurring across the generative op class.

**Ruling: CONFIRMED — class-based masking for the generative op class, with tighter scoping than proposed.** Unanchored globs are how a transparency gate goes decorative, so the patterns below are anchored and the op scope is closed:

- **Op scope (closed set):** `act, observe, snapshot, step, llmStep, walkthrough` — the six capture/AX/step ops whose results embed live snapshots, screenshots, temp paths, and timing. All previously-ruled per-op masks stand (screenshot.path, recordComposite.recordingId, getRecording.updatedAt, createSession.error.message, recordLlmUsage.entries, recordTerminal structural). **Every other op stays on pure calibrated byte-equality** — the deterministic set is the tunnel-fidelity proof; a flake there is a FINDING routed to the Advisor, never a mask.
- **Class patterns (anchored; match only beneath `result.`, never at envelope level):**
  - `duration` class → leaf key exactly `duration` | `durationMs` | `duration_ms`, any depth under `result` → guard: JSON number AND ≥ 0.
  - `embedded-content` class → exact paths `result.snapshot` | `result.finalSnapshot` → guard: JSON string AND non-empty.
  - `temp-path` class → leaf key exactly `screenshotPath`, any depth under `result` → guard: JSON string AND non-empty.
  - NO generated-id pattern for these six (unobserved there; recordComposite's per-op mask already covers `recordingId`). Do not add patterns for unobserved fields — observed-need only.
- **Guards:** presence + the typed assert above on every pattern-hit, both legs (drop/retype = FAIL). Structural fields remain unmaskable (`ok`, `error.code`, `apiVersion`, `requestId`, `caller`/`deliveryPath` presence, HTTP status, Content-Type).
- **Ledger (pattern-hit transparency):** t02-masks.json entries `mode: class-pattern` carry the class AND the RESOLVED concrete paths the pattern matched on each run — the audit sees what was actually masked, not just the pattern. Growth of a resolved-path set across runs = WARN, surfaced to review.
- **Calibration retained as diagnostic:** it keeps running and reporting; any calibrated-volatile path OUTSIDE the approved classes still requires an Advisor ruling (unchanged discipline).
- **Alternative (structural-comparison extension) rejected as primary:** typed leaf guards are equivalent protection at lower complexity for scalar fields; structural mode stays reserved for composite generated artifacts (arrays/objects, e.g. timeline). If a generative op ever embeds an artifact ARRAY, it takes the structural route via a ruling, not a pattern.

**Terminal-ness:** with this landed, B-diff's foreseeable flake surface is closed — every observed volatility class (timestamps, embedded content, temp paths, durations, generated ids, free-text, recording content) is now handled deterministically. **One future claimant is named but deliberately NOT pre-approved** (observed-need rule): stateful-read timestamp leaves (`updatedAt` / `createdAt` / `startedAt`) on session/recording read ops — currently byte-stable because the seeded fixtures are static; if a leg ever mutates mid-chain they will flake. If that fires, it is a fast ruling against this precedent, not a redesign.

**Acceptance:** 3 consecutive fully-green chains (B-diff 31/31 each + B-e2e green each + A/B2/C/D green) → flip commit → Gate E.

## Work items — rev 3.5 delta

- **S4:** implement the class-pattern masks exactly as scoped above (six ops; anchored patterns; typed guards; `mode: class-pattern` ledger entries with resolved paths). Then run the chain 3×.
- **S1/S2/S3/S5/Opus:** no code action; Opus schedules the 3× runs + the flip commit + Gate E user pause.

## Parallel Decision Record / Depends-on / Activation Map / Commit table

`parallel_batch: m3-g1-flip-wave-1` (the S1–S5 implementation fan-out, recorded in the rev-2 machine-readable block — retained) · `parallel_skipped_reason: rev-3.x gate corrections are single-owner sequential fixes (S4, occasionally S1), not a fan-out`. Full S1–S5 owned-file MECE record + Activation Map bullets are the rev-2/rev-3 versions (unchanged; scope-auditor-confirmed).

As rev 3.4, plus commit delta C5g `fix(conformance): class-pattern masks for the capture/AX op class` (S4). Depends-on addition: "duration fields alias across 3 rapid direct samples (±1ms proxy delta; different op per run) — **verified** (runs 5–6 evidence); test-file parallelism raced the shared usage counter — **verified** (GV-2 root cause + durable fix)".

## F-Criteria (functional) — rev 3.5 deltas only

| ID | Change |
|---|---|
| T-02 | Comparison adds class-pattern masks for the closed six-op generative set (anchored patterns + typed guards per §rev 3.5); all other ops unchanged (pure calibrated byte-equality). Pass bar: 31/31 across **3 consecutive chains**. Falsifier additions: a pattern-hit failing its typed guard; a class-pattern match at envelope level (must be impossible by construction); a deterministic-set op flaking (finding, not mask) |
| T-02c | GREEN ×2 on the audited basis (139/47/0); must hold across the 3 acceptance chains |
| T-03 | GV-4a executed evidence on file — criterion met |
| others | unchanged |

## Q-Criteria (quality)

As rev 3.4, plus: the verdict-surface audit of t02-masks.json now checks class-pattern entries for (a) op scope ⊆ the closed six-op set, (b) resolved paths all beneath `result.`, (c) typed guards executed, (d) resolved-set growth WARNs examined.

## Verification gates (ordered, rev 3.5)

1. Gate A ✔ 2. Gate B-diff (re-run under class masks; 31/31 ×3) 3. Gate B2 ✔ 4. Gate B-e2e (green ×2; hold ×3) 5. Gate C ✔ 6. Gate D ✔ (manual mutation evidence on file) 7. Group verdict conditions GV-1..4 **ALL CLOSED**; rev-3.5 acceptance = 3 consecutive green chains 8. **Flip commit** (C7) 9. **Gate E** — live flip + soak (per-op dual-run rows + rogue-daemon detector) + rollback drill (T-08/T-09); pauses for the user 10. C8 Swift-baseline corpus (post-verdict rule satisfied).

## Rally / Model-org / Risks / Env Contract / Assumptions / ADRs / Spec Object / Open Questions

As rev 3.4, with deltas:
- **Risks:** GV-3 governance row CLOSED. Mask-creep row: mitigations now include anchored-pattern scoping + resolved-path ledger + closed op set.
- **Assumptions:** GV-2 leg-order assumption superseded by the verified file-parallelism root cause. [ASSUMED] the named future claimant (stateful-read timestamps) stays stable while fixtures are static.
- **Open Questions:** NONE — Q-01 closed (user-approved).

## Out of Scope (mirror)

G2 · native flip of the 6 session ops (fail-closed) · M4/M5 · client changes beyond the approved Q-01 guard · GUI · signing/notarization · capture-capable backend · optional envelope metadata emission · widening class-pattern masks beyond the closed six-op set or adding unobserved patterns (Advisor ruling required).
