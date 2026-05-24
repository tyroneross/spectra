# Walkthrough Benchmark

Drives Phase 5 Iterate DOE for **criterion 7** (text-input walkthrough quality, ≥85% success on ≥8 tasks at ≤3.5s/step median latency and ≤2500 in + 400 out tokens/step median).

## What's measured

Per (configuration × task) cell:
- `success`: boolean — did `success_predicate` resolve true after walkthrough completion?
- `steps_executed`: integer
- `latency_ms_per_step`: list
- `tokens_in_per_step`: list (from app-side telemetry, posted via `spectra_session record_llm_usage`)
- `tokens_out_per_step`: list
- `cost_estimate_usd`: float

## DOE factor design (criterion 7)

| # | Factor | Levels |
|---|---|---|
| F1 | Snapshot type fed to LLM | `ax-only` / `dom-only` / `ax+screenshot` |
| F2 | Granularity per LLM turn | `1-action` / `3-5-action-plan` |
| F3 | Retry policy on low-confidence resolve | `none` / `1-retry-resnap` / `1-retry-broaden` |
| F4 | System-prompt structure | `terse` / `role+tools+3-shot` |
| F5 | Model | `claude-haiku-4-5` / `claude-sonnet-4-6` |

Design: 5 factors × 2 levels = 32-cell full factorial. Fractional factorial **2^(5-1) = 16 runs** (resolution V, all 2-way interactions clear of main effects). The 16 cells are enumerated in `design.md` at run time.

**Refinement (1FAT × 6):** finer levels on the top-effect factor (likely F1 or F5) after the main DOE picks a winner.

## Primary + secondary metrics

| Metric | Direction | Source |
|---|---|---|
| Task success rate | maximize | `success_predicate` |
| Median tokens/step | minimize | app telemetry |
| Median latency/step | minimize | walkthrough response |

Winner = highest success rate; ties broken by lower tokens/step, then lower latency.

## Running

The runner is `runner.ts` (TypeScript, executed via `tsx` against the live daemon). It expects:

1. Daemon running on `127.0.0.1:47823` (or `--port`).
2. Anthropic API key in `$ANTHROPIC_API_KEY` (runner does the LLM calls directly — the SwiftUI app is not in the loop for benchmarking).
3. Each task's `target` reachable.

```
ANTHROPIC_API_KEY=... \
  tsx .build-loop/experiments/walkthrough-bench/runner.ts \
  --design fractional-factorial-16 \
  --out .build-loop/experiments/walkthrough-bench/runs.jsonl
```

One JSONL row per (cell, task). Aggregate via `analyze.ts` (read-only post-pass) → `verdict.md`.

## Honest scope of THIS commit

This file + `tasks.yaml` define the benchmark surface. The runner + analyze scripts are scaffolded with explicit TODOs in `runner.ts.PLAN.md` (see same dir). The actual DOE execution — which requires the daemon + travel-planner running, an Anthropic key, and ~hours of wall-clock for 16 cells × 8 tasks × LLM round-trips — is the entry point for the next build-loop dispatch.
