import type { Platform } from '../core/types.js';
export interface VideoOptions {
    fps: 30 | 60;
    quality: 'lossless' | 'high' | 'medium';
    hardware: boolean;
    codec: 'h264' | 'hevc';
    bitrate: '4M' | '8M';
    maxDuration?: number;
    captureInput?: string;
}
export interface VideoResult {
    path: string;
    duration: number;
    size: number;
    codec: string;
    fps: number;
    width?: number;
    height?: number;
}
export interface RecordingHandle {
    stop(): Promise<string>;
    platform: Platform;
    captureInput?: string;
}
export interface VideoProbeResult {
    durationMs?: number;
    width?: number;
    height?: number;
    fps?: number;
    codec?: string;
}
export interface PosterFrameOptions {
    atSeconds?: number;
    maxWidth?: number;
}
export interface CompositePane {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface CompositeLayout {
    left: CompositePane;
    right: CompositePane;
}
export type ProcessRunner = (cmd: string, args: string[]) => {
    kill: () => void;
    waitForExit: () => Promise<number>;
    stdout?: () => Promise<string>;
    stderr?: () => Promise<string>;
};
export declare function setProcessRunner(r: ProcessRunner): void;
export declare function resetProcessRunner(): void;
export declare function resolveVideoOptions(options?: Partial<VideoOptions>): VideoOptions;
export declare function buildAvfoundationDeviceListArgs(): string[];
export declare function parseAvfoundationScreenInput(stderr: string, preferredName?: string): string | undefined;
export declare function discoverAvfoundationScreenInput(): Promise<string | undefined>;
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
export declare function buildCompositeEncodeArgs(inputPath: string, outputPath: string, layout: CompositeLayout, options: VideoOptions): string[];
export declare function buildProbeArgs(inputPath: string): string[];
export declare function buildPosterFrameArgs(inputPath: string, outputPath: string, options?: PosterFrameOptions): string[];
/**
 * Start a recording session. Returns a RecordingHandle with stop().
 */
export declare function startRecording(platform: Platform, outputDir: string, options?: Partial<VideoOptions>): Promise<RecordingHandle>;
/**
 * Encode a raw recording for distribution. Returns VideoResult.
 */
export declare function encodeRecording(rawPath: string, outputDir: string, options?: Partial<VideoOptions>, compositeLayout?: CompositeLayout): Promise<VideoResult>;
export declare function probeVideo(inputPath: string): Promise<VideoProbeResult | undefined>;
export declare function extractPosterFrame(inputPath: string, outputPath: string, options?: PosterFrameOptions): Promise<void>;
//# sourceMappingURL=pipeline.d.ts.map