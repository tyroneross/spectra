import type { BlackFrameGuard, JsonValue, RecordCompositeParams, RecordCompositeCompletedResult } from '../contract/core-api.js';
export declare const COMPOSITE_WORKER_DEFAULTS: {
    readonly durationSeconds: 5;
    readonly fps: 60;
    readonly spotlight: "none";
    readonly cursor: true;
    readonly maxWidth: 1600;
    readonly crf: 20;
    readonly blackThreshold: 40;
};
export interface ScreenRecordingPreflightFailure {
    code: string;
    message: string;
    hint?: string;
    details?: JsonValue;
    retryable?: boolean;
}
export declare function buildCompositeWorkerArgs(params: RecordCompositeParams): string[];
export declare function parseLuminance(output: string, blackThreshold?: 40): BlackFrameGuard;
export declare function parseScreenRecordingPreflightOutput(output: string): ScreenRecordingPreflightFailure | undefined;
export declare function recordCompositeWithWorker(params: RecordCompositeParams): Promise<RecordCompositeCompletedResult>;
//# sourceMappingURL=composite-worker.d.ts.map