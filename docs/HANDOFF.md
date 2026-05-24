# Handoff

Date: 2026-05-24
Scope: host-routed walkthrough path

## Current Direction

Spectra walkthroughs are host-routed first. Claude Code, Codex, or another host
LLM plans from `spectra_snapshot`; Spectra executes and captures through MCP
tools.

The archived Anthropic-direct benchmark was moved to
`archive/walkthrough-bench-anthropic-direct/` because it measured a direct
vendor call rather than the host-routed plugin path.

DOE is still allowed when it measures the host-routed path. Any active LLM AI
agent, including Codex, can perform that future DOE by using Spectra's MCP
tools and recording the outcomes.

## Cross-Agent Smoke

Start from a built repo:

```bash
npm run build
```

Run the deterministic smoke:

```bash
scripts/verify_cross_agent.sh
```

Expected result:

- A Spectra daemon starts on a local port.
- The web UI starts on a local port.
- `spectra_connect` opens a session against the web UI.
- `spectra_walkthrough` executes a three-step flow.
- At least one screenshot path is returned.

## Guardrail Checks

Run before handing to the verifier:

```bash
npm test
./node_modules/.bin/tsc --noEmit
cd web-ui && npm test
cd web-ui && npx tsc --noEmit
```

For macOS validation:

```bash
cd macos
xcodebuild -project Spectra.xcodeproj -scheme Spectra -configuration Debug -derivedDataPath build/derived CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO test
```
