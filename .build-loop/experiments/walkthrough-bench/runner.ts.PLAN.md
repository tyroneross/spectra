# walkthrough-bench/runner.ts — Plan

Scope deliberately deferred to the next build-loop dispatch (see
`.build-loop/intent.md` "honest accounting" section). This file documents
the contract so the next pass can pick it up without rebuilding context.

## Inputs

- `tasks.yaml` (parsed via `js-yaml` — add to devDependencies in the impl
  chunk, not now)
- CLI flags:
  - `--design <full|fractional-factorial-16>` (default fractional)
  - `--cells <path-to-design-cells.jsonl>` (override default enumeration)
  - `--out <path-to-runs.jsonl>` (append-only)
  - `--port <N>` (daemon port; default 47823)
  - `--retry-failed` (skip cells already in runs.jsonl with status=ok)
  - `--max-parallel <N>` (default 1 — most LLM rate-limits make parallelism
    counterproductive at this scale)

## Per cell

For each task:
1. POST `/mcp tools/call name=spectra_connect arguments={target,repoPath,launch:true}`
2. Loop:
   - POST `/mcp tools/call name=spectra_snapshot`
   - Build LLM prompt per cell factors F1/F2/F4
   - Call Anthropic per F5 model with F3 retry policy
   - Parse action plan; POST `/mcp tools/call name=spectra_llm_step arguments={sessionId, actions}` (C5 endpoint — must exist; checked at startup)
   - On unrecoverable failure → mark `success=false`, break
   - On success predicate match (post-step) → mark `success=true`, break
   - Hard cap N=10 steps
3. POST `/mcp tools/call name=spectra_session arguments={action:close,sessionId}`

## Per run-row schema (runs.jsonl)

```json
{
  "ts": "2026-05-24T03:00:00Z",
  "git_sha": "abc1234",
  "cell_id": "F1=ax-only,F2=1-action,F3=none,F4=terse,F5=haiku-4-5",
  "task_id": "tp-home-camps-list",
  "success": true,
  "steps_executed": 3,
  "latency_ms_per_step": [820, 1100, 950],
  "tokens_in_per_step": [1900, 2100, 2050],
  "tokens_out_per_step": [180, 240, 200],
  "cost_estimate_usd": 0.0042,
  "elapsed_ms": 4200,
  "error": null
}
```

## Why this is NOT shipped in C2.5

1. Requires C5 (LLM driver + `spectra_llm_step`) to exist on the daemon side. C5 ships in a subsequent chunk.
2. Requires a real `$ANTHROPIC_API_KEY` and live Claude API calls — out of scope for unit-test verification; can only be exercised against the real service.
3. Per `feedback_no_fake_stats.md`: no synthetic benchmark numbers. The runner can only ship once we can run it once and produce a real `runs.jsonl` row to anchor the schema.

## Acceptance for next pass

- `tsx runner.ts --design fractional-factorial-16` produces 128 rows (16 cells × 8 tasks) in `runs.jsonl`.
- A separate `analyze.ts` reads the jsonl and writes `verdict.md` naming the winning cell and the loser cells.
- A `design.md` enumerates the 16 cells with the resolution-V generators used (E.g. F5 = F1*F2*F3*F4 for a 2^(5-1) design).
