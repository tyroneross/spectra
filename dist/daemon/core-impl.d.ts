import type { CoreApi } from '../contract/core-api.js';
import { type ToolContext } from '../mcp/context.js';
import { type HealthProbeOptions } from './health.js';
import type { KeepAwakeController } from './keep-awake.js';
export interface CoreApiImplementationOptions {
    context?: ToolContext;
    startedAt?: number;
    daemonVersion?: string;
    healthProbe?: HealthProbeOptions;
    keepAwake?: KeepAwakeController;
}
export declare function createCoreApi(options?: CoreApiImplementationOptions): CoreApi;
//# sourceMappingURL=core-impl.d.ts.map