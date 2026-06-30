---
id: SPEC-INFRA-kwcy6gc38amy9
schema_version: 1
title: "dist/native install-sync: daemon runs ~/.spectra/dist, dev builds don't propagate"
status: done
priority: P2
type: infra
area: infra
entities: []
gated: none
provenance:
  source: marketing-video-arc
  ref: friction
evidence: [package.json]
supersedes: null
superseded_by: null
created: 2026-06-30
updated: 2026-06-30
review_by: 2026-07-30
owner: claude
---

## Context
Repeated friction: the daemon execs ~/.spectra/dist (+ ~/.spectra/bin native), but npm run build updates the DEV dist; changes need a manual 'rsync dist/ ~/.spectra/dist/' + restart. Add a relink/sync step (or symlink) so build propagates to the running daemon automatically.

## Acceptance
- <verifiable condition 1>

## Notes
<additional detail>

## Resolution (2026-06-30)
postbuild sync-dist.sh propagates dist/ -> ~/.spectra/dist (5a95c13).
