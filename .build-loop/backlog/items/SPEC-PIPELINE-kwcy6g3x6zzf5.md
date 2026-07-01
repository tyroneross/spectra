---
id: SPEC-PIPELINE-kwcy6g3x6zzf5
schema_version: 1
title: "CDP script-runner: execute DemoScript beat actions (search/click/navigate/scroll) via CDP"
status: done
priority: P1
type: feature
area: pipeline
entities: []
gated: none
provenance:
  source: marketing-video-arc
  ref: next-1
evidence: [src/cdp/connection.ts, src/pipeline/script.ts]
supersedes: null
superseded_by: null
created: 2026-06-30
updated: 2026-06-30
review_by: 2026-07-30
owner: claude
---

## Context
The driving that reliably navigated search+graph+categories is an ad-hoc /tmp CDP script. Fold it into Spectra so the DemoScript 'action' fields execute via the built-in CDP client (dist/cdp, Node WebSocket) coordinated with record-only capture -> the full build+execute+tell-the-story loop is committed + repeatable.

## Acceptance
- <verifiable condition 1>

## Notes
<additional detail>

## Resolution (2026-06-30)
CDP DemoScript runner shipped (5cfa529) via 3-model A/B/C; Opus won (robust fallbacks, minimal footprint). Live Chrome integration proven.
