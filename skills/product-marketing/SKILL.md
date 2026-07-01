---
name: product-marketing
description: >
  Use when planning or producing product marketing content/video for any software
  product — "plan a marketing video", "app store preview", "product hunt launch",
  "explainer vs demo", "LinkedIn/YouTube video for <product>", "launch video",
  "what video should I make for <app>", "ongoing content plan", "changelog/release
  video", "readme demo GIF", "repurpose this into shorts", or when Spectra is about to capture/produce
  marketing assets and should tailor them to the product's audience, channel, and
  funnel stage. Turns product × audience × goal into a concrete plan (video type,
  length, channel, story-spine script, specs, polish style) and routes production to
  Spectra's capture/record/polish tools.
user-invocable: true
---

# Product Marketing (plan → produce, audience-tailored)

The planning brain for product marketing video. It sits in front of Spectra's
capture/polish tools so what Spectra produces is calibrated to WHO it's for and WHERE
it ships. Works for any software product (AI agents, plugins, iOS/macOS/watchOS apps,
web apps). Full source playbook: `references/SOURCE-GUIDE.md`.

## The one rule that governs everything

**Explainer sells the PROBLEM (TOFU, 30–90s, cold audience). Demo sells the SOLUTION
(MOFU/BOFU, 90s–5min, warm audience).** Conflating them is the #1 mistake. Traffic but
poor conversion → build the demo. Awareness but no traffic → build the explainer.
**No data yet (pre-launch — the most common case)** → lead with the explainer/launch
video for TOFU, add the demo once you have traffic.

## Workflow

1. **Intake — resolve three variables** (ask only what you can't infer):
   - **Product type**: AI agent · plugin/extension · iOS app · macOS app · Apple Watch · web app (B2B)
   - **Audience**: developer · enterprise buyer · SMB/prosumer · consumer
   - **Goal / funnel stage**: awareness (TOFU) · consideration (MOFU) · decision (BOFU)
2. **Decision matrix** → pick video type, length, primary channel (table below; full detail in `references/channel-playbooks.md` + `product-playbooks.md`).
   - **Multi-goal requests** (e.g. a launch AND ongoing content — very common): produce one
     asset per matching matrix row, then apply **film once, publish many** — one capture
     session → 1 long-form (YouTube/demo) + 2–3 MOFU clips + 5–10 TOFU social clips + 1
     thumbnail frame + 1 GIF/loop, plus a changelog/release video each release (highest-ROI
     recurring). Spectra re-renders one source into each aspect/duration/preset. See
     `references/production-measurement.md`.
3. **Story spine** → write the script/shot outline: Cold-open hook (3–5s) → Stakes (5–10s) → Solution reveal (10–15s) → Product in action, 2–3 "moments that matter" (20–40s) → Proof (10–20s) → one CTA (5–10s). TOFU delays the reveal/CTA and teaches first.
4. **Production spec** → set aspect ratio, duration, codec/specs, and **polish level** (below), then hand to Spectra (`references/spectra-production-map.md`).
5. **Measure & iterate** → watch-depth as intent signal; changelog video on every release (highest-ROI). See `references/production-measurement.md`.

## Decision matrix (product × audience → type / length / channel)

| Product | Audience | Video type | Length | Primary channel |
|---|---|---|---|---|
| AI agent | Developer | Tutorial + workflow demo | 5–10 min | YouTube |
| AI agent | Prosumer/SMB | Explainer + outcome demo | 60–90s | LinkedIn, landing |
| AI agent | Launch | Launch video | 45–75s | Product Hunt |
| Plugin | Developer | Before/after workflow demo | 60–90s | PH, LinkedIn, YT Short |
| iOS app | Consumer | App Store preview | 15–30s | App Store |
| iOS app | Consumer | Problem→solution demo | 30–60s | Reels/TikTok/Shorts |
| macOS app | Power user | App overview + feature demo | 2–5 min | YouTube, App Store |
| Apple Watch | Consumer | Glanceable use-case demo | 15–30s | App Store, Reels |
| Web app | SMB | Explainer + demo | 60–90s + 3–5min | Homepage, LinkedIn, email |
| Web app | Enterprise | Use case + case study | 3–8 min | Sales deck, website |

## Authenticity calibration → maps to Spectra polish preset

Match production quality to audience. **Good audio is never optional; everything else
calibrates down.** In 2026, over-polish signals inauthenticity — lo-fi founder/dev
content often outperforms on social feeds.

| Audience | Polish level | Spectra polish style preset |
|---|---|---|
| Developer / technical | low–medium (real terminal/IDE, authentic) | `cool` (flat, no spotlight) |
| SMB / prosumer | medium | `cool` or `warm` |
| Consumer | medium (aesthetic matters, fast hook) | `warm` |
| Enterprise / investor / hero | medium–high (polish signals quality) | `bold` (cinematic spotlight) |

(Presets are the committed `polishScript/polishClip` styles: `src/pipeline/text-render.ts`
`BANNER_STYLE_PRESETS`. Style is `style: 'cool'|'warm'|'bold'`.)

## Route to Spectra for production

Once the plan is set, produce with Spectra — tailored by the plan:
- **Capture** the real workflow: `spectra_connect` → `spectra_step`/`spectra_discover` → `spectra_capture` (real UI only — Apple + PH audiences reject mockups).
- **Polish** to the chosen preset + aspect/duration: the `polish-clip`/`polish-script` demo actions with `style` + optional `spotlight`/`voiceover`.
- **Specs by channel**: App Store = H.264 High, **constant 30fps**, 15–30s, AAC stereo 44.1/48kHz ~256kbps, yuv420p, faststart, correct per-device resolution, no device frames/pricing/competitor refs. LinkedIn/PH/other = 9:16 or 1:1, **H.264 mp4 (no VFR)**, burned-in captions, hook in first 2–3s.
Full mapping + specs: `references/spectra-production-map.md`.

> The `polish-clip`/`polish-script` demo actions are part of the current Spectra build —
> if `spectra_demo` isn't in your live tool list, the plugin needs a rebuild + Claude Code
> restart (MCP restart boundary). Confirm the tool exists before assuming the production step.

## Sound-off default
Burn in captions (don't rely on auto-overlays); on-screen text must carry the message;
cursor highlights/zoom guide the eye. Design for silent autoplay, deliver for sound-on.

## References (load on demand)
- `references/SOURCE-GUIDE.md` — the full playbook (canonical source).
- `references/audience-segmentation.md` — dev/enterprise/SMB/consumer: wants + what kills credibility.
- `references/channel-playbooks.md` — LinkedIn, YouTube, App Store (Apple specs + rejection causes), Product Hunt.
- `references/product-playbooks.md` — AI agent, plugin, iOS, macOS, Apple Watch, web app.
- `references/production-measurement.md` — solo "film once publish many", lean stack, metrics, checklists.
- `references/spectra-production-map.md` — plan → Spectra tools/actions/specs/preset (the integration glue).

For end-to-end autonomous planning (and optional production), dispatch the
`marketing-planner` agent.
