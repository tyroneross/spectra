# Handoff

Date: 2026-05-24
Scope: C7.a walkthrough-bench validity

## What Changed

The walkthrough benchmark now measures the factors it claims to measure before any live DOE run:

- `spectra_snapshot` returns URL metadata for web sessions.
- URL predicates score against the snapshot response URL.
- `axPlusScreenshot` cells request screenshot payloads in the TypeScript runner and Swift walkthrough planner.
- `oneRetryResnapshot` retries a failed executor step once by re-snapshotting and replanning.
- Success requires an explicit planner `done` signal or a predicate match.
- `runs.jsonl` rows now split `llmLatencyMs` and `executorLatencyMs`; analyzer falls back to legacy latency fields.

## One-Cell Smoke

Start the daemon from a built repo:

```bash
npm run build
npm run daemon
```

In a second shell, run one real benchmark cell:

```bash
ANTHROPIC_API_KEY=… npm run bench:walkthrough -- --cells=00
```

Analyze the result:

```bash
npm run bench:walkthrough:analyze
```

Expected outputs:

- `.build-loop/experiments/walkthrough-bench/runs.jsonl`
- `.build-loop/experiments/walkthrough-bench/verdict.md`

Do not run the full DOE until the one-cell smoke produces a real row with `llmLatencyMs`, `executorLatencyMs`, and no fabricated success.

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
