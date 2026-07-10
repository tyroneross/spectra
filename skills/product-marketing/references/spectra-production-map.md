# Plan → Spectra production map

How a marketing plan (product × audience × goal) drives Spectra's capture + polish so
the produced asset is calibrated to the audience, channel, and funnel stage. This is the
glue between the strategy (SKILL.md + SOURCE-GUIDE.md) and Spectra's MCP tools/pipeline.

## Capture (always real UI — Apple + Product Hunt reject mockups)
1. `spectra_connect` to the target (URL for web, `app:<name>` for macOS, `sim:<device>` for iOS/watch).
2. `spectra_step` / `spectra_discover` to drive the flow you scripted (the "moments that matter").
   - For a DemoScript with beat actions (search/click/navigate/scroll), the CDP `run-script`
     path (`spectra_demo action=run-script`) executes them against a live browser.
3. `spectra_capture` (video or framed screenshots) at each moment. Enable `captureCursor`
   for demos where pointer motion matters (feeds the zoom pipeline). Enable `captureAudio`
   only if you'll keep narration.

## Polish (the audience → preset mapping)
Render with `spectra_demo action=polish-clip` (clicks/cursor track) or `action=polish-script`
(structured beats + numbered step cards). Set `style` and optional `spotlight`/`voiceover`:

| Audience | `style` preset | Spotlight | Why |
|---|---|---|---|
| Developer / technical | `cool` | off | authentic, flat; real terminal/IDE reads as credible |
| SMB / prosumer | `cool` or `warm` | off | clean, fast |
| Consumer | `warm` | off (or light) | warmer, aesthetic, fast hook |
| Enterprise / investor / hero | `bold` | auto (dark-crush) | cinematic; polish signals product quality |

- Auto-zoom (scene-detect) engages when no click track is supplied; supply a real
  cursor/click track (from `captureCursor` telemetry → `loadCursorTelemetry`) for spatially
  accurate zoom.
- `voiceover: <audiofile>` muxes narration (synced to video length). Good audio is
  non-negotiable — bad audio = instant abandonment for every audience.

## Channel specs (set at render / export)

| Channel | Aspect | Duration | Hard specs |
|---|---|---|---|
| **App Store** (iOS/iPadOS/Mac) | Use Apple's current accepted resolution for the target; Mac 1920×1080 landscape only | **15–30s** | Apple: H.264 progressive up to High Profile L4.0 or ProRes 422 HQ, max 30fps; H.264 `.mov`/`.m4v`/`.mp4`; stereo AAC contract when audio is present. Spectra house export: H.264/yuv420p, constant 30fps, fast-start MP4. Show app-only footage; muted-autoplay copy; no specific prices. |
| **Product Hunt** | 1:1 (safe) or 16:9 | 45–75s (≤30s = best completion) | burned-in captions, muted-autoplay, optimize thumbnail frame, real UI |
| **LinkedIn** | 9:16 or 1:1 (beats 16:9 in feed) | 30–90s | burned-in high-contrast captions, value in first 2–3s, no logo intro |
| **YouTube** | 16:9 | 3–20 min per format | SEO title with exact technical terms, chapters, GitHub/docs links |
| **Reels/TikTok/Shorts** | 9:16 | 15–90s | founder-led/lo-fi > polished; problem-agitate-solve |

**Non-App-Store default export** (PH/LinkedIn/YouTube/Reels): H.264 mp4, **no VFR**, AAC
audio, +faststart — a safe universal target when the channel has no hard codec spec.

Preflight every App Store asset against Apple's live specification before upload. Spectra's
house export prevents common compatibility risks, but it does not replace device-resolution
and metadata validation in App Store Connect.

> Production runs through `spectra_demo action=polish-clip`/`polish-script` (current Spectra
> build). If `spectra_demo` isn't in the live MCP tool list, rebuild the plugin + restart
> Claude Code (MCP restart boundary) before producing.

## Film once, publish many (one capture session → many assets)
From one anchor recording produce: 1 long-form (YouTube/demo), 2–3 MOFU clips (2–5min),
5–10 TOFU social clips (15–90s), 1 thumbnail frame, 1 GIF/loop for README/X. Spectra's
polish pipeline re-renders the same source into each aspect/duration/preset — so a single
capture fans out to every channel with the right calibration.

## Product-type production notes
- **AI agent**: show trigger → action → output loop in real time; real outputs, no abstract
  AI imagery. Capture the actual workflow.
- **Plugin**: record in a real browser with the plugin active; show before/after; 45–60s.
- **iOS/iPadOS**: `sim:<device>`; use the App Store contract above and front-load the relevant product moment.
- **watchOS**: capture the simulator or physical context for website/social clips; use screenshots for the current App Store watchOS surface.
- **macOS**: show native feel (menu bar, shortcuts, Spotlight/Quick Look integration); landscape 1920×1080.
- **web (B2B)**: explainer (60–90s hero) + demo (3–5min); enterprise adds case-study/ROI.
