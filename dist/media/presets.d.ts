import type { CaptureMode, CapturePreset } from '../core/types.js';
import type { VideoOptions } from './pipeline.js';
export interface ScreenshotCaptureDefaults {
    mode: CaptureMode;
    aspectRatio?: string;
    clean: boolean;
    quality?: VideoOptions['quality'];
}
export type RecordingCaptureDefaults = Partial<Pick<VideoOptions, 'fps' | 'quality' | 'hardware' | 'codec' | 'bitrate'>>;
export interface CapturePresetDefinition {
    id: CapturePreset;
    label: string;
    intent: string;
    productionReady: boolean;
    screenshot: ScreenshotCaptureDefaults;
    recording: RecordingCaptureDefaults;
}
export declare const CAPTURE_PRESETS: Record<CapturePreset, CapturePresetDefinition>;
export interface ScreenshotPresetInput {
    preset?: CapturePreset;
    mode?: CaptureMode;
    aspectRatio?: string;
    clean?: boolean;
    quality?: VideoOptions['quality'];
}
export interface ResolvedScreenshotCaptureOptions extends ScreenshotCaptureDefaults {
    preset?: CapturePreset;
    productionReady?: boolean;
}
export interface RecordingPresetInput extends RecordingCaptureDefaults {
    preset?: CapturePreset;
}
export declare function getCapturePresetDefinition(preset?: CapturePreset): CapturePresetDefinition | undefined;
export declare function resolveScreenshotCaptureOptions(input: ScreenshotPresetInput): ResolvedScreenshotCaptureOptions;
export declare function resolveRecordingCaptureOptions(input: RecordingPresetInput): Partial<VideoOptions>;
//# sourceMappingURL=presets.d.ts.map