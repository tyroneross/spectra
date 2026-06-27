import type { ToolContext } from '../context.js';
import type { CaptureMode, CapturePreset } from '../../core/types.js';
export interface CaptureParams {
    sessionId: string;
    type: 'screenshot' | 'start_recording' | 'stop_recording';
    preset?: CapturePreset;
    mode?: CaptureMode;
    elementId?: string;
    region?: string;
    aspectRatio?: string;
    clean?: boolean;
    quality?: 'lossless' | 'high' | 'medium';
    fps?: 30 | 60;
    codec?: 'h264' | 'hevc';
    bitrate?: '4M' | '8M';
    hardware?: boolean;
    composite?: {
        enabled?: boolean;
        displayWidth?: number;
        displayHeight?: number;
        left?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        right?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
    };
}
export interface CaptureResult {
    path?: string;
    format?: string;
    preset?: CapturePreset;
    crop?: [number, number, number, number];
    label?: string;
    cleanApplied?: boolean;
    error?: string;
    recordingId?: string;
    durationMs?: number;
    sizeBytes?: number;
    codec?: string;
    fps?: number;
    width?: number;
    height?: number;
    bitrate?: string;
    droppedFrames?: number;
    startedAt?: number;
    alreadyStopped?: boolean;
}
export declare function handleCapture(params: CaptureParams, ctx: ToolContext): Promise<CaptureResult>;
//# sourceMappingURL=capture.d.ts.map