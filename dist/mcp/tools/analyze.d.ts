import type { ToolContext } from '../context.js';
export interface AnalyzeParams {
    sessionId: string;
    viewport?: {
        width: number;
        height: number;
        devicePixelRatio?: number;
    };
}
export interface AnalyzeResult {
    state: string;
    stateConfidence: number;
    regions: Array<{
        label: string;
        score: number;
        bounds: [number, number, number, number];
        elementCount: number;
    }>;
    topElements: Array<{
        id: string;
        role: string;
        label: string;
        importance: number;
        bounds: [number, number, number, number];
    }>;
    totalElements: number;
    consoleErrors: Array<{
        type: string;
        text: string;
        url?: string;
    }>;
}
export declare function handleAnalyze(params: AnalyzeParams, ctx: ToolContext): Promise<AnalyzeResult>;
//# sourceMappingURL=analyze.d.ts.map