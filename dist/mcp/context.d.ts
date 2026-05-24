import { SessionManager } from '../core/session.js';
import type { Driver, Platform } from '../core/types.js';
import type { LaunchHandle } from '../launcher/types.js';
export interface ToolContext {
    sessions: SessionManager;
    drivers: Map<string, Driver>;
    /** Launch handles keyed by sessionId. Populated when connect was called with repoPath. */
    launches: Map<string, LaunchHandle>;
}
export declare function createContext(): ToolContext;
export interface PlatformInfo {
    platform: Platform;
    driverType: 'cdp' | 'native' | 'sim';
}
export declare function detectPlatform(target: string): PlatformInfo;
//# sourceMappingURL=context.d.ts.map