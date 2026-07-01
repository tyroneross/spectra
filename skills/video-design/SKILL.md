---
name: video-design
description: >
  Use when a video's craft needs tuning — "this video looks/feels off", "how should
  this video be paced", "what color/typography/font size for video", "music or
  voiceover pace", "cut rate", "why isn't my video engaging", "make it feel premium"
  or "make it feel authentic", "kinetic text", "safe zones", or when Spectra is
  polishing/rendering a clip and needs concrete design settings (color, type, sound,
  pacing). Turns the emotional/visual/sound/pacing science into font-size floors,
  cut-rate targets, color rules, and Spectra polish parameters.
user-invocable: true
---

# Video Design (craft → Spectra render settings)

The CRAFT companion to `product-marketing` (strategy). Product-marketing decides
WHAT to make, for WHOM, and WHERE it ships; this skill decides HOW it should look,
sound, and move so it lands. Full source playbook: `references/SOURCE-GUIDE.md`.

## The one rule that governs everything
Every frame is doing one of three jobs: create an emotion, build a cognitive model,
or motivate an action. 95% of purchase decisions happen unconsciously — design for
emotion first, logic second, action third. This is the science **behind** the
product-marketing story spine; this skill amplifies each beat of that spine.

## Emotion arc — within a single video (Feel → Think → Do)
1. **Recognition (0–5s):** viewer identifies with the pain — "yes, that's me."
2. **Tension (5–20s):** amplify stakes — mild discomfort demanding resolution.
3. **Relief (20–40s):** show the solution working — release the tension.
4. **Conviction (40–60s):** proof/social validation — ratify with logic.
5. **Direction (final 10s):** one clear CTA — frictionless next step.

Target emotion also shifts by funnel stage: TOFU = curiosity/recognition; MOFU =
confidence/intrigue; BOFU = trust/urgency; retention = pride/belonging.

## Design philosophy selector
| Philosophy | Pick when | Fails when |
|---|---|---|
| **Minimalist** (Apple) | Consumer apps, Watch, macOS native, premium AI; website hero, App Store | Complex B2B (10+ features); dev tools where terminal/IDE chrome IS the product |
| **High-design** (Vercel/Linear) | Dev tools, AI platforms, startup launches — design signals product quality | Consumer mass-market (exclusionary); non-technical enterprise buyers |
| **Lo-fi/authentic** (Loom) | Founder-led social, Product Hunt, dev demos, social/tight-cut channels | Website hero, App Store, paid acquisition, enterprise committees |

Full selector + anti-patterns: `references/philosophies-antipatterns.md`.

## Color
60-30-10 per frame (60% neutral background, 30% brand, 10% accent/CTA). Dark mode
default for dev tools/AI/native macOS; light mode for long-form text and non-technical
B2B. Vary saturation by funnel moment: vibrant at awareness, clean at demo, single
high-contrast accent at the CTA frame. Full color→emotion map: `references/color.md`.

## Typography (concrete floors)
- Max words/frame: 5–15 social, 10–20 demo overlay, 20 ideal/40 max slide.
- Font-size floor (1080p): body 40–60px, headline 60–90px; **+20–30% for 9:16**.
- Dwell: ≥1s per 13 characters, clock starts AFTER animate-in finishes.
- Safe zones: keep text out of platform chrome (exact px per platform in the ref card).
- **Redundancy rule:** on-screen text must NOT verbatim-repeat the VO — keyword
  highlights are fine; callouts spatially integrated on the UI element are good even
  when redundant.
Full specs: `references/typography.md`.

## Sound
Music BPM + direction by audience (80–100 BPM sparse/ambient for dev tools, up to
115–130 punchy for Product Hunt). Mix music at -15 to -20 dBFS under VO, VO at -6 to
-3 dBFS, instrumental only. VO pace: 150 WPM ≈ 1 minute of natural narration (110–120
deliberate, 130–150 conversational, 150–170 up-tempo, 170–200 commercial ceiling).
Add 0.5–1s of silence around the video's key metric. Voice tone matches the audience's
self-image, not the founder's preference. Full tables: `references/sound.md`.

## Pacing / cut rate
Cuts-per-minute by channel (30–60 TikTok/Shorts down to 6–12 YouTube tutorial). The
3-second social rule: hook must land by second 3, first cut by 1.5–2s. Pattern
interrupts every 20–40s, timed to content boundaries (never mid-demo). One idea per
beat — never overlap explain + demonstrate + prove in a single segment. Full rules +
Tight-Edit-vs-Breathe resolution: `references/pacing.md`.

## Channel quick reference
| Channel | Text min size | Cut rate | Max words/frame | Voice pace | Design register |
|---|---|---|---|---|---|
| LinkedIn feed | 60px (vert) / 36px (16:9) | 15–25/min | 15 | 140–160 WPM | Conversational, warm professional |
| YouTube tutorial | 36px | 8–15/min | 20 | 130–150 WPM | Deliberate, structured |
| YouTube Shorts | 60px | 25–40/min | 10 | 160–180 WPM | Energetic, fast payoff |
| TikTok/Reels | 64px | 30–60/min | 8 | 150–175 WPM | Authentic, punchy |
| App Store preview | no text allowed | ~1 scene/5–8s | 0 | N/A | Clean, product-forward |
| Website hero | 48px (desktop) | 6–12/min | 15 | 130–150 WPM | Premium, confident |
| Product Hunt | 56px | 15–25/min | 12 | 150–170 WPM | Authentic, founder-energy |

## Route to Spectra for production
Once the design choices are set, turn them into render parameters —
`references/spectra-design-map.md` maps font-size/dwell/safe-zone to the caption
banner geometry, cut-rate/one-idea-per-beat to `DemoScript` beat structure, and
philosophy/color to the `style` (`cool`/`warm`/`bold`) preset used by
`spectra_demo action=polish-clip`/`polish-script`.

> Those demo actions are part of the current Spectra build — if `spectra_demo` isn't
> in your live tool list, the plugin needs a rebuild + Claude Code restart (MCP
> restart boundary) before producing.

## References (load on demand)
- `references/SOURCE-GUIDE.md` — the full playbook (canonical source).
- `references/color.md` — 60-30-10, color→emotion map, dark/light, funnel-moment color.
- `references/typography.md` — word-density, font-size floors, dwell time, safe zones, kinetic text.
- `references/sound.md` — music BPM/mixing, VO pace, silence, voice tone.
- `references/pacing.md` — cut rate by channel, 3-second rule, pattern interrupts, one-idea-per-beat.
- `references/philosophies-antipatterns.md` — minimalist/high-design/lo-fi selector + anti-pattern fixes.
- `references/spectra-design-map.md` — design rules → Spectra polish/render parameters (the integration glue).

This skill AMPLIFIES `product-marketing` — that skill decides what/when/where;
this one decides how it feels. For the strategy layer (video type, length,
channel, story spine, funnel), load `Skill("spectra:product-marketing")`.
