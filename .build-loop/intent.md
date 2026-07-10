<!-- intent_run_id: bl-spectra-marketing-content-20260710 -->
# Intent — Spectra Marketing Content Quality System

## Restated intent

Make Spectra direct agents from a target audience and desired action to an evidence-backed narrative, production plan, finished capture, and explicit quality audit instead of treating technically valid media as sufficient marketing content.

## North star

Spectra should remain the reliable capture and production engine for running apps while its shipped agent layer becomes the creative director. The system succeeds when it can explain why a specific viewer should notice, care, believe, and act, then produce media whose claims are visible or otherwise supported.

## Primary users and jobs

- Product builders launching a feature need announcement media without manually inventing a story, shot list, and edit plan.
- Marketing and documentation teams need reusable, audience-specific source footage and derivatives.
- Host agents need a bounded workflow with artifacts, transitions, failure handling, and a stop condition rather than an open-ended prompt.

## Desired operating loop

1. Define the audience, trigger, desired action, channel, and success signal.
2. Diagnose the viewer's current alternative, objection, and required proof.
3. Generate three genuinely different concepts: proof-led, problem-led, and transformation-led.
4. Score and select one concept with a fixed weighted rubric.
5. Produce a dual-track script and storyboard, then capture through existing Spectra tools.
6. Enhance the edit, audit claims and creative quality, repair the weakest blockers, and stop after at most two repair passes.

## Current truth

- `skills/product-marketing/` already chooses format, length, story spine, production settings, and measurement.
- `agents/marketing-planner.md` already routes from intake to production, but it selects one concept too early and has no explicit state machine, evidence ledger, audit threshold, repair loop, or termination contract.
- `spectra_demo` and the media pipeline already provide technically strong capture, captions, styles, zoom, spotlight, audio, and 1080p rendering.
- `commands/spectra.md` does not expose the existing record/library surfaces or a marketing entrypoint.
- `package.json` ships commands and skills but omits agents, so the existing planner is not guaranteed to reach npm users.
- The native menu-bar app is a polished capture and walkthrough controller, not a marketing-director UI. Rally currently blocks writes to `macos/Spectra` until its privacy-pane attribution is proven.
- `fix/recording-finalize-yuv420p` contains one unique, still-unmerged finalization fix; all other inspected branches are already merged or patch-equivalent to `main`.

## Approach lenses

- Clean-sheet lens: a campaign runtime with typed state, persistence, and a native UI could orchestrate the entire loop.
- Current-constraints lens: the plugin already has a host-agent layer and capable capture tools, so the smallest complete increment is a documented artifact protocol plus a production-grade agent prompt, command routing, packaging, and contract tests.
- Selected approach: use the current host-agent boundary now; do not add a daemon API or native UI until real campaign runs show which state must become typed runtime data.

## Constraints

- Preserve all unrelated dirt in the canonical `main` checkout.
- Work on `codex/marketing-content-loop` in the isolated worktree.
- Port the recording finalizer commit; do not merge its stale branch wholesale.
- Do not edit `macos/Spectra` while Rally's M1 blocker is active.
- Add no external service or package.
- Keep evidence separate from inference; unsupported product claims must be removed, reframed, or explicitly requested from the user.
- Each campaign must have one audience, one governing promise, one primary proof sequence, and one primary call to action.

## Non-goals

- Replacing Spectra's existing capture, demo-render, or library APIs.
- Building a full campaign database or analytics backend.
- Adding a new video-generation vendor.
- Shipping native UI during this blocked run.
- Treating arbitrary shorter cuts as valid variants without a distinct viewer question and narrative.

## Activation gate

Done means the recording finalizer is present and tested; the marketing loop is documented and reachable from shipped commands; the agent has deterministic state, artifacts, scoring, evidence, failure, repair, and stop rules; the assessment records current/native quality honestly; packaging contains the agent; and focused plus full repository validation passes.
