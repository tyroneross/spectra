# Cross-Agent Walkthrough Smoke

Purpose: prove the host-routed Spectra path works when a host agent drives the
walkthrough. The host LLM plans from snapshots; Spectra executes and captures.

## Target

Use the deterministic fixture started by the verification script:

```bash
scripts/verify_cross_agent.sh
```

By default it serves `http://127.0.0.1:3000` with three explicit controls:
`Open Sessions`, `Open Export`, and `Open Guidance`.

For a manual host-agent run, start any page with the same three controls or set
`SPECTRA_CROSS_AGENT_URL` to an already-running equivalent target.

## Host-Agent Procedure

1. Call `spectra_connect` with the web UI URL.
2. Call `spectra_snapshot`.
3. Run this three-step walkthrough with `spectra_walkthrough`:
   - `click Open Sessions`
   - `click Open Export`
   - `click Open Guidance`
4. Confirm the walkthrough result contains:
   - `success: true`
   - `stepsCompleted: 3`
   - At least one `screenshotPath`
5. Report:
   - Session ID
   - Final status
   - Screenshot paths

## Success Policy

Use host-routed success semantics:

- Success requires a predicate match or an explicit `done` rationale from the
  latest snapshot.
- Actions alone do not prove success.
- On step failure, re-snapshot and replan once before reporting blocked.

## Deterministic Re-Run

For a non-LLM check, run:

```bash
scripts/verify_cross_agent.sh
```
