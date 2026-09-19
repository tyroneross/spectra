export interface OcrEngine {
    name: string;
    available(): Promise<boolean>;
    recognize(pngPath: string): Promise<string>;
}
/**
 * Shells out to the `tesseract` CLI. `--psm 6` (assume a single uniform block
 * of text) is the best default for terminal/browser chrome screenshots.
 */
export declare class TesseractOcrEngine implements OcrEngine {
    readonly name = "tesseract";
    private binaryPath;
    private resolveBinary;
    available(): Promise<boolean>;
    recognize(pngPath: string): Promise<string>;
}
export type SecretSeverity = 'high' | 'medium' | 'low';
export interface SecretPattern {
    id: string;
    severity: SecretSeverity;
    regex: RegExp;
    description: string;
}
export declare const DEFAULT_SECRET_PATTERNS: SecretPattern[];
export interface TextFinding {
    patternId: string;
    severity: SecretSeverity;
    description: string;
    /** First 4 chars + '…' + last 2 chars of the match. The full match is never retained. */
    redacted: string;
    /** Character offset of the match within the scanned text. */
    index: number;
    /** Length of the match, in characters — not enough on its own to reconstruct the secret. */
    length: number;
    /** Set when this finding was only found after the OCR-confusion normalization pass. */
    viaOcrConfusionPass?: boolean;
}
export declare function scanText(text: string, opts?: {
    patterns?: SecretPattern[];
    allow?: RegExp[];
}): TextFinding[];
export declare function normalizeOcrText(text: string): string;
export declare function applyOcrConfusionMap(text: string): string;
export declare function scanOcrText(rawOcrText: string, opts?: {
    patterns?: SecretPattern[];
    allow?: RegExp[];
}): TextFinding[];
export interface SampledFrame {
    path: string;
    index: number;
    tMs: number;
}
export interface FrameScanRange {
    startMs: number;
    endMs: number;
}
export declare class FrameScanInputError extends Error {
    readonly code = "INPUT_NOT_FOUND";
}
export declare class FfmpegUnavailableError extends Error {
    readonly code = "FFMPEG_UNAVAILABLE";
}
/**
 * Samples frames from a video at `fps`, scaled to 1920px wide (height auto,
 * even-rounded). If `input` is a still image, returns it as a single frame
 * at tMs=0 without invoking ffmpeg.
 */
export declare function sampleFrames(input: string, opts: {
    fps?: number;
    outDir: string;
    maxFrames?: number;
    rangesMs?: FrameScanRange[];
}): Promise<SampledFrame[]>;
export interface FrameFinding extends TextFinding {
    frameIndex: number;
    tMs: number;
    framePath: string;
}
export type FrameScanVerdict = 'clean' | 'review' | 'blocked';
export interface FrameScanReport {
    input: string;
    sampledAt: string;
    engine: string;
    fps: number;
    frameCount: number;
    rangesMs?: FrameScanRange[];
    findings: FrameFinding[];
    verdict: FrameScanVerdict;
    unscannedReason?: string;
    /** Count of OCR lines (across all frames) longer than 4 KB that needed overlapping-window scanning. */
    longLines: number;
}
export declare function scanFrames(input: string, opts?: {
    fps?: number;
    engine?: OcrEngine;
    patterns?: SecretPattern[];
    allow?: RegExp[];
    workDir?: string;
    rangesMs?: FrameScanRange[];
}): Promise<FrameScanReport>;
//# sourceMappingURL=frame-secret-scan.d.ts.map