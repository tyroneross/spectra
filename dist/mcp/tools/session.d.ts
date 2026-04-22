import type { ToolContext } from '../context.js';
export interface SessionParams {
    action: 'list' | 'get' | 'close' | 'close_all';
    sessionId?: string;
}
export declare function handleSession(params: SessionParams, ctx: ToolContext): Promise<unknown>;
//# sourceMappingURL=session.d.ts.map