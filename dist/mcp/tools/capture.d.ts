import type { ToolContext } from '../context.js';
import type { CaptureMode, CapturePreset } from '../../core/types.js';
import type { ScreenshotResult } from '../../contract/core-api.js';
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
export declare function handleCapture(params: CaptureParams, ctx: ToolContext): Promise<ScreenshotResult>;
//# sourceMappingURL=capture.d.ts.map