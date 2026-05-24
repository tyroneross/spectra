# Walkthrough-bench DOE design

Five binary factors, 2^(5-1) = 16-cell resolution-V fractional factorial.
Generator: `F5 = F1 ⊕ F2 ⊕ F3 ⊕ F4`. All main effects and 2-way
interactions are estimable clear of each other.

## Factors

| # | Factor (config field) | Low (0) | High (1) |
|---|---|---|---|
| F1 | `snapshot` | `axOnly` | `axPlusScreenshot` |
| F2 | `granularity` | `oneAction` | `threeToFive` |
| F3 | `retry` | `none` | `oneRetryResnapshot` |
| F4 | `structure` | `terse` | `roleToolsThreeShot` |
| F5 | `model` | `claude-haiku-4-5` | `claude-sonnet-4-6` |

> The `domOnly` and `oneRetryBroaden` levels declared in PromptBuilder.swift
> are reserved for **1FAT refinement** after the fractional factorial.
> They are NOT in the 16-cell run.

## Cell enumeration

The 16 rows are emitted by `fractionalFactorial16(['F1','F2','F3','F4','F5'])`
in `lib/score.ts`. The runner reads this directly; do not hand-edit the order.

## Run scheme

For each of 16 cells × 8 tasks = 128 attempts:

1. Spawn a fresh `spectra_connect` session against the task's target.
2. Loop up to `task.timeout_ms / 6_000` ≈ 10 turns:
   - `spectra_snapshot`
   - Ask Claude (via Anthropic API directly from the runner — daemon never
     sees the key) for an action plan per the cell's factor levels.
   - POST `spectra_llm_step` with the plan.
   - Score the post-step snapshot against `task.success_predicate`. Break on
     match.
3. Close the session.
4. Append one row to `runs.jsonl`.

## Primary metric

`success` (boolean), aggregated as success rate per cell.

## Secondary metrics

- `latency_ms_per_step` (median over executed steps)
- `tokens_in_per_step` + `tokens_out_per_step` (mean per step)
- `cost_estimate_usd` (input × per-token rate + output × per-token rate; rates
  resolved at run time from the model id).

## Acceptance criteria for shipping a winning cell

A cell is "the winner" iff:

1. Success rate >= 85% (criterion 7 from `goal.md`).
2. Median latency/step <= 3500 ms.
3. Mean tokens/step <= 2900.
4. Beats the runner-up by >= 1.5σ on (1) at p<0.10 (since n=8 per cell).

If no cell meets all four criteria, the verdict.md lists the runner-up + a
diagnostic ("noisy variance" / "Pareto frontier") and the DOE is repeated
with a refined design.

## Refinement pass (1FAT × 6)

Once the fractional run is in, the top-effect factor (by absolute main effect
on success rate) gets a 6-run one-factor-at-a-time sweep across the level
range NOT already covered. Example: if F1 is top, we run 6 cells at
`snapshot = domOnly` × the winning levels of F2/F3/F4/F5. The refinement is
included in the same `runs.jsonl` with `cell_id` prefix `refine-`.

## Reproducibility

- Each row carries `git_sha` so a re-run on a future commit is comparable.
- `tasks.yaml` is append-only; never delete a task without recording why in
  `verdict.md`.
- `temperature: 0` is hard-coded in the Anthropic client.
- `max_tokens` is 1024 (PromptBuilder default).
