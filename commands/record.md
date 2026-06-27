---
name: record
description: Record a side-by-side composite video (e.g. terminal + browser)
---

Record a synchronized side-by-side composite `.mp4` from the active Spectra session — the full display is captured once, then split into a LEFT pane and a RIGHT pane and stacked horizontally with zero post-editing.

## Usage

`/spectra:record composite` — start an auto equal-halves composite recording, then stop it to encode.

## How it works

`spectra_capture` drives the recording. The composite path adds a `composite` parameter:

- `composite: { enabled: true }` — auto split. The left/right halves are computed at stop time from the **real captured frame size** (correct on Retina, where the capture resolution differs from logical points). This is the one-command default.
- `composite: { enabled: true, displayWidth, displayHeight }` — compute the split from explicit display pixels.
- `composite: { enabled: true, left, right }` — explicit pane rects `{ x, y, width, height }` (operator override).

## Steps

1. Ensure a session is active (`/spectra:connect`); if not, tell the user to connect first.
2. **Stage the windows** before starting — the auto split crops the LEFT half and the RIGHT half of the one full-display recording, so the windows must already be tiled there. Put the terminal in the left display-half and the target app (e.g. the browser) in the right display-half. See `docs/composite-staging.md`.
3. Start: `spectra_capture` with `type: "start_recording"` and `composite: { enabled: true }`.
4. Perform the flow you want on camera.
5. Stop: `spectra_capture` with `type: "stop_recording"`. The encoder runs `buildCompositeEncodeArgs` (crop×2 → `hstack=inputs=2:shortest=1`) and returns the composite `.mp4` path.

## Verify

The output is a genuine composite when `ffprobe` shows `width ≈ left.width + right.width` AND a poster-frame check confirms the LEFT pane shows the staged left window and the RIGHT pane shows the staged right window. A correct width with wrong/duplicated pane content means staging failed (windows not tiled to the halves).
