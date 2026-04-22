import type { ToolContext } from '../context.js';
export interface StepParams {
    sessionId: string;
    intent: string;
}
export interface StepResult {
    snapshot: string;
    candidates?: Array<{
        id: string;
        role: string;
        label: string;
    }>;
    autoExecuted?: boolean;
    action?: string;
    error?: string;
    visionFallback?: boolean;
    screenshot?: string;
}
export declare function handleStep(params: StepParams, ctx: ToolContext): Promise<StepResult>;
//# sourceMappingURL=step.d.ts.map