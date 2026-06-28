<!-- intent_run_id: bl-spectra-p1-p2-20260628 -->
# Intent - Spectra Docs Reconciliation + Async Composite Recording

## North Star

Spectra captures production-ready screenshots and videos from running apps. For
video recording, the current daemon must expose only the real ScreenCaptureKit
paths:

1. SCK composite recording via `recordComposite`.
2. SCK single-window recording via `startRecording` / `stopRecording`.

The deleted full-display AVFoundation path is history, not a fallback or future
plan.

## Current Truth

- Composite `recordComposite` is real but synchronous today.
- Single-window `startRecording` / `stopRecording` is real.
- `recording.status` and `artifact.added` events are emitted through the daemon
  event sink.
- `getPermissions` probes Screen Recording; automation and developer-tools stay
  `unknown` by design.

## Update Intent

1. Reconcile stale docs that still described the deleted full-display path.
2. Reconcile this build-loop intent and plan with `CURRENT.md` and current code.
3. Add async `recordComposite` while preserving sync mode as the default.
4. Add a poll path so callers can query a recording by `recordingId`.
5. Keep the contract drift gate active and update the frozen snapshot.

## Contract Decision

Use `async?: boolean` on `recordComposite`, not a parallel operation. The mode
flag preserves the existing operation, capabilities, MCP route, and sync caller
behavior while adding the non-blocking path.

## Out Of Scope

- The build-loop repo. Claude is editing it concurrently; this lane is Spectra
  only.
- Restoring any full-display recording path.
- macOS SwiftUI UI work.
- Web UI work.
- New external npm packages.

## Constraints

- Work only in `/Users/tyroneross/dev/git-folder/spectra`.
- Commit each chunk separately.
- Do not bypass the contract drift test or git verification.
- Verify every documentation claim against current code before writing.
- Keep sync `recordComposite` behavior green for existing callers.

## Activation Gate

Done means:

- Docs no longer claim the deleted full-display recording path is current or
  planned.
- `recordComposite({ async: true })` returns a `recordingId` immediately.
- Completion emits `recording.status` and `artifact.added` when a session is
  attached.
- `getRecording` returns lifecycle status for the returned `recordingId`.
- `npm run build`, `npm run build:composite`, and `npm test` pass.
