import type { CoreApi } from '../contract/core-api.js';
import { type ToolContext } from '../mcp/context.js';
import { recordCompositeWithWorker } from './composite-worker.js';
import { type HealthProbeOptions } from './health.js';
import type { KeepAwakeController } from './keep-awake.js';
type CompositeWorker = typeof recordCompositeWithWorker;
export interface CoreApiImplementationOptions {
    context?: ToolContext;
    startedAt?: number;
    daemonVersion?: string;
    healthProbe?: HealthProbeOptions;
    keepAwake?: KeepAwakeController;
    recordCompositeWorker?: CompositeWorker;
}
export declare function createCoreApi(options?: CoreApiImplementationOptions): CoreApi;
export {};
//# sourceMappingURL=core-impl.d.ts.map