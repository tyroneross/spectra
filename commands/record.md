---
name: record
description: Record a side-by-side composite video from two app windows
---

Record a synchronized side-by-side composite `.mp4` from two visible macOS app
windows. The current composite recorder is the ScreenCaptureKit worker behind
`spectra_demo action="record-composite"`.

## Usage

`/spectra:record composite` should drive `spectra_demo` with
`action: "record-composite"` and the target window selectors.

## Parameters

- `appA`, `titleA`, `labelA` - left pane app selector, optional title selector,
  and optional label.
- `appB`, `titleB`, `labelB` - right pane app selector, optional title selector,
  and optional label.
- `durationSeconds`, `fps`, `spotlight`, `caption`, `cursor`, `maxWidth`, `crf`
  - composite worker options.
- `outPath` - output mp4 path.
- `sessionId` - optional session to receive the recording status and artifact.

## Steps

1. Ensure the two target windows are visible and on-screen.
2. Call `spectra_demo` with `action: "record-composite"`, app selectors, and
   `outPath`.
3. Omit `async` for the synchronous result, or set `async: true` to receive a
   `recordingId` immediately and follow completion through events or
   `getRecording`.
4. Use the returned output path, and the session artifact when `sessionId` was
   attached.

## Verify

The output is valid when the result reports `ok: true`, the output path exists,
and a poster-frame check shows the expected left and right window content. The
daemon also runs a black-frame guard and returns warnings when luminance checks
look suspicious.
