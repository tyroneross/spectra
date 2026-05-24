import type { ToolContext } from '../context.js';
export interface CaptureParams {
    sessionId: string;
    type: 'screenshot' | 'start_recording' | 'stop_recording';
    mode?: 'full' | 'element' | 'region' | 'auto';
    elementId?: string;
    region?: string;
    aspectRatio?: string;
    clean?: boolean;
    quality?: 'lossless' | 'high' | 'medium';
    fps?: 30 | 60;
    codec?: 'h264' | 'hevc';
    bitrate?: '4M' | '8M';
    hardware?: boolean;
}
export interface CaptureResult {
    path?: string;
    format?: string;
    crop?: [number, number, number, number];
    label?: string;
    cleanApplied?: boolean;
    error?: string;
    recordingId?: string;
    durationMs?: number;
    sizeBytes?: number;
    codec?: string;
    fps?: number;
    droppedFrames?: number;
    startedAt?: number;
    alreadyStopped?: boolean;
}
export declare function handleCapture(params: CaptureParams, ctx: ToolContext): Promise<CaptureResult>;
//# sourceMappingURL=capture.d.ts.map