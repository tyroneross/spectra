/**
 * Parse pts_time values from ffmpeg showinfo filter stderr output.
 * Pure function — no ffmpeg required.
 */
export declare function parsePtsLines(stderrLines: string[]): number[];
/**
 * Bucket pts_time values into per-minute change counts.
 * Pure function.
 */
export declare function bucketPerMinute(ptsTimes: number[]): {
    minute: number;
    changes: number;
}[];
/**
 * Derive contiguous active ranges from activity timestamps with gap tolerance.
 * Timestamps within gapToleranceSec of each other are merged into one range.
 * Pure function.
 */
export declare function deriveActiveRanges(ptsTimes: number[], gapToleranceSec?: number): {
    startSec: number;
    endSec: number;
}[];
/**
 * Scan a video for scene-change activity using ffmpeg fps+select+showinfo.
 * Returns per-minute change counts and contiguous active ranges.
 */
export declare function scanActivity(input: string, opts?: {
    threshold?: number;
}): Promise<{
    perMinute: {
        minute: number;
        changes: number;
    }[];
    activeRanges: {
        startSec: number;
        endSec: number;
    }[];
}>;
export interface FocalRect {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface CanvasSize {
    w: number;
    h: number;
}
/**
 * Build an ffmpeg filtergraph string that applies a spotlight focus effect.
 * Dims and blurs the background; keeps the focal region sharp.
 * Output label: [out]
 * Pure function — no side effects.
 */
export declare function buildSpotlightFilter(opts: {
    focal: FocalRect;
    canvas: CanvasSize;
    dim?: number;
    blur?: number;
    feather?: number;
}): string;
/**
 * Detect whether the installed ffmpeg supports the drawtext filter.
 * Result is cached after the first call.
 */
export declare function hasDrawtext(): boolean;
export interface RenderSegmentOpts {
    input: string;
    startSec: number;
    durationSec: number;
    focal: FocalRect;
    canvas: CanvasSize;
    caption?: string;
    captionPngPath?: string;
    speed?: number;
    out: string;
}
/**
 * Render a single spotlight-focused segment to an mp4 file.
 * Audio is always stripped (-an).
 */
export declare function renderSegment(opts: RenderSegmentOpts): Promise<void>;
/**
 * Merge segments using ffmpeg concat demuxer (stream copy — no re-encode).
 * All segments must share the same codec, size, and fps.
 */
export declare function mergeSegments(segPaths: string[], out: string): Promise<void>;
export interface PolishSegmentSpec {
    input: string;
    startSec: number;
    durationSec: number;
    focal: FocalRect;
    caption?: string;
    captionPngPath?: string;
}
export interface PolishDemoSpec {
    canvas: CanvasSize;
    fps?: number;
    segments: PolishSegmentSpec[];
    speed?: number;
}
export interface PolishDemoResult {
    out: string;
    segmentCount: number;
    warnings: string[];
}
/**
 * Render each segment with the spotlight filter then merge into one mp4.
 * Segments are written to a temp directory and cleaned up after merge.
 */
export declare function polishDemo(spec: PolishDemoSpec, out: string): Promise<PolishDemoResult>;
//# sourceMappingURL=spotlight.d.ts.map