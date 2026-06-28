# Composite Recording - Current Window Prep

This runbook replaces the retired full-display staging instructions. Current
composite recording captures two selected windows independently through
ScreenCaptureKit; it does not require left/right display tiling.

## Before Recording

1. Make both target windows visible and on-screen.
2. Pass app selectors with `appA` and `appB`.
3. Add `titleA` / `titleB` when multiple windows from the same app are visible.
4. Set `labelA` / `labelB` when the output needs pane labels.
5. Provide an `outPath` for the mp4.

## Recording

Use `spectra_demo action="record-composite"` or the `/spectra:record composite`
command wrapper. The daemon delegates to `recordComposite`, which invokes the
native composite worker.

## Verification

- The command returns `ok: true` and an output path.
- The output path exists.
- A poster frame shows the expected two windows.
- The black-frame guard does not report an all-black output.

## Notes

Window isolation is the current implementation, not a future rung. If the target
window is hidden, off-screen, or ambiguous, refine the app/title selector before
recording again.
