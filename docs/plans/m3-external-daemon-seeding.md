# M3 chore — external-daemon fixture seeding (design)

**Status:** DESIGN (assessed in the M2B backlog drain; implement during M3 when the Swift daemon exists to validate against). Not implemented now — a wire-seeding path tested only against the TS daemon would be a dormant half-feature (the recording tier can't be validated without a real-capture host).

## Problem

The conformance oracle (`tests/conformance/`) points at whichever daemon `SPECTRA_DAEMON_SOCKET` names — that's the whole M3 cutover mechanism. But the harness's deterministic fixture state is seeded **in-process** inside the harness-spawned TS daemon (`lib/daemon-runner.ts`): a pristine `readonly` web session with 2 conformant `act` steps, and a seeded-then-active recording for `getRecording`. Those seams do NOT reach an external (Swift) daemon.

For an external daemon, `buildFixtureContext` (`lib/fixture-context.ts`) currently collapses `web = macos = readonly` to a single live `createSession` and leaves `recordingId` undefined. Consequence against a **conforming** Swift daemon:

- `getSession` / `getRun` → routed to a session with **no seeded steps** → validate only an empty/shallow shape, and the recorded corpus (2 conformant steps) **false-REDs** the dual-run diff.
- `getRecording` → `recordingId` undefined → `not_found` (error-only; success shape never checked).
- `startRecording` / `stopRecording` → hit a live macos session with no fixture recording; behavior depends on the host's capture permissions.

So today the external arm would report failures that are fixture-artifacts, not real drift — the oracle is not yet usable as the M3 gate for these ops.

## Two-tier feasibility

**Tier 1 — web/AX-read ops are wire-seedable NOW (deterministic).** The harness already serves a fixed-content page (`startLocalWebFixtureServer` → `<h1>` + a `<button>`). An external daemon can be driven over the socket to reproduce the readonly fixture:
1. `createSession({ target: localWebFixtureUrl })`
2. `snapshot` → find the button element id (real `backendDOMNodeId`, e.g. `e42` — differs from the fake's `el-1`, but `normalize.ts` maps all ids to `<ID>`, so the corpus still matches)
3. `act` ×2 (bare click, then click-with-value) → 2 conformant recorded steps
   → route `getSession`/`getRun` here. Covers snapshot/observe/act/step/llmStep/walkthrough/getSession/getRun/analyze/discover.

**Tier 2 — recording/native-capture ops need a hook or a real-capture host.** `startRecording` requires a macOS session with an app target + Screen-Recording permission; `getRecording` needs a pre-existing recording. There is no deterministic, headless way to seed these over the wire against a real daemon. Two options:
- **(A) daemon-side test-seed control op** — a gated `__conformanceSeed` op (env/flag-guarded, refuses in production) that the daemon implements to inject a deterministic fake recording. Both TS and Swift daemons implement it identically → symmetric seeding, fully headless. Cleanest for parity; costs a small daemon surface.
- **(B) external-mode op-skip list** — in external mode, skip the recording-tier success-shape checks (record them as `⚠ not-validated-externally` rather than false-RED), and validate those ops only against the harness-spawned TS daemon + a future real-capture CI lane. No daemon change; leaves a documented coverage gap for the Swift recording path.

## Recommendation

Implement **Tier 1 wire-seeding** unconditionally (it's deterministic and symmetric) + **Tier 2 option (A)** the gated seed op if the Swift daemon can cheaply implement it; otherwise fall back to **(B)** with a loud `not-validated-externally` marker (never a silent skip — per the oracle-erosion discipline). Decision owner: whoever builds the Swift daemon-core in M3 (the seed-op surface is a daemon design choice).

## Code touch-points (when implemented)

- `lib/fixture-context.ts` `buildFixtureContext` external branch — replace the single-session collapse with the Tier-1 seeding sequence; set `readonlySessionId` to the seeded session.
- `lib/daemon-endpoint.ts` — for Tier 2(A), forward a seed flag; expose the seeded `recordingId`.
- `lib/op-order.ts` / a new external-mode capability list — for Tier 2(B), the `not-validated-externally` set.
- Validate end-to-end by pointing `SPECTRA_DAEMON_SOCKET` at a manually-started TS daemon first (proves the seam), THEN the Swift daemon.

## Why not now

- Tier 1 alone, tested only against the TS daemon, ships code exercised by nothing in CI until the Swift daemon lands (dormant-feature anti-pattern).
- Tier 2 needs an M3 daemon-design decision (seed-op vs skip-list).
- The in-process TS fixtures already give full success-shape + mutation coverage for every op today; this chore is purely about extending that coverage to the external/Swift target, which is M3's job.

**De-risk option (worth doing early):** a CI lane that points `SPECTRA_DAEMON_SOCKET` at a *second, manually-started TS daemon* would exercise the Tier-1 wire-seeding path in CI today — making it non-dormant and proving the external seam end-to-end before the Swift daemon exists. That's a smaller, testable slice of this chore and a good first M3 step.
