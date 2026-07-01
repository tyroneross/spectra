import { type CanvasSize, type FocalRect } from '../media/spotlight.js';
export type { CanvasSize, FocalRect };
/**
 * Dark-crush spotlight tuning calibrated against the reference clip
 * (demo-candidates/polished/rally__personas-two-agents__MERGED_CAPTIONED.mp4):
 * heavy darken toward near-black (dim), a tight blur on the dimmed
 * background, and a soft ~26px feathered edge between focal and periphery.
 */
export declare const DARK_SPOTLIGHT_DEFAULTS: {
    readonly dim: 0.75;
    readonly blur: 8;
    readonly feather: 26;
};
/**
 * Default focal rect for the `bold` style preset's cinematic auto-spotlight
 * (polishClip/polishScript apply this when style is 'bold' and the caller
 * didn't pass an explicit `spotlight`). A centered rect covering 86% of the
 * frame in both axes -- a reasonable default focal region for content that
 * hasn't declared its own point of interest.
 */
export declare function defaultBoldSpotlightFocal(canvas: CanvasSize): FocalRect;
export interface SpotlightStageOptions {
    focal: FocalRect;
    canvas: CanvasSize;
    dim?: number;
    blur?: number;
    feather?: number;
}
/**
 * Builds the dark-crush spotlight filtergraph stage (output label `[out]`).
 * Any field the caller omits falls back to DARK_SPOTLIGHT_DEFAULTS rather
 * than buildSpotlightFilter's own mild-dim defaults. Pure function — no
 * side effects, delegates entirely to media/spotlight.ts.
 */
export declare function buildDarkSpotlightFilter(opts: SpotlightStageOptions): string;
export interface SpotlightPrePassOptions extends SpotlightStageOptions {
    input: string;
    hasAudio: boolean;
}
/**
 * Renders the spotlight pre-pass to a temp mp4: the focal rect stays sharp
 * and full brightness, everything else is feathered-blur + dark-crushed.
 * Audio (if present) is stream-copied through untouched — the spotlight only
 * touches video. The returned path is meant to feed back in as the `input`
 * to the rest of the polish pipeline (zoom/framing/caption); callers own
 * cleanup via `cleanupSpotlightPrePass`.
 */
export declare function renderSpotlightPrePass(opts: SpotlightPrePassOptions): Promise<string>;
/** Removes a spotlight pre-pass temp file. Swallows missing-file errors. */
export declare function cleanupSpotlightPrePass(path: string): Promise<void>;
//# sourceMappingURL=spotlight.d.ts.map