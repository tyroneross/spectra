# Spectra Composite Recording - Current Plan

> Reconciled 2026-06-28 against `CURRENT.md` and current source. This replaces
> the retired two-rung crop-from-display plan.

## Goal

Keep Spectra's recording surface aligned to the code that exists now: native
ScreenCaptureKit composite recording plus native ScreenCaptureKit single-window
recording. `recordComposite` remains synchronous by default and supports opt-in
async mode.

## Current Ground Truth

| Capability | Current status | Evidence |
|---|---|---|
| Composite recording | Real; sync default, async opt-in | `src/daemon/core-impl.ts` `recordComposite`; worker in `src/daemon/composite-worker.ts`; Swift source in `native/swift/composite-capture/` |
| Single-window recording | Real | `startRecording` / `stopRecording` in `src/daemon/core-impl.ts`; registry in `core-impl.ts`; native helper in `native/swift/SingleWindowRecording.swift` and `native/swift/main.swift` |
| Recording event bus | Real | `recording.status` and `artifact.added` emitted through `eventSink` in `src/daemon/core-impl.ts`; server bus wiring in `src/daemon/server.ts` |
| Full-display recording fallback | Deleted | Removed in `b68ee69`; it is not a valid product or implementation path |

## Non-Negotiable Recording Path Rule

Do not restore or document a full-display recording fallback. Video recording is
limited to:

1. SCK composite recording through `recordComposite`.
2. SCK single-window recording through `startRecording` / `stopRecording`.

Screenshots, PNG utilities, poster extraction, and video probing may continue to
use media helpers. They are not live video recording paths.

## Current API Surface

- `spectra_demo action=record-composite` forwards to daemon `demo`, which
  delegates to `recordComposite`.
- `spectra_capture type=start_recording` forwards to daemon `startRecording`.
- `spectra_capture type=stop_recording` forwards to daemon `stopRecording`.

## Async `recordComposite`

`recordComposite` accepts `async?: boolean`.

1. Default mode remains synchronous.
2. Async mode returns a `recordingId` immediately.
3. The daemon tracks composite recording lifecycle in a registry.
4. Completion emits `recording.status` with `saved` or `failed`.
5. Successful session-attached completion emits `artifact.added`.
6. `getRecording({ recordingId })` returns the current status.

## Contract Shape Decision

Use `async?: boolean` on `recordComposite`, not a parallel operation. The single
operation already owns the composite params, capabilities, MCP forwarding path,
and client timeout behavior. A mode flag preserves sync compatibility and avoids
duplicating the same recording contract under a second operation.

## Acceptance

- No docs or plans describe the deleted full-display path as current or planned.
- Sync `recordComposite` behavior remains the default.
- Async `recordComposite` returns `{ recordingId }` immediately and completes
  through SSE plus poll.
- Existing single-window `startRecording` / `stopRecording` tests remain green.
- Contract drift test is updated, not skipped.

## Historical Note

The earlier crop-and-stack plan was useful scaffolding before the daemon
consolidation. It is now obsolete because the current code records windows via
ScreenCaptureKit.
