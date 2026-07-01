# Design rules → Spectra render parameters (the integration glue)

How the craft rules (color/typography/sound/pacing) become concrete Spectra polish
and render settings. Companion to `product-marketing/references/spectra-production-map.md`
(that file maps plan → channel/specs; this one maps design → pixels/dB/beats).

## Caption/step-card geometry ← font-size floor + dwell + safe zone
`spectra_demo action=polish-clip`/`polish-script` renders captions via
`src/pipeline/text-render.ts` (`renderStepCardPng`, `CAPTION_BANNER_SPEC`,
`BANNER_STYLE_PRESETS`). Concrete knobs:
- `fontSize` (default 40px `DEFAULT_STEP_FONT_SIZE`) — raise toward the 40–60px body
  floor / 60–90px headline floor from `typography.md`; add 20–30% for 9:16 exports.
- `x`/`y` (defaults 120/92, `DEFAULT_STEP_X`/`DEFAULT_STEP_Y`) — place inside the
  platform safe zone from `typography.md`, not at the frame edge.
- `bannerHeightRatio` per style preset (`cool` 0.12, `warm` 0.13, `bold` 0.14 — see
  `BANNER_STYLE_PRESETS`) — the caption banner's share of frame height; keep it clear
  of the bottom safe-zone buffer (TikTok ≥320px, Reels ≥250px, Shorts ≥400px).
- **Dwell**: each beat's `startMs`/`endMs` window in a `DemoScript` beat should give
  ≥1s per 13 characters of `stepText`, counted AFTER any animate-in — don't let a short
  beat window truncate reading time.
- **Redundancy rule**: `stepText`/`stepLabel` should reinforce a keyword or spatially
  anchor the UI element being acted on (beats already carry `action.target`) — not
  transcribe a voiceover track verbatim.

## Beat structure ← cut rate + one-idea-per-beat
A `DemoScript` (`src/contract/core-api.ts` `DemoScript`/`DemoScriptBeat`) is a list of
timed beats, each with an optional `zoom` and `action` (`search|click|scroll|navigate|hold`).
Map pacing rules directly onto beat boundaries:
- One beat = one idea. If a beat's `action` does two things (e.g. navigate AND
  demonstrate a result), split it into two beats — mirrors the one-idea-per-beat rule
  in `pacing.md`.
- Beat duration (`endMs - startMs`) should track the channel's cuts-per-minute target:
  short beats (1–2s) for TikTok/Reels/Shorts-bound exports, longer beats (4–10s) for
  YouTube/App-Store-bound exports where the UI needs to breathe.
- Place pattern-interrupt beats (a `zoom` push-in, or a beat boundary itself) at
  content boundaries — end of a completed action, never mid-interaction.

## `style` preset ↔ design philosophy ↔ color/dark-mode
`polish-clip`/`polish-script` take `style: 'cool'|'warm'|'bold'` (`BANNER_STYLE_PRESETS`
in `text-render.ts`). Map the chosen design philosophy (`philosophies-antipatterns.md`)
to a preset:

| Philosophy | `style` | Notes |
|---|---|---|
| Lo-fi / authentic | `cool` | flat, no spotlight — matches real terminal/IDE credibility |
| Minimalist (Apple) | `cool` or `warm` | warm for consumer-warm register, cool for clean/technical |
| High-design (Vercel/Linear) | `bold` | dark-crush spotlight, higher-contrast chip color (`#818CF8`) |

Dark-mode choice (`color.md`) should agree with the preset: `bold` implies dark
background + vivid accent; `cool`/`warm` are agnostic — set video source dark/light to
match the audience per `color.md`.

## Music/VO ← the `voiceover` mux
`polish-script`'s `voiceover` option (`src/pipeline/polish.ts` `buildVoiceoverAudioArgs`)
muxes a narration file that REPLACES input audio, starting at t=0 and
padded/trimmed to video length. It does not itself do music-under-VO ducking — if
a background music bed is composited into the same `voiceover` file before muxing,
mix it per `sound.md`: **music -15 to -20 dBFS, VO -6 to -3 dBFS**, dip an extra
3–6dB during heavy on-screen-text beats. Keep the VO track free of audible lyrics.

## Safe zones + aspect per channel
Render output aspect/resolution should match the channel table in
`product-marketing/references/spectra-production-map.md`; text placement (`x`/`y`
above) must additionally respect the per-platform safe zone in `typography.md` — the
production map sets the canvas, this map sets what's safe to put on it.

> `polish-clip`/`polish-script` are part of the current Spectra build — if
> `spectra_demo` isn't in the live MCP tool list, the plugin needs a rebuild + Claude
> Code restart (MCP restart boundary) before any of the above settings take effect.
