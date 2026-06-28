import type { CoreApi, WindowRecord } from '../contract/core-api.js';
import { type ToolContext } from '../mcp/context.js';
import { recordCompositeWithWorker } from './composite-worker.js';
import { type HealthProbeOptions } from './health.js';
import type { KeepAwakeController } from './keep-awake.js';
type CompositeWorker = typeof recordCompositeWithWorker;
type SingleWindowRecordingRunner = (input: NativeStartRecordingInput) => Promise<NativeRecordingHandle>;
export interface CoreApiImplementationOptions {
    context?: ToolContext;
    startedAt?: number;
    daemonVersion?: string;
    healthProbe?: HealthProbeOptions;
    keepAwake?: KeepAwakeController;
    recordCompositeWorker?: CompositeWorker;
    singleWindowRecordingRunner?: SingleWindowRecordingRunner;
    windowListProvider?: () => Promise<WindowRecord[]>;
}
export declare function createCoreApi(options?: CoreApiImplementationOptions): CoreApi;
interface NativeStartRecordingInput {
    recordingId: string;
    sessionId: string;
    app: string;
    outPath: string;
    fps: number;
    codec: string;
    bitrate: string;
    maxDurationSeconds: number;
}
interface NativeStartRecordingOutput {
    recordingId: string;
    path: string;
    startedAt?: number;
    fps?: number;
    codec?: string;
    bitrate?: string;
    width?: number;
    height?: number;
}
interface NativeStopRecordingOutput {
    recordingId?: string;
    path?: string;
    format?: string;
    durationMs?: number;
    sizeBytes?: number;
    codec?: string;
    fps?: number;
    width?: number;
    height?: number;
    droppedFrames?: number;
}
interface NativeRecordingHandle {
    pid?: number;
    started: NativeStartRecordingOutput;
    stop(): Promise<NativeStopRecordingOutput>;
    abort(): Promise<void>;
}
export {};
//# sourceMappingURL=core-impl.d.ts.map