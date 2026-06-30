import type { ZoomClick } from './zoom-keyframes.js';
export interface AutoZoomAnchor {
    cx: number;
    cy: number;
}
export interface DeriveZoomTrackFromActivityOptions {
    /** Forwarded to scanActivity's scene-change threshold (default 0.04). */
    threshold?: number;
    /** Fixed focal point used for every synthesized click. Defaults to center. */
    anchor?: AutoZoomAnchor;
}
/**
 * Derive a ZoomClick[] track from temporal scene-change activity so
 * `buildZoomTrack` (zoom-keyframes.ts) can zoom in during active stretches of
 * a recording and ease back out during idle gaps, with no hand-authored
 * clicks required.
 *
 * One click is placed at the start of each `activeRanges` window returned by
 * `scanActivity` (src/media/spotlight.ts), anchored at a fixed cx/cy. The
 * existing pre/post/ease window logic in `buildZoomTrack` then expands each
 * click into a hold-and-release zoom window, and merges windows that are
 * close together.
 *
 * SPATIAL NOTE: `scanActivity` is a TEMPORAL-ONLY signal — it detects *when*
 * the frame changes via ffmpeg scene-change scoring, not *where* on screen
 * the motion is. Every synthesized click therefore reuses the same fixed
 * `anchor` (cx/cy), defaulting to dead center (0.5, 0.5). True spatial
 * targeting — zooming toward the actual region of motion — is a follow-up
 * that needs either per-region activity detection (tiled scene-diffing) or a
 * real spatial signal such as native cursor capture (see
 * `deriveDwellClicks` in zoom-keyframes.ts, which already derives spatial
 * zoom targets from a `CursorPoint[]` track when one is available).
 *
 * Pure-ish async wrapper: the only side effect is the ffmpeg invocation
 * inside `scanActivity`. Returns an empty array (no auto-zoom) when no
 * activity is detected.
 */
export declare function deriveZoomTrackFromActivity(input: string, durationMs: number, opts?: DeriveZoomTrackFromActivityOptions): Promise<ZoomClick[]>;
//# sourceMappingURL=auto-zoom.d.ts.map