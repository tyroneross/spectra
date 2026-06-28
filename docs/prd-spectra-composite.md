---
name: spectra-composite
status: active
revision: 0.2.0
last_updated: 2026-06-28
load_when: "Any non-trivial change to Spectra recording/compositing, the composite MCP tool/command, or the dogfood demo pipeline."
evolves_when: "Recording engine changes, pane model changes, async recording lifecycle changes, or the demo scenario / integrity rule changes."
core_principles:
  - "Local-only capture: nothing leaves the machine."
  - "One real run produces one shareable mp4, with no post-editing."
  - "On-camera multi-agent coordination is real work, never staged."
  - "Recording paths are ScreenCaptureKit-backed daemon paths only."
---

# PRD - Spectra Composite Recording + Dogfood Demo

## How To Use This PRD

Read this before any non-trivial change to Spectra's recording/compositing path
or the demo pipeline. This document describes the code as it exists now, not the
older crop-from-display plan.

## Intent

Spectra should produce a synchronized side-by-side `.mp4` from two live macOS
windows: left pane = a terminal window showing build-loop/Rally/Codex work,
right pane = a browser or app window driven through the demo flow. The artifact
must be shareable as-is.

## Current Recording Paths

There are exactly two live video recording paths:

1. **Composite recording**: `recordComposite` resolves two windows and invokes the
   ScreenCaptureKit composite worker (`src/daemon/core-impl.ts`,
   `src/daemon/composite-worker.ts`, `native/swift/composite-capture/`).
2. **Single-window recording**: `startRecording` / `stopRecording` resolve a
   session target window and drive the native single-window ScreenCaptureKit
   helper (`src/daemon/core-impl.ts`, `native/swift/SingleWindowRecording.swift`,
   `native/swift/main.swift`).

The deleted full-display AVFoundation route is not a recording path. It was
removed in `b68ee69`; `startRecording` / `stopRecording` became real in
`94a35af`.

## North Star

**Time-to-shareable-demo.** A credible video of agentic computer use and
multi-agent coordination is produced from Spectra without manual dual-recording,
cropping, or editing. If a change makes the artifact need post-editing to be
shareable, it regressed the North Star.

## Persona And Trigger

- **User:** Tyrone and anyone demoing RossLabs agent tooling.
- **Triggers:** a capability is worth showing, Spectra needs documentation media,
  or a real multi-agent workflow should be captured as proof.
- **Is not:** a video editor, a CI/test tool, an OBS-style streaming app, a
  consumer capture product, or an Atomize AI feature.

## Outcome

One clean side-by-side mp4 from one real run, including a genuine on-camera
handoff when the demo scenario requires one.

## Methodology

Composite recording is native first:

1. The caller supplies app/title selectors for pane A and pane B.
2. The daemon runs in the GUI session and invokes the composite worker.
3. The Swift worker captures each target window independently with
   ScreenCaptureKit, composites the panes, applies optional labels/spotlight/
   captions/cursor, and writes one mp4.
4. The daemon records lifecycle state and registers a video artifact against the
   session when a valid `sessionId` is attached.

Single-window session recording is also native:

1. `startRecording` resolves the session app to an on-screen SCK window.
2. The daemon registers an active recording and emits `recording.status`.
3. `stopRecording` stops the native helper, probes the output, records `saved` or
   `failed`, and emits `artifact.added` when a session is attached.

## Integrity Rule

The on-camera rally-to-codex handoff is real work, never staged: a real issue or
task appears, build-loop hands it off over Rally, and Codex responds live. No
mock coordination or replayed script may be presented as live.

## Stance

- **Privacy/data:** capture is fully local; artifacts stay under the local repo
  or Spectra storage.
- **Complexity:** one command with sane defaults, but no fallback to deleted
  full-display recording. Recording fidelity comes from window isolation.
- **Cost:** internal local tooling; no per-use cloud rendering cost.

## Non-Goals

- No changes to Atomize AI.
- No compositing editor or timeline UI.
- No physical iOS-device capture.
- No cloud rendering or upload.
- Not a general streaming product.

## Architecture And Ground Truth

Source-verified on 2026-06-28:

- `src/daemon/core-impl.ts` implements `recordComposite`,
  `startRecording`, `stopRecording`, event emission, and the single-window
  `RecordingRegistry`.
- `src/daemon/composite-worker.ts` validates composite params, performs the
  screen-recording preflight, invokes `native/swift/composite-capture`, and runs
  the black-frame guard.
- `native/swift/composite-capture/CompositeCapture.swift` is the composite
  ScreenCaptureKit worker.
- `native/swift/SingleWindowRecording.swift` and `native/swift/main.swift`
  implement the single-window native recording helper.
- `src/mcp/forward.ts` maps `spectra_demo action=record-composite` to the daemon
  `demo` operation, which delegates to `recordComposite`.

## Roadmap Stance

The next product gap is async `recordComposite`: the synchronous path already
emits recording lifecycle events, but it still blocks until capture and encode
finish. Async mode should return a `recordingId` immediately, then report saved
or failed over SSE plus a poll operation.

## Risks

- macOS Screen Recording permission can still make output unusable; the daemon
  keeps a preflight and black-frame guard.
- Target window resolution depends on visible, on-screen windows.
- Live codex latency can affect demos; rehearse the flow, but record one real
  take.

## One-Line Summary

Spectra records isolated macOS windows through ScreenCaptureKit and produces a
local, shareable side-by-side mp4 of real coordinated agent work.

## Document Maintenance

Update on any recording-engine change, pane-model change, async lifecycle
change, or demo-scenario/integrity-rule change. Bump `revision`; log pivots
below.

## Pivot Log

- 0.2.0 (2026-06-28) - reconciled with current daemon code: the deleted
  full-display path is not valid; SCK composite and SCK single-window recording
  are the only live recording paths.
- 0.1.0 (2026-06-26) - initial draft for the now-retired crop-from-display plan.
