import type { Driver, Platform, Element } from '../core/types.js';
import type { RecordHandle } from './recorder.js';
export interface ScreenshotOptions {
    format?: 'png' | 'jpeg';
    quality?: number;
    element?: Element;
    region?: [number, number, number, number];
    devicePixelRatio?: number;
}
export interface ScreenshotResult {
    buffer: Buffer;
    path?: string;
    format: string;
    bounds?: [number, number, number, number];
}
export declare function screenshot(driver: Driver, platform: Platform, options?: ScreenshotOptions): Promise<ScreenshotResult>;
export declare function startRecording(platform: Platform, deviceId?: string): Promise<RecordHandle>;
//# sourceMappingURL=capture.d.ts.map