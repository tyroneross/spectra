---
name: product-marketing
description: >
  Use when planning, producing, improving, or auditing product marketing content
  for software: launch videos, App Store previews, demos, explainers, website
  overviews, social clips, tutorials, changelog videos, content ladders, or when
  Spectra should turn a product, audience, placement, and desired action into
  evidence-backed capture and polished media. Runs a bounded creative loop from
  brief through concept selection, production, audit, and repair.
user-invocable: true
---

# Product Marketing — define → create → audit → repair

Use this skill as the creative director above Spectra's capture and rendering operations. Technical media quality is necessary; the governing outcome is a specific audience understanding the promise, believing the proof, and knowing what to do next.

Full quality protocol: `references/creative-loop.md`. Full legacy source playbook: `references/SOURCE-GUIDE.md`.

## Governing rule

**Choose the shortest format that answers the viewer's current question in its actual placement.**

| Viewer question | Starting range | Job |
|---|---:|---|
| Why notice this? | 6–15 sec | recognition or curiosity |
| Why care? | 20–120 sec | relevance and value |
| Why believe it? | 2–8 min | proof and objection resolution |
| How does it work? | 3–15 min per task | evaluation or task completion |
| How do I become capable? | structured sequence | learning and practice |

Explainers usually sell the problem to colder viewers. Demos usually prove the solution to warmer viewers. Treat that as a useful second decision, not a substitute for audience, placement, and viewer intent.

## Required creative loop

1. **DEFINE** — resolve product, primary audience, trigger, current alternative, desired action, placement, viewer question, and success metric.
2. **DIAGNOSE** — write the friction, proposition, outcome, objection, proof inventory, and magic moment.
3. **CONCEPT** — create three distinct routes: proof-led, problem-led, and transformation-led.
4. **SELECT** — score all three with fixed weights: audience 20, clarity 15, proof 20, differentiation 15, emotion 10, conversion 10, feasibility 10.
5. **EVIDENCE** — classify every material claim as directly demonstrated, supported source, customer evidence, inferred, or unsupported. Remove unsupported claims; do not phrase inference as fact.
6. **STORYBOARD** — align timed visual and audio/text tracks. Map each claim to a source or shot. Use one promise, one proof sequence, and one CTA.
7. **PRODUCE** — capture real product behavior through current Spectra operations; preserve the clean source.
8. **ENHANCE** — tighten relevance, pacing, readability, audio, framing, captions, poster frame, and channel export.
9. **AUDIT** — score the 15-dimension rubric in `references/creative-loop.md`. Ready requires at least 65/75 and zero blockers.
10. **REPAIR** — address blockers and the three weakest dimensions, re-render affected assets, and re-audit. Stop after two repair passes.

Terminal results: `PLAN_READY` for plan-only requests; otherwise `READY_TO_TEST`, `BLOCKED_MISSING_INPUT`, `BLOCKED_MISSING_EVIDENCE`, `PRODUCTION_FAILED`, or `REPLAN`.

## Campaign artifacts

When file writes are available, persist under `.spectra/campaigns/<slug>/`:

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

If writes are unavailable, return the same named sections inline. Do not omit the losing concepts, evidence ledger, or audit.

## Starting decision matrix

These are defaults to test against the brief, not rigid prescriptions.

| Product / audience | Starting asset | Starting runtime | Primary placement |
|---|---|---:|---|
| AI agent / developer | workflow demo or tutorial | 3–10 min | YouTube, docs, README |
| AI agent / SMB | proof-led overview | 45–90 sec | website, LinkedIn |
| Plugin / developer | before/after proof | 30–90 sec | Product Hunt, LinkedIn, YouTube |
| iOS / consumer | App Store preview | 15–30 sec | App Store |
| Apple Watch / consumer | glance-moment product clip | 15–30 sec | website and social; App Store uses screenshots |
| macOS / power user | native workflow overview + demo | 60 sec–5 min | website, YouTube, App Store |
| Web app / SMB | overview plus complete demo | 60–120 sec + 3–5 min | website, LinkedIn, email |
| Web app / enterprise | use case or customer proof | 2–8 min | sales, website |

For a new product with limited performance data, default to a **45–60 second proof-led video showing one realistic task from input to verified result, product visible within five seconds, and one low-friction CTA**.

## Production calibration

Match polish to audience and placement. If audio is used, it must be clean; the visual/text track must still carry the core message for muted autoplay.

| Audience | Starting polish | Spectra style |
|---|---|---|
| Developer / technical | authentic, readable, low–medium | `cool`, spotlight off |
| SMB / prosumer | clean and direct, medium | `cool` or `warm` |
| Consumer | aesthetic and fast, medium | `warm` |
| Enterprise / investor / hero | controlled, medium–high | `bold`, spotlight only when useful |

## Route production through Spectra

- **Connect and inspect:** `spectra_connect` → `spectra_snapshot`/`spectra_analyze`.
- **Capture the planned proof:** `spectra_step`/`spectra_act`/`spectra_discover` → `spectra_capture`; use real UI and representative data.
- **Record a source workflow:** start/stop video capture or the current record command; enable cursor telemetry when pointer motion carries meaning.
- **Polish:** use current `spectra_demo` polish/run-script actions with the selected style, captions, optional spotlight, and voiceover.
- **Preserve:** add durable, approved source and derivatives to `spectra_library` with campaign, audience, channel, and feature tags.

Confirm an operation exists in the live tool list before promising production. On failure, return the exact failed operation and recovery step; never invent an artifact.

## App Store accuracy

Apple's current upload specification requires 15–30 seconds, accepts H.264 up to High Profile Level 4.0 or ProRes 422 HQ, accepts `.mov`/`.m4v`/`.mp4`, permits at most 30 fps, and restricts macOS previews to landscape. If audio is present, follow Apple's AAC stereo bitrate/sample-rate specification.

Spectra's stricter **house export** is H.264/yuv420p, constant 30 fps, fast-start MP4, and clean AAC stereo when audio is used. Constant frame rate, yuv420p, and fast-start are compatibility choices; do not mislabel them as Apple requirements.

Apple's creative guidance requires app-only footage, prohibits filming hands/devices, advises a cohesive story, and says previews autoplay muted by default. Do not include specific prices; disclose when shown functionality requires purchase, subscription, or login.

## Sound-off and evidence defaults

- Burn in readable captions when dialogue or narration matters.
- On-screen text must carry the promise and CTA without relying on audio.
- Use zoom, cursor emphasis, and spotlight to guide attention, not decorate.
- A material spoken or written claim must point to a product shot, current source, measurement, or attributable customer evidence.

## Derivatives and measurement

Capture one complete source workflow when feasible, then create distinct narratives for the magic-moment clip, teaser, proof clip, overview, demo, and tutorial. Do not call arbitrary shorter cuts a content strategy.

After launch, test one variable at a time: hook, first visual, proposition, demo scenario, proof format, runtime, CTA, thumbnail, or audience segment. Connect attention and retention metrics to the brief's desired action and business success metric.

## References

- `references/creative-loop.md` — state, artifacts, concept scoring, claim ledger, storyboard, audit, repair, termination.
- `references/audience-segmentation.md` — audience credibility and format guidance.
- `references/channel-playbooks.md` — placement-specific starting points.
- `references/product-playbooks.md` — product-type guidance.
- `references/production-measurement.md` — source capture, derivative, and measurement workflow.
- `references/spectra-production-map.md` — strategy-to-operation mapping and export policy.
- `references/SOURCE-GUIDE.md` — original full playbook; current official channel rules override stale claims.

For visual, sound, and pacing design, load `spectra:video-design`. For end-to-end autonomous planning and optional production, dispatch `marketing-planner`.
