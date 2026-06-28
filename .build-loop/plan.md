# Plan - Spectra P1 Docs + P2 Async `recordComposite`

## Goal

Make the Spectra repo internally consistent with current code and keep
`recordComposite` non-blocking for callers that opt into async mode.

## Ground Truth

- Deleted path: full-display AVFoundation recording was removed in `b68ee69`.
- Real composite path: `recordComposite` in `src/daemon/core-impl.ts` delegates
  to `src/daemon/composite-worker.ts` and `native/swift/composite-capture/`.
- Real single-window path: `startRecording` / `stopRecording` in
  `src/daemon/core-impl.ts` use `RecordingRegistry` and
  `native/swift/SingleWindowRecording.swift`.
- Event bus: `recording.status` and `artifact.added` flow through
  `eventSink` and `src/daemon/server.ts`.
- Composite lifecycle: `recordComposite` is sync by default; `async: true`
  returns a `recordingId`, completes in the background, emits events, and is
  pollable with `getRecording`.

## Chunks

### P1-1 - Composite Docs

Update:

- `docs/prd-spectra-composite.md`
- `docs/plans/spectra-composite-plan.md`
- Adjacent current docs that still describe the deleted recording path.

Acceptance:

- Current docs say SCK composite plus SCK single-window recording are the only
  recording paths.
- Stale crop-from-display instructions are removed or marked retired.

### P1-2 - Build-Loop Intent And Plan

Update:

- `.build-loop/intent.md`
- `.build-loop/plan.md`

Acceptance:

- Both files describe this lane: docs reconciliation plus async
  `recordComposite`.
- They do not contradict `CURRENT.md` or current code.

### P2-1 - Contract Change

Shape:

- Add `async?: boolean` to `RecordCompositeParams`.
- Add an async accepted return shape containing `recordingId`.
- Add `getRecording({ recordingId })`.

Files:

- `src/contract/core-api.ts`
- `src/contract/wire.ts`
- `src/contract/schemas.ts`
- `src/contract/contract.snapshot.json`
- `src/contract/contract.test.ts`

Acceptance:

- Contract snapshot is intentionally updated.
- Drift test checks the new async field and poll operation.
- No drift test is skipped or bypassed.

### P2-2 - Daemon Async Lifecycle

Implementation:

- Add a composite-recordings registry alongside the single-window registry.
- Default `recordComposite` remains synchronous.
- `recordComposite({ async: true })` registers a background recording and returns
  `{ recordingId }` immediately.
- Background completion emits `recording.status` with `saved` or `failed`.
- Successful session-attached completion emits `artifact.added`.
- `getRecording` returns the registry status for a returned `recordingId`.

Tests:

- Add an injected-fakes async lifecycle test in
  `tests/daemon/recording-events.test.ts`.
- Keep existing sync `recordComposite` tests passing.

### Verification

Run:

1. `rg` for deleted-path claims in current docs.
2. `npm run build`
3. `npm run build:composite`
4. `npm test`

## Reporting

Return files changed with line anchors, contract shape and drift-test
confirmation, async lifecycle and poll behavior, sync fallback confirmation, and
test totals.
