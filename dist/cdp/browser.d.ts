export declare const CHROME_PATHS: string[];
export declare function findChrome(): string | null;
export interface BrowserOptions {
    headless?: boolean;
    port?: number;
    userDataDir?: string;
}
export declare class BrowserManager {
    private process;
    private port;
    launch(options?: BrowserOptions): Promise<string>;
    private waitForDebugger;
    close(): Promise<void>;
    get running(): boolean;
}
//# sourceMappingURL=browser.d.ts.map