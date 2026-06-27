# Spectra Composite Recording — Phase 2 Plan

> Authored by the Advisor (Frontier role; dispatched on Opus as Thinking-tier fallback — Fable unavailable at dispatch). Verified by plan-critic + scope-auditor (pending). Upstream spec: `docs/prd-spectra-composite.md`. Ground truth source-verified against `src/media/pipeline.ts`, `src/media/recordings.ts`, `src/mcp/tools/capture.ts`, `src/mcp/server.ts` on 2026-06-26.

## Goal (one falsifiable sentence)

A single `/spectra:record composite` command plus one real scenario run produces ONE synchronized side-by-side `.mp4` (LEFT = live Claude Code terminal TUI; RIGHT = Atomize AI browser driven by IBR) with zero post-editing — **falsified if** the artifact requires any manual stitch/crop/edit to be shareable, or if `buildCompositeEncodeArgs` is not proven called on the live recording path.

North star: **time-to-shareable-demo**. Dogfood: record the demo of itself.

## Corrected ground truth — exists vs real gap

| Capability | Status | Evidence | Real work |
|---|---|---|---|
| avfoundation video capture + DOE (fps/codec/bitrate/hardware) | ✅ EXISTS | `pipeline.ts buildCaptureArgs`, state machine in `capture.ts` | none |
| Device-index discovery (probe + parse + fallback) | ✅ EXISTS, wired | `buildAvfoundationDeviceListArgs` / `parseAvfoundationScreenInput` / `discoverAvfoundationScreenInput`; called at `pipeline.ts:338` | **verify-only** at runtime (C1) |
| Composite encode recipe (crop×2 → hstack, equal-height, shortest=1) | ⚠️ EXISTS but DORMANT | `buildCompositeEncodeArgs` (`pipeline.ts:208`) + `CompositeLayout`/`CompositePane` types — exported via `src/index.ts`, **never called by recording flow** | **wire it** (C3) |
| Layout computation (display dims → two pane rects) | ❌ GAP | live path uses no layout | **build** (C2) |
| Composite thread through start/stop/encode | ❌ GAP | `recordings.stop → encodeRecording → buildEncodeArgs` is PLAIN (`pipeline.ts:378`) | **build** (C3) |
| MCP/command exposure of composite mode | ❌ GAP | `spectra_capture` schema has no layout param; no `commands/record.md` | **build** (C4) |
| Local build == installed plugin | ❌ GAP | installed 0.3.2 cache lacks wired pipeline | **build+relink+verify** (C5) |
| Per-window capture (occlusion-proof, labels) | ❌ not started | avfoundation captures DISPLAYS not windows | **opt-in Rung 2** (gated) |

## Decision — `spectra_capture` vs `spectra_record` (extend `spectra_capture`)

`spectra_record` (`server.ts:294`) is **already taken** by the terminal asciicast multi-recorder (`handleRecord` → `.cast`). The avfoundation video state machine (arming→recording→encoding→saved + DOE) lives under `spectra_capture` (`server.ts:161`, `CaptureParams.type`).

| Option | Tradeoff | Verdict |
|---|---|---|
| **A — extend `spectra_capture`** with a `composite` layout param + composite start/stop path | Reuses the avfoundation video state machine, DOE controls, artifact registration, session storage already owned here. New zod field on existing tool; no semantic collision. | ✅ **CHOSEN** |
| B — overload `spectra_record` | Forces a video path onto a tool whose contract is terminal-cast; semantic collision; two recorder mental models under one name | ❌ rejected |
| C — NEW dedicated `spectra_composite` tool calling the same shared `recordings`/`pipeline` layer | Keeps `spectra_capture`'s widely-used public schema untouched (avoids the C4 schema delta that trips scope-auditor) and gives composite its own clean contract. BUT duplicates the entire arming→recording→encoding→saved state machine + DOE + artifact-registration plumbing that `spectra_capture` already owns, or forces a refactor to extract a shared handler — net more surface and more risk than a single optional field. The scope-auditor delta on A is small and already proven `scope_clean`. | ❌ rejected — A's marginal schema change is cheaper than a second recorder surface |

The `/spectra:record` slash **command** name is free (commands dir = capture, connect, library, sessions, spectra, walk) → add `commands/record.md` driving `spectra_capture` composite mode. `modifies_api: true` on C4 (new public tool-schema field) → scope-auditor fires at Plan→Execute.

## Dependency graph

```
P0 (discovery, read-only)
  └─> C1 device-probe VERIFY (capture input + display dims)
        ├─> C2 layout module        ┐
        └─> C3 composite wiring (codex:01) ┘ run in PARALLEL
              └─> C4 MCP + command exposure (the join)
                    └─> C5 build + relink + first composite mp4  [ACTIVATION GATE]
                          ├─> Rung 2 ScreenCaptureKit (codex:01) — GATED on C5 fidelity
                          └─> Demo (real rally→codex handoff, ONE take)
```

Diamond: `P0→C1→{C2 ∥ C3}→C4→C5→{Rung2 gate, Demo}`. **File-ownership is MECE** (C2 owns only the new `composite-layout.ts`; C3 owns `pipeline.ts`+`recordings.ts`) and the two run in parallel. The one cross-chunk link is a **type-only, stable** dependency: C2 imports `CompositeLayout`/`CompositePane` as types from `pipeline.ts`, but **C3 does NOT edit those type definitions** (they already exist at `pipeline.ts:46/53`; C3 only changes the `encodeRecording` *function* signature). So C2 has nothing to wait on — the type surface it depends on is frozen. C3 threads an **opaque `CompositeLayout`** and never imports C2's module; the layout is computed at the C4 call site and passed down. C4 is the join — it imports C2's `computeSplitLayout` AND relies on C3's threaded signature, so C4 is explicitly sequenced after both are merged (this is a real serial edge, named, not hidden by the "parallel" framing).

## Interface contract (fixed up-front so C2/C3/C4 don't collide)

- C2 exports `computeSplitLayout(displayWidth: number, displayHeight: number, override?: CompositeLayout): CompositeLayout` from a **new** `src/media/composite-layout.ts` (imports `CompositeLayout`/`CompositePane` as types from `pipeline.ts`). Rung-1 default = split full display into left/right halves; honor an explicit operator-passed rect override.
- C3 adds `compositeLayout?: CompositeLayout` to `recordings.StartOptions` + `RecordingRecord`, stores it on start, and passes it to `encodeRecording(rawPath, outputDir, options, compositeLayout?)`; `encodeRecording` chooses `buildCompositeEncodeArgs` when a layout is present, else `buildEncodeArgs` (unchanged plain path).
- C4 `handleCapture` (start_recording) calls `computeSplitLayout` from probed dims (or operator rects), passes the result into `recordings.start({..., compositeLayout})`; adds the zod `composite` field to the `spectra_capture` tool schema in `server.ts`.

## Chunks

### Phase 0 — Discovery (read-only)
- **id:** P0 · **rung:** pre · **owner:** main-session · **dispatch_tier:** sonnet (cross-seam reasoning)
- **owned-files:** none (read-only; NavGator in-repo + runtime probes)
- **integration contract:** confirms the two ground-truth seams at runtime and resolves the two open questions before any code.
- **acceptance (HOW):** (1) NavGator in-repo (`cwd=spectra`) maps media seams — ✅ when `pipeline.ts`/`recordings.ts`/`capture.ts`/`server.ts` call graph is confirmed unchanged from this plan's assumptions. (2) live `ffmpeg -f avfoundation -list_devices true -i ""` on the operator machine returns a parseable screen index — ✅ when `parseAvfoundationScreenInput` yields a `N:none`. (3) IBR smoke-feasibility vs `http://localhost:3150` — ✅ when `ibr:test-search` + one per-page nav assertion run green against a live Atomize dev server (`next dev --webpack -p 3150`).
- **modifies_api:** false

### Rung 1 — MVP (no native code)

#### C1 — Device-probe verify-only
- **rung:** 1 · **owner:** main-session · **dispatch_tier:** haiku (mechanical runtime check)
- **owned-files:** none (verification chunk; no source edits — probe already wired at `pipeline.ts:338`)
- **integration contract:** confirms the runtime probe returns a stable capture input AND captures display dims (W×H) for C2/C4 layout input. Device-index variance is a live risk — probe, never hardcode.
- **acceptance (HOW):** ✅ when a real `discoverAvfoundationScreenInput()` run on the operator machine returns a screen index and a poster-frame probe (`buildProbeArgs`) reports display W×H; ⚠️ if the index differs from `1:none` it MUST be sourced from the probe at runtime (falsifier: any hardcoded index in the composite path).
- **modifies_api:** false

#### C2 — Layout computation
- **rung:** 1 · **owner:** main-session · **dispatch_tier:** sonnet
- **owned-files:** `src/media/composite-layout.ts` (NEW — sole owner)
- **integration contract:** exports `computeSplitLayout(displayWidth, displayHeight, override?) → CompositeLayout`; default = equal left/right halves of the probed display; explicit operator rects override. **No re-validation of pane rects here** — `normalizeCompositePane` is unexported and sole-owned by C3's `pipeline.ts`, and `buildCompositeEncodeArgs` already normalizes its inputs (finite, non-negative x/y, positive w/h) at the encode boundary (defense-in-depth). C2 computes rects and may assert its OWN local invariant (sum-width == display width on the default path); it must NOT duplicate or fork the encoder's validator. If a shared validator is later wanted, C3 exports `normalizeCompositePane` (a C3-owned edit), not C2 re-implementing it.
- **acceptance (HOW):** ✅ unit test — `computeSplitLayout(2560,1440)` yields `left={0,0,1280,1440}`, `right={1280,0,1280,1440}`; override path returns the passed rects verbatim; odd display widths floor cleanly (no pane-width drift that desyncs `hstack`). Falsifier: panes overlap or sum-width ≠ display width on the default path.
- **modifies_api:** true (new exported module)

#### C3 — Composite wiring  →  ROUTED TO codex:01
- **rung:** 1 · **owner:** codex:01 · **dispatch_tier:** sonnet-equivalent (external peer)
- **owned-files:** `src/media/pipeline.ts` (`encodeRecording` signature + branch), `src/media/recordings.ts` (`StartOptions`/`RecordingRecord`/`start`/`stop` thread). **Sole owner of both** for this feature — no main chunk edits either file (MECE preserved across the `rally/codex-01` worktree).
- **integration contract:** `encodeRecording(rawPath, outputDir, options, compositeLayout?)` selects `buildCompositeEncodeArgs(rawPath, outputPath, compositeLayout, options)` when a layout is present, else the unchanged `buildEncodeArgs` path. `recordings` stores `compositeLayout` on the record at `start` and passes it at `stop`. Plain-recording behavior must remain byte-identical when no layout is passed (regression guard).
- **acceptance (HOW):** ✅ when (a) grep proves the call site: `buildCompositeEncodeArgs` is referenced inside `encodeRecording` (not only the `src/index.ts` barrel); (b) an existing plain-recording test still passes unchanged (no-layout path); (c) a unit/integration test with a stub runner asserts the composite filtergraph args are emitted when a layout is threaded. Falsifier: composite mp4 still produced via `buildEncodeArgs`.
- **modifies_api:** true (internal `encodeRecording` + `recordings.StartOptions` contract)

#### C4 — MCP exposure + command
- **rung:** 1 · **owner:** main-session · **dispatch_tier:** sonnet
- **owned-files:** `src/mcp/tools/capture.ts`, `src/mcp/server.ts` (`spectra_capture` zod schema), `commands/record.md` (NEW). Sole owner of all three.
- **integration contract:** add a `composite` param to `CaptureParams` + the `spectra_capture` zod schema (a `{ enabled: true, left?, right? }`-shaped optional, or `aspectRatio`-derived); on `start_recording`, `handleCapture` computes the layout via `computeSplitLayout` (C2) from C1's probed dims (or operator rects) and passes `compositeLayout` into `recordings.start` (C3 contract). `commands/record.md` drives `spectra_capture` composite mode; documents the one-command path. Depends on C2 + C3 merged.
- **acceptance (HOW):** ✅ when the MCP tool accepts a composite request end-to-end against a stub runner (start→stop returns a video artifact whose encode args are the composite filtergraph); `/spectra:record` command file lints and references the tool. **scope-auditor sharpening (folded in):** `server.ts:183` destructures every param by name (`{ sessionId, type, preset, mode, elementId, region, aspectRatio, clean, quality, fps, codec, bitrate, hardware }`) — C4 MUST add `composite` to BOTH the zod schema AND this destructure list (both C4-owned), and the acceptance test must assert `composite` survives the `server.ts → handleCapture` hop, not merely the zod parse.
- **modifies_api:** true → scope-auditor ran at Plan→Execute boundary: **verdict `scope_clean`** (only external `handleCapture` caller `walkthrough.ts:94` uses `type:'screenshot'`, unaffected by the optional field).

#### C5 — Stage windows, build, relink, first composite mp4  [ACTIVATION GATE]
- **rung:** 1 · **owner:** main-session · **dispatch_tier:** sonnet
- **owned-files:** none source (build/relink + a `docs/composite-staging.md` runbook + produced artifact under `.spectra/`/`artifacts/`, both gitignored)
- **WINDOW STAGING (the Rung-1 correctness crux — explicitly owned here).** avfoundation captures the whole DISPLAY; the composite crops the left and right halves of that one recording. The "LEFT=terminal / RIGHT=browser" guarantee is only true if the terminal window is physically positioned inside the left crop rect and the browser inside the right rect BEFORE capture starts. Rung 1 owns this as an **operator-followed staging step** (documented in `docs/composite-staging.md`): tile the Claude Code terminal to the left display-half and the Atomize browser to the right display-half (macOS tiling / Rectangle / manual), matching `computeSplitLayout`'s default rects. This is the documented seam Rung 2 later automates (ScreenCaptureKit per-window removes the manual tiling).
- **integration contract:** stage windows per the runbook → `npm run build` (tsc) locally → relink the plugin so the running MCP server uses the wired pipeline. Built ≠ wired ≠ installed — this chunk closes the activation path.
- **acceptance (HOW) — dormant-feature + activation gate + content-correctness:** ✅ ONLY when (1) tsc build is green; (2) the **running** MCP server (post-relink) serves the composite path — verified by invoking `spectra_capture` composite start/stop against the staged terminal+browser display and getting a real `.mp4`; (3) the artifact is a genuine composite — `ffprobe` shows output width ≈ left.width + right.width; (4) **content-correctness (NOT just width):** a visual/poster-frame check of the output confirms the LEFT pane actually shows the terminal TUI and the RIGHT pane actually shows the Atomize browser — the width-sum check alone passes even if both halves show the wrong window, so this content check is mandatory and is the staging falsifier; (5) call-site grep confirms `buildCompositeEncodeArgs` executed on this run (not exported-only). Falsifier: a single-pane mp4; OR correct width but wrong/duplicated pane content (staging failure); OR the installed server still running pre-wire code.
- **modifies_api:** false

### Rung 2 — Durable (opt-in, GATED on Rung-1 fidelity)

#### R2 — ScreenCaptureKit per-window CLI  →  ROUTED TO codex:01
- **rung:** 2 · **owner:** codex:01 · **dispatch_tier:** opus/frontier-equivalent (native, high-stakes generative)
- **gate:** only if C5's staged-tiling fidelity is insufficient for a clean demo (occlusion, window drift). Do NOT build speculatively.
- **owned-files:** new Swift CLI under `src/native/` (e.g. `src/native/swift/composite-capture/`) + a NEW native method registration; if `src/native/bridge.ts`/`src/native/compiler.ts` must change, codex:01 owns those edits, **sequenced strictly after Rung 1 is merged** to avoid contending with main.
- **integration contract:** `SCContentFilter(desktopIndependentWindow:)` captures terminal + browser windows independently → `hstack` with pane labels; hosted via the existing JSON-RPC-over-stdio bridge (`ensureBinary()` compiles the Swift CLI). Occlusion-proof, survives window movement.
- **acceptance (HOW):** ✅ when two independently-captured, labeled panes compose with no occlusion artifacts while a foreground window overlaps the staged region (the exact case Rung 1 cannot survive). Falsifier: occlusion bleeds across panes.
- **modifies_api:** true (new native method + capture path)

### Demo — dogfood, ONE real take
- **rung:** demo · **owner:** main-session · **dispatch_tier:** opus (integrity-critical orchestration)
- **owned-files:** none source (produces the shareable mp4 + a demo runbook in `docs/`)
- **integration contract:** single take — RIGHT pane: IBR runs `test-search` + per-page nav assertions on Atomize (`http://localhost:3150`); LEFT pane: build-loop orchestrates and a REAL `rally→codex` handoff runs. Depends on C5.
- **acceptance (HOW) — INTEGRITY (non-negotiable):** ✅ ONLY when the on-camera handoff is real work — IBR finds an actual Atomize issue → build-loop hands triage to codex over rally → codex responds live, captured in the same take. NEVER staged, replayed, or mock coordination. Falsifier: any pre-scripted/replayed handoff presented as live.
- **modifies_api:** false

## codex rally-routing (handoff lines)

codex:01 is live: tool id `codex:01`, session `codex-01`, worktree `.rally/worktrees/codex-01` on branch `rally/codex-01`; recon done, device-index/composite approach confirmed. Benign PreToolUse-hook warning (`unsupported permissionDecision:allow`) — non-blocking.

Route the two backend chunks over Agent Rally Point:

```
# C3 — composite pipeline wiring
rally say handoff "C3 composite wiring: thread compositeLayout through recordings.start/stop + encodeRecording so buildCompositeEncodeArgs is called on the live path. Sole-owner files: src/media/pipeline.ts (encodeRecording), src/media/recordings.ts. Contract: encodeRecording(raw,out,opts,compositeLayout?) selects buildCompositeEncodeArgs when layout present; plain path byte-identical when absent. Accept: grep call-site + plain-recording regression test green + composite-args test."
rally inject codex-01

# R2 — ScreenCaptureKit (only after Rung-1 fidelity gate trips)
rally say handoff "R2 ScreenCaptureKit per-window CLI via native bridge — GATED on C5 fidelity. Sole-owner: new Swift CLI under src/native/ + native method; sequence after Rung 1 merged. SCContentFilter(desktopIndependentWindow:), labeled panes, occlusion-proof."
rally inject codex-01
```

MECE guarantee: codex (`rally/codex-01`) owns `pipeline.ts` + `recordings.ts` (C3) and the new Swift CLI (R2); main owns `composite-layout.ts` (C2), `capture.ts`/`server.ts`/`commands/record.md` (C4), and the build/relink/demo chunks. No file is edited by both branches in the same rung.

## Risk checkpoints (gates)

1. **macOS screen-recording TCC permission** — one-time operator grant BEFORE any capture chunk (C1 probe, C5, Demo). Known failure mode: under DENIED screen-recording TCC, avfoundation does NOT error — it commonly yields a black/desktop-only frame. So the gate cannot rely on a process exit code. Gate mechanism: (a) capture chunks block until the operator confirms the grant; (b) **black-frame detection** — every C5/Demo capture runs a poster-frame luminance probe (reuse `extractPosterFrame` + a mean-luma threshold, or ffmpeg `signalstats`/`blackdetect`); a near-black or static-desktop frame fails the run loudly with a "TCC likely denied — grant Screen Recording to the terminal host" message, rather than shipping a black composite.
2. **avfoundation device-index variance** — live probe at runtime (C1), NEVER hardcode. Gate: any hardcoded index in the composite path fails review.
3. **Live codex latency** — rehearse the rally→codex handoff OFF-camera, then exactly ONE real take. Gate: rehearsal must complete a full IBR-finds→build-loop-hands→codex-responds cycle before the recorded take.
4. **Build/activation** — built (tsc) ≠ wired ≠ relinked/installed. Gate: C5 must verify the RUNNING MCP server uses the new code (not the 0.3.2 cache).

## Integrity + dormant-feature acceptance (carried into the chunks above)

- **Integrity (Demo):** real rally→codex handoff, never staged/replayed/mock.
- **Dormant-feature (C3 + C5):** `buildCompositeEncodeArgs` PROVEN called on the live path — call-site grep inside `encodeRecording` AND a real composite mp4 with two distinct panes (ffprobe width sum + visual). Exported-but-uncalled is a FAIL.

## Open questions (TAG:ASSUMED where proceeding)

- **Pane aspect ratio target** (16:9 vs 21:9) for a clean side-by-side at the operator's display size. TAG:ASSUMED — C2 default = equal halves of probed display; revisit if the side-by-side letterboxes badly. ❓
- **Operator display dims** — designed to be sourced live by the C1 probe (not assumed/hardcoded). ⚠️ untested until C1 actually runs on the operator machine; the *design* is resolved, the *value* is verified at C1, not now.
- **Atomize dev server** — `next dev --webpack -p 3150` → `http://localhost:3150`; do NOT touch atomize-ai source (system-under-test). ✅ resolved.
- **Rung-2 trigger threshold** — what fidelity defect (occlusion / drift) flips the gate? Decide at C5 review, not now. ⚠️ untested until C5 produces the first artifact.

## Status

Plan authored ✅ and verified (Phase 2 acceptance gate passed):
- **scope-auditor** ✅ `scope_complete` — C2/C3/C4 all `scope_clean`; every caller of `encodeRecording`, `recordings.start/stop`, and `handleCapture` is inside the owning chunk or unaffected by the optional fields. One C4 sharpening folded into C4 acceptance above.
- **plan-critic** ✅ 7 WARN, 0 blocker; the substantive findings are folded into this revision: (1) decision table gained Option C (dedicated `spectra_composite` tool) with why-not; (2) C2 no longer claims to reuse the unexported `normalizeCompositePane`; the C2→C3 link is reframed as a type-only stable dependency on already-frozen `CompositeLayout`/`CompositePane` defs; (3) **window staging is now explicitly owned by C5** with a `docs/composite-staging.md` runbook and a content-correctness acceptance (the ffprobe width-sum check alone cannot catch wrong-pane-content); (4) the TCC gate now names a black-frame luminance-detection mechanism (avfoundation does not error on denied TCC); (5) the display-dims "✅ resolved" overclaim downgraded to ⚠️-until-C1-runs.

**Model note:** authored + verified on Opus (Thinking-tier fallback) because Fable Frontier was unavailable at dispatch — labeled per the standing Frontier-unavailable→Opus policy, never down-tiered to Code.

No source files modified — only this plan markdown. Scoped dispatch ends here for user review; nothing executed, built, or run.
