import type { ToolContext } from '../context.js';
export interface ActParams {
    sessionId: string;
    elementId: string;
    action: string;
    value?: string;
}
export interface ActResult {
    success: boolean;
    error?: string;
    snapshot: string;
}
export declare function handleAct(params: ActParams, ctx: ToolContext): Promise<ActResult>;
//# sourceMappingURL=act.d.ts.map