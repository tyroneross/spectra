import type { ToolContext } from '../context.js';
import type { ActionType } from '../../core/types.js';
export interface ActionPlanStep {
    /** What kind of action the LLM decided on. */
    type: ActionType;
    /** Element ID resolved by the planner against the most-recent snapshot. */
    elementId: string;
    /** For 'type' actions, the text to enter. */
    value?: string;
    /** Optional rationale string, recorded into the session step for replay. */
    intent?: string;
    /** Optional ms wait AFTER the action, before snapshotting. Defaults to 0. */
    waitAfterMs?: number;
}
export interface LlmStepParams {
    sessionId: string;
    actions: ActionPlanStep[];
    /**
     * If true, the executor continues past a single failing step (best-effort).
     * Default false — short-circuit on first error.
     */
    continueOnError?: boolean;
}
export interface LlmStepResult {
    sessionId: string;
    stepsExecuted: number;
    stepsTotal: number;
    success: boolean;
    results: Array<{
        index: number;
        intent?: string;
        type: ActionType;
        elementId: string;
        success: boolean;
        error?: string;
        durationMs: number;
    }>;
    /** Final snapshot after the last executed step. Serialized text form. */
    finalSnapshot?: string;
}
export declare function handleLlmStep(params: LlmStepParams, ctx: ToolContext): Promise<LlmStepResult>;
//# sourceMappingURL=llm-step.d.ts.map