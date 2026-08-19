/** A finalized recording smaller than this is treated as a stub/failure. */
export declare const MIN_VALID_BYTES = 1024;
export interface FinalizeProbe {
    hasVideoStream: boolean;
    hasAudioStream: boolean;
    codec?: string;
    pixFmt?: string;
    width?: number;
    height?: number;
    durationMs?: number;
}
export type FinalizeAction = 'remux' | 'transcode';
export interface FinalizeResult {
    /** The validated, registerable mp4 (yuv420p + faststart). */
    path: string;
    action: FinalizeAction;
    sizeBytes: number;
    probe: FinalizeProbe;
}
/**
 * Thrown when the raw source is unusable or the finalized output fails
 * validation. Callers should surface this loudly and never register an
 * artifact — the raw is preserved for rescue.
 */
export declare class RecordingFinalizeError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/**
 * Builds the ffmpeg argv for finalizing a recording.
 * - `remux`: lossless container rewrite for an already-web-safe stream
 *   (`-c copy -movflags +faststart`).
 * - `transcode`: re-encode to yuv420p H.264 with faststart, matching
 *   polish.ts. Audio is preserved (AAC) when present, else stripped (`-an`).
 */
export declare function buildFinalizeArgs(input: string, output: string, action: FinalizeAction, hasAudio: boolean): string[];
export declare function buildFinalizeProbeArgs(path: string): string[];
/**
 * Probes a media file for the fields finalize/validation needs (stream
 * presence, video codec, pixel format, dimensions, duration). Returns
 * `undefined` when ffprobe fails or emits no parsable output.
 */
export declare function probeForFinalize(path: string): Promise<FinalizeProbe | undefined>;
/**
 * Bounded scan for an mp4 `moov` atom. A 5-byte stub (the observed failure
 * mode) has none; a faststart mp4 places it near the front. Scans the head and
 * tail so a non-faststart mp4 (moov at end) still validates.
 */
export declare function hasMoovAtom(path: string): Promise<boolean>;
export interface FinalizeRecordingParams {
    /** The raw file emitted by the native recorder. Preserved on success/failure. */
    rawPath: string;
    /** Destination for the validated, registerable mp4. */
    outPath: string;
}
/**
 * Finalizes a raw recording into a validated yuv420p + faststart mp4.
 *
 * Fast path: already H.264 + yuv420p → lossless remux (`-c copy`).
 * Otherwise: transcode to yuv420p H.264 (preserving audio if present).
 *
 * Validates the OUTPUT before returning: size ≥ 1KB, has a moov atom, has a
 * video stream, duration > 0, and pix_fmt === yuv420p. Any failure throws
 * `RecordingFinalizeError` — the caller keeps the raw and registers nothing.
 */
export declare function finalizeRecording(params: FinalizeRecordingParams): Promise<FinalizeResult>;
//# sourceMappingURL=finalize-recording.d.ts.map