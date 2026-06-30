// src/pipeline/auto-zoom.ts
// Auto-derive a zoom track from scene-change activity, so polishClip can
// auto-zoom an unedited recording without hand-authored clicksJson.
import { scanActivity } from '../media/spotlight.js';
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
export async function deriveZoomTrackFromActivity(input, durationMs, opts) {
    const anchor = opts?.anchor ?? { cx: 0.5, cy: 0.5 };
    const { activeRanges } = await scanActivity(input, { threshold: opts?.threshold });
    return activeRanges
        .map((range) => ({
        tMs: Math.max(0, Math.round(range.startSec * 1000)),
        cx: anchor.cx,
        cy: anchor.cy,
    }))
        .filter((click) => click.tMs < durationMs);
}
//# sourceMappingURL=auto-zoom.js.map