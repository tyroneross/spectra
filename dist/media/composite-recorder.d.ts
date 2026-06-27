export type Spotlight = 'none' | 'a' | 'b';
export interface CompositeRecordParams {
    /** App name / bundle substring for the left pane (required). */
    appA: string;
    /** Optional window-title substring for the left pane. */
    titleA?: string;
    /** Optional label for the left pane. */
    labelA?: string;
    /** App name / bundle substring for the right pane (required). */
    appB: string;
    /** Optional window-title substring for the right pane. */
    titleB?: string;
    /** Optional label for the right pane. */
    labelB?: string;
    /** Capture duration in seconds. */
    durationSeconds?: number;
    /** Capture FPS. Default 60. */
    fps?: number;
    /** Dim+blur the NON-focal pane. none | a (left) | b (right). Default none. */
    spotlight?: Spotlight;
    /** Composite a smoothed cursor sprite. Default true. */
    cursor?: boolean;
    /** Lanczos-downscale final width to <= px. Default 1600. */
    maxWidth?: number;
    /** x264 quality (1..51, lower=better). Default 20. */
    crf?: number;
    /** Composite MP4 output path (required). */
    outPath: string;
}
export declare const COMPOSITE_DEFAULTS: {
    readonly durationSeconds: 5;
    readonly fps: 60;
    readonly spotlight: Spotlight;
    readonly cursor: true;
    readonly maxWidth: 1600;
    readonly crf: 20;
    /** Mean luminance (0..255) below which the output is treated as all-black. */
    readonly blackThreshold: 16;
};
export interface BlackFrameGuard {
    /** Number of frames sampled by the luminance probe. */
    sampleCount: number;
    /** Mean Y (luminance) across sampled frames, 0..255. Null if the probe could not run. */
    meanLuma: number | null;
    /** True when meanLuma is below the black threshold — capture likely failed. */
    allBlack: boolean;
    /** True when the probe could not run (ffmpeg missing or no samples). */
    skipped: boolean;
}
export interface CompositeRecordResult {
    ok: boolean;
    /** Absolute path to the composite MP4 (from the binary's CompositeResult.output). */
    output?: string;
    /** The exact spawned command line, including the caffeinate wrap (evidence). */
    command: string;
    /** CFR validation block emitted by the binary (if --validate ran). */
    validation?: unknown;
    /** Per-pane / window metadata emitted by the binary. */
    details?: unknown;
    /** Post-capture black-frame guard result. */
    blackFrameGuard: BlackFrameGuard;
    /** Non-fatal warnings (e.g. all-black output, guard skipped). */
    warnings: string[];
    error?: string;
}
/**
 * Pure param→flag mapping for spectra-composite-capture. No I/O — unit-testable
 * without a GUI session. Throws on missing required fields.
 */
export declare function buildCompositeArgs(p: CompositeRecordParams): string[];
/**
 * Pure: wrap the recorder invocation in caffeinate so the display does not sleep
 * during capture. `-d` blocks display sleep (the black-frame fix), `-i` blocks
 * idle system sleep, `-s` blocks system sleep on AC. caffeinate runs the given
 * utility and exits when it exits.
 */
export declare function buildCaffeinatedCommand(binaryPath: string, binaryArgs: string[]): {
    command: string;
    args: string[];
};
/**
 * Pure: parse ffmpeg `signalstats` YAVG (mean luminance) lines and decide whether
 * the sampled output is all-black. Accepts the combined ffmpeg stdout+stderr.
 */
export declare function parseLuminance(output: string, opts?: {
    blackThreshold?: number;
}): BlackFrameGuard;
/**
 * Drive the window-isolated composite recorder end to end:
 *   ensure the binary is built → caffeinate-wrapped spawn → parse the result →
 *   black-frame guard. Throws only on a hard spawn/exit failure; an all-black
 *   output is reported via warnings, not thrown, so the caller can decide.
 */
export declare function recordComposite(params: CompositeRecordParams): Promise<CompositeRecordResult>;
//# sourceMappingURL=composite-recorder.d.ts.map