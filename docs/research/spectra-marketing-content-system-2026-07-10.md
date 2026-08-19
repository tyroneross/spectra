---
slug: video.spectra.marketing-content-quality-system
title: "Spectra marketing content quality system assessment"
topics: [video, product-marketing, creative-operations, agent-systems]
projects: [spectra]
status: literature
workflow: synthesis
created: 2026-07-10
reviewed: 2026-07-10
topic_velocity: medium
tags: [spectra, marketing-video, creative-loop, native-macos, content-quality]
confidence: partial
corroboration: 4
sources:
  - url: https://support.google.com/google-ads/answer/14783551?hl=en-GB
    tier: T1
    domain: support.google.com
    primary: true
    captured: 2026-07-10
  - url: https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications
    tier: T1
    domain: developer.apple.com
    primary: true
    captured: 2026-07-10
  - url: https://developer.apple.com/app-store/app-previews/
    tier: T1
    domain: developer.apple.com
    primary: true
    captured: 2026-07-10
  - url: https://wistia.com/learn/marketing/optimal-video-length
    tier: T2
    domain: wistia.com
    primary: true
    captured: 2026-07-10
  - url: https://wistia.com/learn/marketing/video-marketing-statistics
    tier: T2
    domain: wistia.com
    primary: true
    captured: 2026-07-10
related: []
---

# Spectra marketing content quality system assessment

## TL;DR

Spectra is already a capable capture and rendering engine, but before this work it was not a complete marketing-content system. It could record real UI, render polished clips, add captions, and manage media, yet its planner moved from a three-field intake directly to one story spine. It did not compare concepts, bind claims to evidence, audit audience/conversion quality, or repair weak work. The native app likewise controls capture and walkthroughs rather than campaigns. This build adds the missing host-agent creative loop and recording-integrity gate without expanding the daemon API or touching blocked native code. The system is now ready for representative campaign evaluation, not yet proven “world class.” That claim requires real audience tests, retention/action data, and at least three end-to-end campaign runs.

## Bottom line

The correct product boundary is:

> Spectra's engine captures and renders product truth. The marketing agent decides which truth matters to a defined audience, turns it into evidence-backed narrative, and rejects work that is technically valid but strategically weak.

This is materially different from “add an LLM that writes scripts.” The shipped loop now defines campaign state, artifacts, transitions, claim evidence, concept selection, audit blockers, repair limits, and termination.

## Current-state assessment

| Surface | Current strength | Current limitation | Verdict |
|---|---|---|---|
| Capture engine | Web, macOS, iOS, and watchOS targets; snapshots, guided actions, screenshots, video, composite capture | Historical session corpus contains many admitted stub files | Strong capability; integrity gate was required |
| Render/polish | H.264 output, yuv420p, fast-start, captions, zoom, spotlight, styles, optional voiceover | A polished render is not automatically audience-relevant or persuasive | Technically strong, creatively ungated before this build |
| Product-marketing skill | Audience/product/channel playbooks, story spine, production mapping | Selected one route too early; length rules and Apple claims included stale absolutes | Useful foundation, insufficient quality system |
| Marketing agent | Could plan and optionally call Spectra | No state schema, evidence ledger, failure contract, audit threshold, repair cap, or packaged distribution | Prototype prompt before; production contract now |
| Commands/package | Capture/walk/session commands shipped | Marketing agent omitted from npm `files`; router omitted record/library/marketing | Discoverability/distribution defect now fixed |
| Native app | Polished Aurora Glass capture controller with permissions, repo selection, walkthrough, recordings, sessions, recovery states | No audience, desired action, placement, concept, evidence, storyboard, audit, or campaign state | Capture app, not yet content director |

## Actual output quality sample

### Technical sample

The local `.spectra/sessions` corpus was inspected on 2026-07-10. It includes automated-test sessions, so counts are evidence of registry behavior rather than a production success rate.

- 150 non-raw `.mp4` files existed.
- 125 were 5 bytes or smaller.
- 20 were between 1 KB and 99 KB; several current 2 KB files were deliberate unit-test fixtures.
- Five were larger than 100 KB and suitable for media inspection.

Four recent real Atomize AI captures were:

| Property | Observed |
|---|---|
| Codec/profile | H.264 High |
| Pixel format | yuv420p |
| Size | 1.2–4.9 MB |
| Duration | 7.28–22.87 seconds |
| Dimensions | 1728×972 |
| Frame rate | constant 60 fps |
| Audio | no audio stream |

A fifth 258-second web recording was H.264 High/yuv420p at 1920×1440, but reported nominal `r_frame_rate=120/1` and average rate about 59.31 fps. That mismatch is consistent with the variable/irregular timing class that a normalization pipeline should remove before channel delivery.

### Visual sample

A six-position contact sheet from the newest real capture showed:

- authentic product UI rather than a mockup;
- stable, sharp dark-theme capture;
- browser chrome and large unused frame area;
- interface text too small for feed/mobile use;
- repeated/idle feed states and a loading skeleton;
- no audience hook, governing promise, caption track, proof annotation, or CTA.

The sample is useful source footage. It is not a ready marketing asset. A creative audit cannot honestly produce a readiness score because no primary audience, viewer question, desired action, claim ledger, or destination was associated with the recording. It would nevertheless fail the readiness gate on unresolved brief fields and absent conversion continuity.

### Reliability conclusion

The historical 5-byte artifacts validate the need for the recording finalizer. The new branch code:

- preserves raw media as `<recording-id>.raw.mp4`;
- remuxes already-compatible H.264/yuv420p or transcodes other pixel formats;
- pins yuv420p and fast-start metadata;
- validates size, video stream, duration, pixel format, and `moov` atom;
- records a failed state and registers no artifact when validation fails;
- provides `scripts/rescue-recording.sh` for recoverable historical raw media.

This protects future output; it does not retroactively repair existing stubs.

## Root cause of the creative gap

Spectra's previous abstraction was a **capture session**:

```text
target → walkthrough instructions → record → stop → media path
```

World-class marketing content needs a **campaign decision system**:

```text
audience + trigger + desired action + placement
→ three concepts
→ evidence-gated selection
→ claim-linked storyboard
→ capture/render
→ audience/conversion audit
→ bounded repair
```

The capture-session model optimizes whether the app can be shown. The campaign model optimizes what should be shown, to whom, why it is believable, and what happens next.

## Research translated into product rules

### 1. Viewer intent governs runtime

The shortest format that fully answers the current viewer question is the right starting point:

| Viewer question | Starting range | Content job |
|---|---:|---|
| Why notice? | 6–15 sec | recognition/curiosity |
| Why care? | 20–120 sec | relevance/value |
| Why believe? | 2–8 min | proof/objection resolution |
| How does it work? | 3–15 min per task | evaluation/completion |
| How do I become capable? | structured sequence | learning/practice |

This resolves the apparent short-versus-long conflict. Feed interruption earns seconds; intentional search and evaluation earn time while each section continues answering the viewer's question. Wistia's first-party guidance likewise varies runtime by goal rather than declaring one universal optimum.

### 2. Attention, brand, connection, proof, and direction are separate jobs

Google's official ABCD framework reinforces early attention, clear branding/product presence, a focused human connection, and explicit direction. The supplied research adds a needed proof dimension for technical products. Spectra's audit therefore scores hook relevance, product visibility, audience/outcome relevance, proof/credibility, and CTA/conversion continuity separately.

### 3. Concept selection must compare alternatives

The agent generates exactly three routes:

1. Proof-led: input → product action → verified result.
2. Problem-led: current friction → cost → product resolution.
3. Transformation-led: before → product transition → after.

Selection uses fixed weights totaling 100: audience 20, clarity 15, proof 20, differentiation 15, emotion 10, conversion 10, feasibility 10. This is a repeatable heuristic, not a performance forecast.

### 4. Claims need an evidence ledger

Every material claim is `directly_demonstrated`, `supported_source`, `customer_evidence`, `inferred`, or `unsupported`. Unsupported claims are blocking. Inference must be reframed as possibility or supported before production. Every material storyboard beat links claim ID to source or proof shot.

### 5. Readiness requires score plus blockers

The 15-dimension audit totals 75 points. A result becomes `READY_TO_TEST` only at 65/75 or higher with zero blockers. Unsupported claims, absent proof, broken CTA/destination continuity, unreadable/misleading footage, and invalid output block readiness regardless of the total. Repair is capped at two passes.

### 6. Reuse footage; redesign narratives

A complete 5–8 minute source workflow can support a 6–10 second magic moment, 15–30 second teaser, 30–45 second proof clip, 60–120 second overview, 3–8 minute demo, and task tutorial. Each derivative answers a different viewer question. Arbitrary cuts or speed-ups do not satisfy this rule.

## Implemented agent system

### State and artifacts

The host agent now runs:

```text
DEFINE → DIAGNOSE → CONCEPT → SELECT → EVIDENCE → STORYBOARD
→ PRODUCE → ENHANCE → AUDIT → REPAIR (maximum two) → READY_TO_TEST
```

Plan-only work stops at `PLAN_READY`. Missing input/evidence, failed production, or a structurally weak concept terminate explicitly.

Campaign artifacts live under `.spectra/campaigns/<slug>/` when writes are available:

```text
manifest.json
creative-brief.md
diagnosis.md
concepts.md
claim-ledger.md
script.md
storyboard.md
production-plan.md
audit.md
```

### Permission and failure boundary

The agent is T3: it can write reversible campaign artifacts, navigate the requested target, and create local media. It cannot publish, deploy, spend, delete user data, change permissions, or overwrite irreplaceable source media without explicit approval. It reports exact operation errors and recovery steps instead of fabricating results.

### Prompt quality assessment

Manual Prompt Builder rubric, not an external model evaluation:

| Dimension | Before | After | Evidence |
|---|---:|---:|---|
| Accuracy/grounding | 3 | 5 | repo-first context, current official rules, claim evidence states |
| Clarity | 3 | 5 | one role, named states, state exit gates |
| Constraints | 3 | 5 | T3 permission boundary, no fabrication/publishing, source preservation |
| Determinism | 2 | 5 | fixed concepts, weights, state object, repair cap, terminal statuses |
| Completeness | 2 | 4 | tools, failures, receipt, plan/produce/audit modes; runtime enforcement remains host-dependent |
| **Total** | **13/25** | **24/25** | target threshold met; structural regression test added |

## Native app assessment

### What it does now

`macos/Spectra/Views/MenuBarPopover.swift` and `SpectraViewModel.swift` show that the native app:

- selects a repository;
- accepts walkthrough instructions;
- starts a recorded session;
- stops and closes it;
- previews/reveals recent recordings;
- lists sessions and recovery states;
- runs a standalone `WalkthroughPlanner` through `AnthropicClient`/`PromptBuilder`, with the user's key in Keychain.

The Aurora Glass surface is visually coherent and the capture states are well handled. The product logic is still operational, not marketing-specific.

### What is missing

The native app has no campaign mode, audience, trigger, desired action, placement, viewer question, concept comparison, claim ledger, storyboard review, proof blocker, audit score, or repair state. A free-form walkthrough instruction cannot reliably encode all of those contracts.

### Recommended native follow-on

After the Rally blocker clears and UI Guidance is consulted:

1. Keep the menu-bar popover as a start/resume/status surface.
2. Open a dedicated campaign window or sheet for the creative brief and review; do not force the full loop into a 380-point popover.
3. Use the same `.spectra/campaigns/<slug>/` artifact contract as the host agent.
4. Show selected concept, proof blockers, current phase, readiness score, and next action.
5. Route to a host agent when available; make the standalone planner consume the same state/artifacts so logic does not fork.
6. Preserve the active Aurora Glass register and Calm Precision interaction model.

### Active native blocker

Rally fact `fact_6edf_18bf9c15e8951b50` blocks writes to `macos/Spectra`: privacy-pane attribution is not proven for `dev.spectra.app`. Screen & System Audio Recording showed helper/bare binaries; Accessibility evidence was inconclusive. Native marketing UI work must not start until the app/helper attribution is fixed and recaptured.

## Branch and merge assessment

Live state at assessment:

- `main` and `origin/main` both point to `f3129c8`.
- The canonical `main` checkout has pre-existing `.build-loop`, `.ibr`, retrospective, and notarization-script changes. They were preserved.
- Work proceeded in isolated branch/worktree `codex/marketing-content-loop`.

| Branch | Relationship to `main` | Decision |
|---|---|---|
| `feat/ui-reskin-aurora-glass` | ancestor of `main` | already merged; no action |
| `rally/codex-01/02/03` | ancestors of `main` | already merged; no action |
| `worktree-agent-*` inspected | ancestors of `main` | already merged; no action |
| `codex/m4-cdp-port` | commit is patch-equivalent to `main` (`git cherry` marks `-`) | do not merge |
| `fix/recording-finalize-yuv420p` | one unique stale commit | do not merge wholesale; superseded by the reconciled finalizer on this branch |
| `codex/marketing-content-loop` | isolated implementation branch | merge only after final validation; do not overwrite canonical dirt |

No existing branch needed to merge into `main` before this work. The only useful delta was ported and improved rather than importing stale generated files and an unnecessary public error-code expansion.

## What remains before “world class” is evidence-backed

1. Run three representative campaigns through `/spectra:marketing`: a developer tool, a consumer/native app, and an enterprise workflow.
2. Require all campaign artifacts and zero audit blockers.
3. Have target-audience reviewers answer: who is this for, what promise did it make, what proof did they see, and what should they do next?
4. Measure the intended action and retention through the proof sequence, not views alone.
5. Compare one variable per experiment.
6. Implement the native campaign surface only after Rally's attribution blocker clears.

Recommended first benchmark: market Spectra itself to a developer/product builder using the 45–60 second proof-led default—brief → three concepts → one realistic capture-to-polished-output task → audit → two derivatives. That tests the system on its own product and exposes any mismatch between the agent contract and live operations.

## Sources and provenance

### User-supplied research

- `/Users/tyroneross/.codex/attachments/34868906-28df-4ae8-9b24-4effccf29bd5/pasted-text.txt` — commercial job, ABCPD, three concepts, weighted selection, claim evidence, storyboard, audit rubric.
- `/Users/tyroneross/.codex/attachments/88fee99a-846e-42e3-b593-df0cb99d6e08/pasted-text.txt` — viewer-intent runtime rule and distinct derivative narratives.

### Current external sources

- [Google Ads ABCDs of effective video ads](https://support.google.com/google-ads/answer/14783551?hl=en-GB)
- [Apple app preview specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications)
- [Apple app preview creative guidance](https://developer.apple.com/app-store/app-previews/)
- [Wistia: choosing marketing video length](https://wistia.com/learn/marketing/optimal-video-length)
- [Wistia video marketing statistics](https://wistia.com/learn/marketing/video-marketing-statistics)

## Raw

Evidence was collected from the current repo, branch graph, Rally room, local `.spectra/sessions` metadata/media, the two supplied research files, and the current official/vendor sources above. No long source extract is reproduced here. Key commands: `git cherry -v`, `git merge-base --is-ancestor`, `ffprobe -show_entries`, file-size distribution over session MP4s, plan/skill frontmatter validators, focused Vitest, npm build, and npm package dry-run.
