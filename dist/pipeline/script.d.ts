import { type TimedZoomTrackOptions, type TimedZoomWindow, type ZoomKeyframe } from './zoom-keyframes.js';
export type Beat = {
    id: string;
    stepLabel?: string;
    stepText?: string;
    startMs: number;
    endMs: number;
    zoom?: {
        cx: number;
        cy: number;
        scale: number;
    };
    action?: {
        kind: 'search' | 'click' | 'scroll' | 'navigate' | 'hold';
        target?: string;
        value?: string;
    };
};
export type DemoScript = {
    title?: string;
    finalCaption?: string;
    beats: Beat[];
};
export declare const atomizeScript: DemoScript;
export declare function scriptDurationMs(script: DemoScript): number;
export declare function scriptZoomWindows(script: DemoScript, totalMs?: number): TimedZoomWindow[];
export declare function buildScriptZoomTrack(script: DemoScript, totalMs: number, fps: number, opts?: TimedZoomTrackOptions): ZoomKeyframe[];
export declare function scaleScriptToDuration(script: DemoScript, durationMs: number): DemoScript;
export declare function clipScriptToDuration(script: DemoScript, durationMs: number): DemoScript;
//# sourceMappingURL=script.d.ts.map