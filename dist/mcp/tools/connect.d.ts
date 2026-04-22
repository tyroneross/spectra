import type { ToolContext } from '../context.js';
import type { Driver } from '../../core/types.js';
export interface ConnectParams {
    target: string;
    name?: string;
    record?: boolean;
}
export interface ConnectResult {
    sessionId: string;
    platform: string;
    elementCount: number;
    snapshot: string;
}
export declare function handleConnect(params: ConnectParams, ctx: ToolContext, createDriver?: () => Driver): Promise<ConnectResult>;
//# sourceMappingURL=connect.d.ts.map