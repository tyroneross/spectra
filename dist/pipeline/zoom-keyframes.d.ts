export interface ZoomClick {
    tMs: number;
    cx: number;
    cy: number;
}
export interface CursorPoint {
    tMs: number;
    cx: number;
    cy: number;
}
export interface ZoomKeyframe {
    frame: number;
    scale: number;
    cx: number;
    cy: number;
}
export interface ZoomTrackOptions {
    scale?: number;
    preMs?: number;
    postMs?: number;
    mergeGapMs?: number;
    ignoreTailMs?: number;
    easeInMs?: number;
    easeOutMs?: number;
    cursorPath?: CursorPoint[];
    dwellMinMs?: number;
    dwellMaxMs?: number;
    dwellDisplacement?: number;
}
export interface TimedZoomWindow {
    startMs: number;
    endMs: number;
    cx: number;
    cy: number;
    scale: number;
}
export interface TimedZoomTrackOptions {
    easeInMs?: number;
    easeOutMs?: number;
}
export declare function buildZoomTrack(clicks: ZoomClick[], totalMs: number, fps: number, opts?: ZoomTrackOptions): ZoomKeyframe[];
export declare function buildTimedZoomTrack(windows: TimedZoomWindow[], totalMs: number, fps: number, opts?: TimedZoomTrackOptions): ZoomKeyframe[];
//# sourceMappingURL=zoom-keyframes.d.ts.map