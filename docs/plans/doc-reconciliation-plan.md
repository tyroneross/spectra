# Plan P1 — Reconcile stale Spectra docs with code

> Workstream **P1**. Repo: spectra. Low risk, doc-only. Parallelizable with P0
> (disjoint files/repo). Removes the divergences `CURRENT.md` flags.

## Goal
The PRD, composite plan, and `.build-loop/intent.md`/`plan.md` describe the code
as it IS (SCK-only recording; single-window + composite real), so a fresh reader
isn't misled by deleted-path docs.

## Deliverables
1. Updated `docs/prd-spectra-composite.md` + `docs/plans/spectra-composite-plan.md`
2. Reconciled `.build-loop/intent.md` ↔ `.build-loop/plan.md`

## Approach (chunks)
- **P1-1 — PRD + composite plan.** Remove the avfoundation full-display Rung-1
  path (deleted in `b68ee69`); state SCK composite + single-window recording are
  the only recording paths and are real (`startRecording`/`stopRecording` landed
  `94a35af`). Verify every claim against current code before writing.
- **P1-2 — intent ↔ plan.** Resolve the contradiction between `.build-loop/
  intent.md` and `.build-loop/plan.md`; align both to current code + `CURRENT.md`.

## Risks
- Low. Doc-only; no behavior change. Risk is asserting a stale claim — mitigate by
  grounding each edit in a file:line check (the CURRENT.md discipline).

## Acceptance
- No doc claims a deleted/avfoundation path; recording described as SCK + real.
- `intent.md` and `plan.md` no longer contradict each other or the code.
- `CURRENT.md` "Known divergences" section can drop the stale-docs entries.

## Backlog
Items `SPEC-DOCS-*` in spectra's `.build-loop/backlog/`.
