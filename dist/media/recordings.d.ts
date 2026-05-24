import type { RecordingHandle, VideoOptions, VideoResult } from './pipeline.js';
import type { Platform } from '../core/types.js';
export interface RecordingRecord {
    id: string;
    sessionId: string;
    handle: RecordingHandle;
    rawPath: string;
    startedAt: number;
    options: VideoOptions;
    stopped: boolean;
    lastResult?: VideoResult & {
        droppedFrames?: number;
    };
}
export interface StartOptions {
    sessionId: string;
    platform: Platform;
    outputDir: string;
    options?: Partial<VideoOptions>;
}
export interface StartResult {
    recordingId: string;
    startedAt: number;
    options: VideoOptions;
}
export interface StopOptions {
    sessionId: string;
    outputDir: string;
}
export interface StopResult {
    recordingId: string;
    path: string;
    durationMs: number;
    sizeBytes: number;
    codec: string;
    fps: number;
    droppedFrames?: number;
    alreadyStopped: boolean;
}
/**
 * Singleton registry. The daemon process owns one of these; HTTP requests
 * across multiple connections share state via this module.
 */
declare class RecordingRegistry {
    private records;
    has(sessionId: string): boolean;
    list(): RecordingRecord[];
    start(opts: StartOptions): Promise<StartResult>;
    stop(opts: StopOptions): Promise<StopResult>;
    /** Forget a stopped recording (called by close-session). */
    forget(sessionId: string): void;
    /** Kill any active recording for a session without encoding (close-session shutdown). */
    abort(sessionId: string): Promise<void>;
    /** Test-only: reset the registry. */
    _reset(): void;
}
export declare const recordings: RecordingRegistry;
export {};
//# sourceMappingURL=recordings.d.ts.map