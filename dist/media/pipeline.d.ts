import type { Platform } from '../core/types.js';
export interface VideoOptions {
    fps: 30 | 60;
    quality: 'lossless' | 'high' | 'medium';
    hardware: boolean;
    maxDuration?: number;
}
export interface VideoResult {
    path: string;
    duration: number;
    size: number;
    codec: string;
    fps: number;
}
export interface RecordingHandle {
    stop(): Promise<string>;
    platform: Platform;
}
export type ProcessRunner = (cmd: string, args: string[]) => {
    kill: () => void;
    waitForExit: () => Promise<number>;
};
export declare function setProcessRunner(r: ProcessRunner): void;
export declare function resetProcessRunner(): void;
/**
 * Build FFmpeg (or xcrun simctl) arguments for the capture phase.
 * Returns args without the leading command name.
 */
export declare function buildCaptureArgs(platform: Platform, outputPath: string, options: VideoOptions): string[];
/**
 * Build FFmpeg arguments for the encode/distribution phase.
 * Returns args without the leading 'ffmpeg'.
 */
export declare function buildEncodeArgs(inputPath: string, outputPath: string, options: VideoOptions): string[];
/**
 * Start a recording session. Returns a RecordingHandle with stop().
 */
export declare function startRecording(platform: Platform, outputDir: string, options?: Partial<VideoOptions>): Promise<RecordingHandle>;
/**
 * Encode a raw recording for distribution. Returns VideoResult.
 */
export declare function encodeRecording(rawPath: string, outputDir: string, options?: Partial<VideoOptions>): Promise<VideoResult>;
//# sourceMappingURL=pipeline.d.ts.map