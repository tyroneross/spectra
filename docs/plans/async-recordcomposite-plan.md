# Plan P2 — Async recordComposite

> Workstream **P2**. Repo: spectra. Backend (codex) + contract (joint drift gate).
> Feature polish — `recordComposite` works today (synchronous + emits events); this
> removes the long blocking call now that the SSE bus is live.

## Goal
`recordComposite` returns a `recordingId` immediately and reports completion via
the live SSE bus (`recording.status` → saved/failed) + a poll path — instead of
blocking the caller for capture-duration + encode (today mitigated by a
`duration+120s` client timeout).

## Deliverables
1. Contract: async shape for `recordComposite` (recordingId return / `async` param)
2. Composite-recordings registry + async lifecycle in the daemon
3. A status/poll path (reuse the single-window `RecordingRegistry` pattern)

## Approach (chunks)
- **P2-1 — Contract change (DRIFT GATE).** Add the async return/param to
  `src/contract/core-api.ts` + `wire.ts` + Zod + `contract.snapshot.json`; update
  `contract.test.ts` (NOT bypassed). This is the only contract-touching chunk —
  author jointly, freeze, then implement. Pairs with the single-window
  `StartRecording`/`StopRecording` shapes already in the contract.
- **P2-2 — Daemon async lifecycle (codex).** A composite-recordings registry
  (mirror `RecordingRegistry`, `core-impl.ts:745`); `recordComposite` spawns the
  worker in the background, returns `{recordingId}`, and emits `recording.status`
  on completion via the existing `eventSink` (`core-impl.ts:641`). Add a
  `getRecording`/poll op. Keep a sync fallback for callers that want to block.

## Risks
- **Contract change** → drift gate + the joint freeze process (FE∥BE pattern).
- Behavior change for `recordComposite` callers — keep a sync mode / version it.
- Background process lifecycle: reuse the proven hard wall-clock stop + registry
  cleanup-on-shutdown from the single-window path.

## Acceptance
- `recordComposite` returns a recordingId without blocking; completion arrives via
  SSE; poll returns status; sync fallback intact.
- Contract drift test passes (snapshot updated, not bypassed).
- A test asserts the async lifecycle (start → SSE saved) via injected fakes.

## Backlog
Items `SPEC-DAEMON-*` in spectra's `.build-loop/backlog/`.
