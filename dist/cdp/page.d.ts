import type { CdpConnection } from './connection.js';
export interface ScreenshotOptions {
    format?: 'png' | 'jpeg';
    quality?: number;
    clip?: {
        x: number;
        y: number;
        width: number;
        height: number;
        scale?: number;
    };
    hideScrollbars?: boolean;
}
export declare class PageDomain {
    private conn;
    private sessionId?;
    constructor(conn: CdpConnection, sessionId?: string | undefined);
    navigate(url: string): Promise<string>;
    screenshot(options?: ScreenshotOptions): Promise<Buffer>;
    enableLifecycleEvents(): Promise<void>;
}
//# sourceMappingURL=page.d.ts.map