# Composite recording — window staging runbook (Rung 1)

Rung-1 composite captures the **whole display once** via avfoundation, then crops
the left half and the right half and `hstack`s them. The "LEFT = terminal /
RIGHT = browser" result is therefore **only** true if the windows are physically
tiled into those halves *before* recording starts. There is no per-window
isolation in Rung 1 — that is Rung 2 (ScreenCaptureKit `desktopIndependentWindow`).

## Steps

1. **Tile the two windows to display halves.** Put the terminal (Claude Code)
   in the left half and the target app (e.g. the Atomize browser) in the right
   half. Use macOS tiling (drag to screen edge / Window → Move & Resize), or
   Rectangle (`⌃⌥←` / `⌃⌥→`). Match the split that `computeSplitLayout`
   produces: each pane is exactly half the display width, full height.
2. **Clear the crop boundary.** No third window may straddle the vertical
   centerline — anything overlapping the split bleeds into the wrong pane. Close
   or move stray windows (Finder, notifications) off the staged region.
3. **Record.** `/spectra:record composite`, or `spectra_capture` with
   `type: "start_recording"` and `composite: { enabled: true }`. Auto mode
   resolves the equal-halves split from the **real captured frame size** at stop
   (correct on Retina, where the backing resolution ≠ logical points).
4. **Stop.** `spectra_capture type: "stop_recording"`. The encoder runs
   `buildCompositeEncodeArgs` (`crop×2 → hstack=inputs=2:shortest=1`).

## Verify the artifact (do not trust width alone)

`ffprobe` width ≈ `left.width + right.width` is **necessary but not sufficient**
— an equal-halves split of a full display reproduces the original width whether
or not compositing ran. Also confirm:

- **Pane content** — a poster frame shows the staged left window on the left and
  the staged right window on the right. Wrong/overlapping content = staging
  failure (windows not tiled, or a window straddled the centerline).
- **Distinct panes** — left-half and right-half crops of the output differ
  (rules out a duplicated-pane bug).

## Known Rung-1 limitation (why Rung 2 exists)

A cluttered or un-tiled desktop produces a composite whose panes contain
overlapping/foreign windows — the full-display crop cannot isolate a single
window, and it cannot capture a window that is **occluded or off-screen**. When
clean staging is impractical (overlapping windows, hidden/occluded windows,
window drift mid-take), use Rung 2 per-window capture
(`SCContentFilter(desktopIndependentWindow:)`), which captures each target
window independently regardless of z-order or occlusion.
