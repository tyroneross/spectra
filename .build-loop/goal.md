# Goal — Spectra Marketing Content Quality System

## Goal

Ship the smallest complete host-agent creative loop that turns a marketing brief into a selected concept, evidence-backed storyboard, Spectra production run, and bounded audit/repair result, while also porting the only unique branch fix required to make recorded output reliably playable.

## Scoring criteria

1. **Recording integrity** — every stopped real recording is finalized to broadly compatible H.264/yuv420p with fast-start metadata and validated before registration; existing stub/test behavior remains supported.
2. **Narrative quality contract** — the product-marketing skill defines the brief, three concept routes, weighted selection, evidence ledger, dual-track storyboard, audit threshold, and maximum two repair passes.
3. **Agent determinism** — the planner prompt names state, artifacts, tool routing, transitions, failure modes, termination conditions, and a structured final response.
4. **Distribution and discoverability** — `/spectra:marketing` exists, `/spectra` routes marketing intent and lists current record/library surfaces, and npm packaging includes `agents/`.
5. **Assessment fidelity** — a durable report separates current technical strengths, creative gaps, native-app status, branch disposition, verified external constraints, and the next native adoption slice.
6. **Regression safety** — focused contract/media tests, build, full tests, and package dry-run pass after the final mutation.

```acceptance_probe
[
  {
    "id": "C1",
    "criterion": "Recording output is finalized and validated before it is registered",
    "acceptance_probe": "test -f src/media/finalize-recording.ts || printf 'missing-recording-finalizer\\n'",
    "baseline": "missing-recording-finalizer",
    "boundary": "data",
    "defect_class": true
  },
  {
    "id": "C2",
    "criterion": "The shipped marketing skill defines a bounded creative quality loop",
    "acceptance_probe": "test -f skills/product-marketing/references/creative-loop.md || printf 'missing-creative-loop\\n'",
    "baseline": "missing-creative-loop",
    "boundary": "data",
    "defect_class": false
  },
  {
    "id": "C3",
    "criterion": "Marketing intent has a discoverable slash-command entrypoint",
    "acceptance_probe": "test -f commands/marketing.md || printf 'missing-marketing-command\\n'",
    "baseline": "missing-marketing-command",
    "boundary": "console",
    "defect_class": false
  },
  {
    "id": "C4",
    "criterion": "The npm package includes the marketing agent surface",
    "acceptance_probe": "node -e \"const p=require('./package.json'); if (!(p.files||[]).includes('agents/')) process.stdout.write('missing-agents-package-surface\\\\n')\"",
    "baseline": "missing-agents-package-surface",
    "boundary": "data",
    "defect_class": true
  },
  {
    "id": "C5",
    "criterion": "The current and native marketing-content assessment is durable in the repo",
    "acceptance_probe": "test -f docs/research/spectra-marketing-content-system-2026-07-10.md || printf 'missing-marketing-assessment\\n'",
    "baseline": "missing-marketing-assessment",
    "boundary": "data",
    "defect_class": false
  }
]
```

## Pass conditions

- Pass: all six criteria have current evidence and no acceptance probe remains at baseline.
- Partial: implementation works but native adoption remains deferred by the already-recorded Rally blocker.
- Fail: any recording regression, unshipped agent surface, unsupported-claim path, or failed final verification.
