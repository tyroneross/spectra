import type { ToolContext } from '../context.js';
export interface WalkthroughParams {
    sessionId: string;
    steps: Array<{
        intent: string;
        capture?: boolean;
        waitMs?: number;
    }>;
    clean?: boolean;
}
export interface WalkthroughStepResult {
    index: number;
    intent: string;
    action?: string;
    autoExecuted: boolean;
    success: boolean;
    error?: string;
    screenshotPath?: string;
    state?: string;
    elementCount: number;
}
export interface WalkthroughResult {
    success: boolean;
    stepsCompleted: number;
    stepsTotal: number;
    results: WalkthroughStepResult[];
    duration_ms: number;
}
export declare function handleWalkthrough(params: WalkthroughParams, ctx: ToolContext): Promise<WalkthroughResult>;
//# sourceMappingURL=walkthrough.d.ts.map