export declare const CHROME_PATHS: string[];
export declare function findChrome(): string | null;
export interface BrowserOptions {
    debuggerTimeoutMs?: number;
    headless?: boolean;
    port?: number;
    userDataDir?: string;
}
export declare class BrowserManager {
    private process;
    private port;
    private closed;
    private exited;
    private spawnError;
    launch(options?: BrowserOptions): Promise<string>;
    private waitForDebugger;
    close(): Promise<void>;
    get running(): boolean;
}
//# sourceMappingURL=browser.d.ts.map