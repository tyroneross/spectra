// src/media/composite-layout.ts
//
// Layout computation for side-by-side composite recordings. Turns a probed
// full-display capture (W×H) into two pane rects (left / right halves) that
// `buildCompositeEncodeArgs` crops out of the single recording and hstacks.
//
// Pane-rect validation lives at the encode boundary (`normalizeCompositePane`
// in pipeline.ts, defense-in-depth). This module only COMPUTES rects and
// asserts its own local default-path invariant (sum-width == display width,
// no overlap). It does not re-implement the encoder's validator.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import type { CompositeLayout } from './pipeline.js'

/**
 * Compute a left/right split of a full-display capture.
 *
 * Default (no override): split the probed display into two equal-height halves.
 * The left pane gets `floor(W/2)`; the right pane gets the remainder so the two
 * pane widths always sum to exactly the display width (odd widths put the extra
 * column on the right — no drift, no gap, no overlap). Heights are floored to
 * an integer and shared, so `hstack=inputs=2` never desyncs.
 *
 * Override: an operator-supplied `CompositeLayout` is returned verbatim (e.g.
 * for Rung-2 per-window rects). The caller owns its correctness.
 */
export function computeSplitLayout(
  displayWidth: number,
  displayHeight: number,
  override?: CompositeLayout,
): CompositeLayout {
  if (override) return override

  if (!Number.isFinite(displayWidth) || !Number.isFinite(displayHeight)) {
    throw new Error(
      `Invalid display dimensions for split layout: ${displayWidth}×${displayHeight} (expected finite numbers)`,
    )
  }
  const width = Math.floor(displayWidth)
  const height = Math.floor(displayHeight)
  if (width < 2 || height < 1) {
    throw new Error(
      `Invalid display dimensions for split layout: ${width}×${height} (need width ≥ 2, height ≥ 1)`,
    )
  }

  const leftWidth = Math.floor(width / 2)
  const rightWidth = width - leftWidth // remainder → exact sum invariant

  return {
    left: { x: 0, y: 0, width: leftWidth, height },
    right: { x: leftWidth, y: 0, width: rightWidth, height },
  }
}
