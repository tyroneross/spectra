/**
 * Recording option shape. Retained as the typed vocabulary for the capture
 * presets (src/media/presets.ts picks fps/quality/hardware/codec/bitrate); the
 * full-display recording engine that consumed the rest is gone.
 */
export interface VideoOptions {
    fps: 30 | 60;
    quality: 'lossless' | 'high' | 'medium';
    hardware: boolean;
    codec: 'h264' | 'hevc';
    bitrate: '4M' | '8M';
    maxDuration?: number;
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
export type ProcessRunner = (cmd: string, args: string[]) => {
    kill: () => void;
    waitForExit: () => Promise<number>;
    stdout?: () => Promise<string>;
    stderr?: () => Promise<string>;
};
export declare function setProcessRunner(r: ProcessRunner): void;
export declare function resetProcessRunner(): void;
export declare function buildProbeArgs(inputPath: string): string[];
export declare function buildPosterFrameArgs(inputPath: string, outputPath: string, options?: PosterFrameOptions): string[];
export declare function probeVideo(inputPath: string): Promise<VideoProbeResult | undefined>;
export declare function extractPosterFrame(inputPath: string, outputPath: string, options?: PosterFrameOptions): Promise<void>;
//# sourceMappingURL=pipeline.d.ts.map