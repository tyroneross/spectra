import { SessionManager } from '../core/session.js';
import type { Driver, Platform } from '../core/types.js';
export interface ToolContext {
    sessions: SessionManager;
    drivers: Map<string, Driver>;
}
export declare function createContext(): ToolContext;
export interface PlatformInfo {
    platform: Platform;
    driverType: 'cdp' | 'native' | 'sim';
}
export declare function detectPlatform(target: string): PlatformInfo;
//# sourceMappingURL=context.d.ts.map