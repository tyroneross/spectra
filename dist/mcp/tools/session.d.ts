import type { ToolContext } from '../context.js';
export interface SessionParams {
    action: 'list' | 'get' | 'close' | 'close_all' | 'record_llm_usage';
    sessionId?: string;
    /** For action=record_llm_usage: arbitrary JSON-serializable token usage payload. */
    usage?: unknown;
}
export declare function handleSession(params: SessionParams, ctx: ToolContext): Promise<unknown>;
//# sourceMappingURL=session.d.ts.map