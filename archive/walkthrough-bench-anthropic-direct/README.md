# Archived Walkthrough Bench: Anthropic-Direct Shape

This directory is archived because the runner measured the wrong production
shape.

The primary Spectra path is now host-routed:

1. A host agent such as Claude Code, Codex, or a future LLM coding host reads a
   snapshot.
2. That host LLM plans the next UI action.
3. Spectra executes and captures through MCP tools.
4. The host re-snapshots, checks predicate-or-done success, and loops.

The retired runner called Anthropic directly from `runner.ts`. That measured a
single vendor direct-call planner, not the host-routed plugin experience users
actually invoke.

## What Still Matters

The validity fixes from the bench pass remain active where they are useful to
the host-routed path:

- `spectra_snapshot` returns URL metadata for web sessions.
- URL predicates can be scored against snapshot metadata.
- The standalone app success policy requires predicate match or explicit done.
- Latency can be split into LLM planning time and executor time in future DOE
  work.

## Future DOE Shape

DOE is not retired. Only this Anthropic-direct implementation is retired.

A future DOE should be host-routed and can be run by any active LLM AI agent,
including Codex. The agent under test should use the same Spectra MCP tools
that a real user would use, then record success, latency, capture artifacts,
and any retry decisions.

Until that host-routed DOE exists, use `scripts/verify_cross_agent.sh` as the
small cross-agent smoke check.

## Archived Files

- `runner.ts` and `analyze.ts` are preserved for reference only.
- `walkthrough-runner.test.ts.archived` is the former active unit test for the
  retired runner helper. It is renamed so the active test suite no longer
  asserts support for the archived runner.
