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
export interface CompositeRecoveryManifest {
    schema: 'spectra.composite-recovery.v1';
    status: string;
    output: string;
    left: string;
    right: string;
    fps: number;
    durationSeconds: number;
    paneHeight: number;
    pixFmt: string;
    maxWidth: number;
    crf: number;
    updatedAt: string;
}
export declare function buildCompositeRecoveryArgs(manifest: CompositeRecoveryManifest, outPath?: string): string[];
export declare function compositeRecoveryDirectoryPrefix(outPath: string): string;
export declare function recoverCompositeOutput(recoveryDirectory: string, outPath: string): Promise<CompositeRecoveryManifest>;
export declare function buildCompositeWorkerArgs(params: RecordCompositeParams): string[];
export declare function parseLuminance(output: string, blackThreshold?: 40): BlackFrameGuard;
export declare function parseScreenRecordingPreflightOutput(output: string): ScreenRecordingPreflightFailure | undefined;
export declare function recordCompositeWithWorker(params: RecordCompositeParams): Promise<RecordCompositeCompletedResult>;
//# sourceMappingURL=composite-worker.d.ts.map