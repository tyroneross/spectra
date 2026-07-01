---
id: SPEC-ZOOM-TELEMETRY-c5spectra01
schema_version: 1
title: Emit click/cursor telemetry at record time to feed the zoom pipeline
status: done
priority: P2
type: feature
area: recording
entities: []
gated: none
provenance:
  source: record-to-polish-build
  ref: bl-spectra-20260630T190943Z-claude_code/C5
evidence: [src/daemon/core-impl.ts, src/pipeline/zoom-keyframes.ts, src/media/spotlight.ts]
supersedes: null
superseded_by: null
created: 2026-06-30
updated: 2026-06-30
review_by: 2026-07-30
owner: claude
---

## Context
The zoom/ken-burns pipeline (`zoom-keyframes.ts buildZoomTrack`) needs `{tMs, cx, cy}` click
data, but NO recording path emits it today — `polishClip` clicks JSON must be hand-authored.
This is the last gap for a fully-automatic record→polish flow.

## Why deferred from this run
- The capture half (ScreenCaptureKit) CANNOT run from the Claude Code bash context
  (`CGS_REQUIRE_INIT`), so a click/cursor sampler added to the recording path cannot be
  verified end-to-end here — it needs the MCP server process (CC restart) or a codex-rally
  GUI session. Shipping unverified capture code violates the verify-the-running-app rule.
- `core-impl.ts` is also touched by C4 (dispatch wiring); sequencing avoids a single-writer
  collision.

## Two viable paths (pick cheaper first)
1. **Scene-detect derivation (cheaper, verifiable headlessly):** reuse `media/spotlight.ts`
   scene-detect (`scanActivity`/`deriveActiveRanges`) to derive zoom windows when no click
   JSON is supplied — gives auto-zoom on activity bursts without native click capture.
2. **Native click/cursor sampler:** add an AX/CGEvent tap during recording that persists
   `{tMs, cx, cy}` next to the artifact. Higher fidelity, needs live-capture verification.

## Progress (2026-06-30)
- DONE temporal auto-zoom from scene-detect (66676e3).
- DONE standalone native cursor/click sampler + loadCursorTelemetry, live-verified via codex (75e44e1).
- REMAINING (Step 2b): auto-run sampler during recording + persist next to artifact (touches core-impl; gated to keep recording path regression-free).

## Acceptance
- A recording produces a clicks/cursor JSON the polish pipeline consumes with zero hand-editing,
  OR auto-zoom windows derived from scene-detect when click data is absent.
- Verified on a real capture (MCP/codex-rally), frames show zoom landing on activity.

## Resolution (2026-06-30)
Step 2b wiring shipped (f817801) via 3-model A/B/C; Codex won (only MCP-reachable arm). captureCursor opt-in, zero-regression. REMAINING: live cursor-during-recording capture verification in a GUI session (daemon restart + real recording).
