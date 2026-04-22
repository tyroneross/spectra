import type { Driver, DriverTarget, Snapshot, ActionType, ActResult } from '../core/types.js';
import { CdpConnection } from './connection.js';
import { type BrowserOptions } from './browser.js';
import { ConsoleDomain } from './console.js';
import { ResolutionCache } from '../core/cache.js';
export interface CdpDriverOptions {
    browser?: BrowserOptions;
}
export declare class CdpDriver implements Driver {
    private conn;
    private browser;
    private target;
    private ax;
    private consoleDomain;
    private input;
    private page;
    private dom;
    private runtime;
    private targetId;
    private sessionId;
    private currentUrl;
    private options;
    /** Resolution cache — available for MCP tools to use. */
    readonly cache: ResolutionCache;
    constructor(options?: CdpDriverOptions);
    connect(driverTarget: DriverTarget): Promise<void>;
    snapshot(): Promise<Snapshot>;
    act(elementId: string, action: ActionType, value?: string): Promise<ActResult>;
    screenshot(): Promise<Buffer>;
    get console(): ConsoleDomain;
    getConnection(): {
        conn: CdpConnection;
        sessionId: string | null;
    };
    navigate(url: string): Promise<void>;
    close(): Promise<void>;
    disconnect(): Promise<void>;
}
//# sourceMappingURL=driver.d.ts.map