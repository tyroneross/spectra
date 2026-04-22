import type { ToolContext } from '../context.js';
export interface DiscoverParams {
    sessionId: string;
    maxDepth?: number;
    maxScreens?: number;
    captureStates?: boolean;
    clean?: boolean;
    outputDir?: string;
}
export interface DiscoverResult {
    screens: number;
    captures: number;
    sensitive: string[];
    manifestPath: string;
    outputDir: string;
}
export declare function handleDiscover(params: DiscoverParams, ctx: ToolContext): Promise<DiscoverResult>;
//# sourceMappingURL=discover.d.ts.map