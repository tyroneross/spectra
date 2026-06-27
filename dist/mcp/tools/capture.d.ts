import type { ToolContext } from '../context.js';
import type { CaptureMode, CapturePreset } from '../../core/types.js';
export interface CaptureParams {
    sessionId: string;
    type: 'screenshot';
    preset?: CapturePreset;
    mode?: CaptureMode;
    elementId?: string;
    region?: string;
    aspectRatio?: string;
    clean?: boolean;
    quality?: 'lossless' | 'high' | 'medium';
}
export interface CaptureResult {
    path?: string;
    format?: string;
    preset?: CapturePreset;
    crop?: [number, number, number, number];
    label?: string;
    cleanApplied?: boolean;
    error?: string;
}
export declare function handleCapture(params: CaptureParams, ctx: ToolContext): Promise<CaptureResult>;
//# sourceMappingURL=capture.d.ts.map