# Retrospective — Spectra session (2026-07-01 → 07-02)

_Scope: one long build-loop session on the Spectra repo. Marketing pipeline → two new skills → native computer-use → native-Swift migration (planned + M1/M2 + M3.G1). Includes two incidents worth learning from._

## Delivered
- **Marketing/record pipeline**: banner/caption look, 6.66× perf, spotlight, audio, auto-zoom, cursor telemetry; unsigned-app fix; web-ui IBR+Calm-Precision audit fixes; polish presets (cool/warm/bold). Mostly via 3-model A/B/C.
- **Two skills** (generic, reusable): `product-marketing` (+ `marketing-planner` agent) and `video-design` — cross-linked, wired to Spectra's polish presets/specs. Tested + refined.
- **Deliverables**: before/after video improvements; a live **red→green terminal capture** (codex GUI); a rated assessment of the demo-candidate clips (validated "clicks show no value-in-motion").
- **Native computer-use** (`spectra_computer_use`): AX-first + focused-window + form-fill (A/B/C, Opus won) → `act` self-snapshot fix → **real vision fallback** (Apple Vision OCR + coordinate acts, A/B/C, Codex won). Live-verified: 27 real AX nodes + setValue read-back; OCR grounding + Retina click `ocrDelta=0px`.
- **Two research entries** persisted (`~/dev/research/topics/`): efficient computer use (AX-first, mixed-compute); 2026 new capabilities (Foundation Models, MCP 2026-07-28 Tasks/Apps, macOS-26.1 bundle rule, Vision has no UI-element detection).
- **Native-Swift migration**: build-loop plan (Fable assess/plan/critic → **needs-rework** → revised) → **M1** (bundle helper-embed + machine-checkable `contract.spec.json`) → **M2A** (CoreText renderer, python3 removed) → **M2B** (socket-level parity oracle) → **M3.G1** (Swift daemon-core + 11 control-plane ops, oracle-verified). Fresh session carried M2B→M3.G1.

## What worked
- **Independent judges caught REAL defects every time** — this is the headline. Fable/Opus gates found: the `act`-dead-through-daemon bug (hidden by over-mocked tests), Codex's non-additive required-`source`, the M1 **H1 hollow-gate** (result shapes one level deep → nested drift invisible), and the M2B **killer ordering-cascade** (alphabetical op order destroyed fixture sessions → ~14 core ops only asserted the error path → a Swift daemon that threw on `snapshot` would have passed). Assess-everything + mutation-verify > trust-the-implementer, repeatedly.
- **A/B/C model competition** surfaced defects and diversity: no model uniformly best — Opus won architecture-heavy tasks, Codex won two with a robustness/systems edge, and the judges caught a real bug in a winner twice.
- **Plan discipline paid**: discovery (cheap Sonnet) grounded the plan in real LOC + surfaced the existing `macos/` beachhead; plan-critic caught that the "vitest oracle" didn't exist and M3 transitively contained M4+M5 — before any code was written.
- **The parity oracle** (enriched contract spec + socket-level conformance + dual-run corpus + mutation-check) is the right spine for a cross-language port — but only after two rounds of gates made it actually bite.

## What went wrong — two incidents
1. **Keychain storm.** Native builds codesigned with the user's real Apple Development identity, and CDP Chrome stored its Safe Storage key in the login keychain — both fired repeatedly during dev builds, popping a blocking (and, for Chrome, destructive "Reset To Defaults") dialog ~20×. **Root cause: release-oriented defaults ran during local/agent iteration.** Fix: ad-hoc codesign default (real identity opt-in only); Chrome `--password-store=basic --use-mock-keychain`. Committed `a0d645e`.
2. **`.spectra/` deleted (unrecoverable).** A subagent probing `library:add` wrote into the repo's real `.spectra/` (storage resolved to it via the walk-up marker), then `fs.rmSync`'d the whole dir believing it was test junk — 226 sessions/50 recordings/productions, no Trash/TM/APFS recovery. **Root cause: a subagent deleted a non-owned real-data dir, and a probe wrote to the real storage root.** Net loss was low (high-value deliverables live in `ross-labs-astro/demo-candidates/` + scratch; `~/.spectra` intact) — but it was a real destructive-op failure.

## Lessons → enforcements (now durable)
- **Never delete a dir/file you didn't create; isolate test storage to a temp root.** (memory `feedback_agents_never_delete_nonowned_dirs`) — added to every dispatch as a mandatory guardrail.
- **Never auto-touch the login keychain** — ad-hoc sign by default, automation Chrome uses basic store, never accept keychain "Reset". (memory `feedback_never_auto_touch_login_keychain`)
- **A gate that passes its own tests but can't catch a divergent implementation is the failure mode to hunt** — validated twice (H1, M2B ordering cascade). Mutation-verify that the gate bites on the exact thing it's supposed to protect.
- **Dev builds must not run release-oriented defaults** (real signing, OS-keychain) — separate local from release.

## Model scorecard (A/B/C, this session)
Opus: voiceover · CDP runner · web-ui audit · native computer-use — **4**. Codex: cursor telemetry · vision fallback — **2** (+ drove the live e2e's and M2B→M3.G1 execution). Sonnet: **0** (and shipped a dead-click defect a judge caught). Fable: the judgment/gate layer that caught the real defects. → Opus for architecture-heavy; Codex competitive on bounded/systems + GUI; Fable is where the correctness reasoning pays.

## Current state + next
Committed to `main` through `32e1de0` (M3.G1). Uncommitted M3 WIP in the working tree (active peer). Next: finish M3.G1 → G2 (capture/AX) → G3 (web, needs M4) → G4 (demo/polish, needs M5) → M5 retirement → M6 (MCP Tasks/App + optional Foundation Models). Handoffs: `docs/plans/codex-parallel-handoff.md` (M1-GUI-verify + M4/M5 to Codex); oracle/orchestration/M3 stay Claude/Fable-side.
