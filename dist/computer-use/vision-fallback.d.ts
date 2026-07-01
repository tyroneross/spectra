import type { AxNode, AxTarget } from './types.js';
export interface VisionContext {
    /** Why the fallback fired: 'empty' | 'no-window' | 'below-threshold'. */
    reason: string;
    nodeCount: number;
}
export interface VisionFallback {
    readonly name: string;
    /** Whether this fallback can currently run (model configured, etc.). */
    available(): boolean;
    /** Ground the focused window from pixels, returning AX-shaped nodes so the
     * rest of the pipeline (resolve label→node, act, verify) is identical whether
     * the nodes came from AX or from vision. */
    ground(target: AxTarget | undefined, context: VisionContext): Promise<AxNode[]>;
}
export declare class VisionFallbackUnavailableError extends Error {
    constructor(message?: string);
}
/** Default no-op fallback: reports unavailable and never grounds. Its presence
 * lets callers treat "fallback wired?" uniformly; swapping in a real
 * Screen2AX/OmniParser impl requires no orchestration changes. */
export declare class StubVisionFallback implements VisionFallback {
    readonly name = "stub-vision-fallback";
    available(): boolean;
    ground(): Promise<AxNode[]>;
}
//# sourceMappingURL=vision-fallback.d.ts.map