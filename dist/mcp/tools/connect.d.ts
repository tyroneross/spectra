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
    /**
     * macOS only — bind the session to this exact process id. Use it when two
     * instances of the same app are running and the app name alone would pick
     * the wrong one. Equivalent to passing `target: "pid:<n>"`. When both are
     * supplied they must agree.
     */
    pid?: number;
}
/** Resolves a human-readable app name for a pid. Injectable for tests. */
export type PidAppNameResolver = (pid: number) => Promise<string | undefined>;
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
export declare function handleConnect(params: ConnectParams, ctx: ToolContext, createDriver?: () => Driver, resolvePidAppName?: PidAppNameResolver): Promise<ConnectResult>;
//# sourceMappingURL=connect.d.ts.map