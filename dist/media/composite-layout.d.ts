import type { CompositeLayout } from './pipeline.js';
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
export declare function computeSplitLayout(displayWidth: number, displayHeight: number, override?: CompositeLayout): CompositeLayout;
//# sourceMappingURL=composite-layout.d.ts.map