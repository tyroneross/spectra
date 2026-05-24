import type { ToolContext } from '../context.js';
import type { Driver } from '../../core/types.js';
export interface ConnectParams {
    target: string;
    name?: string;
    record?: boolean;
    /**
     * If present, the launcher first boots a dev server / macOS app for this
     * repo, then derives the effective target from the launch result (overriding
     * `target` for web/macos kinds).
     */
    repoPath?: string;
}
export interface ConnectResult {
    sessionId: string;
    platform: string;
    elementCount: number;
    snapshot: string;
    launched?: {
        kind: string;
        pid?: number;
        url?: string;
        appName?: string;
    };
}
export declare function handleConnect(params: ConnectParams, ctx: ToolContext, createDriver?: () => Driver): Promise<ConnectResult>;
//# sourceMappingURL=connect.d.ts.map