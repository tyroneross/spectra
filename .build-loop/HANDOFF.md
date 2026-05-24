# Handoff — Host-Routed Spectra Walkthroughs

Date: 2026-05-24

## Current Contract

Spectra is host-routed first. A host agent such as Claude Code, Codex, or a
future LLM coding host reads `spectra_snapshot`, plans the next step, and calls
Spectra tools to execute and capture.

The standalone menu-bar app path remains as a fallback for sessions without a
host agent.

## Retired Surface

The former Anthropic-direct walkthrough benchmark was archived under:

```text
archive/walkthrough-bench-anthropic-direct/
```

That runner measured a direct vendor call from `runner.ts`, not the plugin shape
users exercise through a host agent.

## DOE Guidance

DOE is still valid when it measures the host-routed path. Any active LLM AI
agent, including Codex, can perform that future DOE by using Spectra's tools and
recording outcome, latency, retries, and capture artifacts.

Until a host-routed DOE exists, use:

```bash
scripts/verify_cross_agent.sh
```

## Guardrails

- Do not re-add active `bench:walkthrough` scripts for the archived runner.
- Keep URL metadata and success-policy fixes in production code.
- Keep standalone app docs clear that API-key planning is fallback-only.
