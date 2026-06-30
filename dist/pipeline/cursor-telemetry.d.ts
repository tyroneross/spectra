import type { CursorPoint, ZoomClick } from './zoom-keyframes.js';
export interface CursorTelemetry {
    clicks: ZoomClick[];
    cursorPath: CursorPoint[];
}
export declare function loadCursorTelemetry(jsonPath: string): Promise<CursorTelemetry>;
//# sourceMappingURL=cursor-telemetry.d.ts.map