export interface FramingFilterOptions {
    inputLabel?: string;
    outputLabel?: string;
    outW?: number;
    outH?: number;
    fps?: number;
    contentScale?: number;
    cornerRadius?: number;
    caption?: string;
    fontFile?: string;
    fontSize?: number;
    captionPill?: boolean;
    captionMode?: 'drawtext' | 'bitmap';
    /**
     * ffmpeg input index for a precomputed rounded-rect mask, rendered once
     * via `frameChromeRenderPlan` and supplied as a looped raw-video input.
     * When set, the per-frame `geq` mask evaluation is skipped entirely in
     * favor of reusing the precomputed mask -- this is the dominant
     * render-time win (mask `geq` evaluation is ~87% of total render time
     * when re-run every frame). The gradient + shadow chain downstream of the
     * mask is unchanged either way. When omitted, `framingFilter` falls back
     * to the original pure-ffmpeg per-frame `geq` graph (used when chrome
     * assets haven't been precomputed, e.g. a caller that wants a single
     * self-contained filter string with no external image inputs).
     */
    chromeAssets?: FrameChromeAssets;
}
export interface FrameChromeAssets {
    /** ffmpeg input index of the precomputed rounded-rect mask (contentW x contentH, 8-bit grayscale). */
    maskIndex: number;
}
export interface FrameLayout {
    contentW: number;
    contentH: number;
    contentX: number;
    contentY: number;
    radius: number;
    shadowPad: number;
}
/**
 * Single source of truth for window-chrome geometry, shared by the per-frame
 * `framingFilter` graph and the one-time `frameChromeRenderPlan` precompute
 * so both agree on identical placement/sizing.
 */
export declare function frameLayout(outW: number, outH: number, contentScale?: number, cornerRadius?: number): FrameLayout;
export interface BitmapTextLayer {
    filter: string;
    width: number;
    height: number;
    normalizedText: string;
}
export declare function bitmapTextLayer(label: string, text: string, pixel: number, fps: number, color?: string): BitmapTextLayer;
export declare function framingFilter(opts?: FramingFilterOptions): string;
export interface FrameChromeRenderPlan {
    layout: FrameLayout;
    /** ffmpeg filter_complex graph producing the `maskLabel` output. */
    filterComplex: string;
    /** Output label for the rounded-rect mask (contentW x contentH, 8-bit grayscale). */
    maskLabel: string;
}
/**
 * Builds a one-shot ffmpeg filter graph that renders the rounded-rect mask
 * EXACTLY once, using the identical `geq` math `framingFilter`'s fallback
 * path would otherwise re-evaluate every frame. The mask is a pure boolean
 * (0 or 255) cutout with no blending, so rendering it once and reloading it
 * as a raw-video input is bit-identical to recomputing it per frame -- it
 * just avoids paying for that recomputation ~N times. Pair with
 * `FrameChromeAssets.maskIndex` in `framingFilter`.
 */
export declare function frameChromeRenderPlan(opts?: {
    outW?: number;
    outH?: number;
    contentScale?: number;
    cornerRadius?: number;
}): FrameChromeRenderPlan;
export declare function hexColor(rgb: {
    r: number;
    g: number;
    b: number;
}): string;
//# sourceMappingURL=framing.d.ts.map