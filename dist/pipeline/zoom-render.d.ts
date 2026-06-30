import type { TimedZoomWindow, ZoomKeyframe } from './zoom-keyframes.js';
export declare function zoomFilter(track: ZoomKeyframe[], srcW: number, srcH: number, outW?: number, outH?: number, fps?: number): string;
export declare function timedZoomFilter(windows: TimedZoomWindow[], totalMs: number, srcW: number, srcH: number, outW?: number, outH?: number, fps?: number): string;
//# sourceMappingURL=zoom-render.d.ts.map