# Experiments

Phase 5 Iterate DOE workspace.

- `video-bench/` — criterion 8 (UI video recording quality)

`walkthrough-bench/` was archived to
`archive/walkthrough-bench-anthropic-direct/` because it measured a direct
Anthropic runner rather than Spectra's host-routed plugin path. DOE remains
valid when it is host-routed and can be performed by any active LLM AI agent,
including Codex.

The remaining active track has this shape:
- `*.yaml` — benchmark tasks/flows
- `README.md` — DOE protocol, factors, metrics, scoring
- `runner.ts.PLAN.md` — contract for the runner script (deferred to next dispatch)
- After first run (next dispatch): `design.md`, `runs.jsonl`, `verdict.md`

## Why no `runs.jsonl` or `verdict.md` yet

These artifacts depend on:
- A successful first end-to-end capture against real screen content for video-bench (Screen Recording permission, ffmpeg avfoundation device discovery — none of which can be unit-tested)
- Real screen interaction and ~hours of wall-clock for the full 16-cell sweep per criterion

Per `feedback_no_fake_stats.md`: no synthetic measurements. Schemas and protocols are committed now so the next dispatch starts from a known surface; numbers land when the runner ships and runs against the live daemon.

## Long-run authorization budget

From the user brief (Phase 5 Iterate DOE policy):
- Up to 16 DOE runs per active criterion + 6 1-factor-at-a-time refinement runs per criterion.
- No early termination on DOE because results "look good" — full design must complete.
- Winning configurations become permanent defaults; losing configurations get filed as experimental opt-in flags, never deleted.
