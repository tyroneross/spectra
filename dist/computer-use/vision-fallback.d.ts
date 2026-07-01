import type { AxBridgePort } from './port.js';
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
export interface NativeVisionFallbackOptions {
    target?: AxTarget;
    available: boolean;
    unavailableReason?: string;
}
/** Native macOS Vision fallback: focused-window screenshot -> OCR -> AX-shaped
 * coordinate nodes. `available()` is synchronous because ComputerUse calls it
 * inside the snapshot hot path; use `NativeVisionFallback.create()` so the
 * native screenshot/permission preflight runs before construction. */
export declare class NativeVisionFallback implements VisionFallback {
    private readonly port;
    readonly name = "native-vision-fallback";
    readonly unavailableReason?: string;
    private readonly usable;
    private readonly target?;
    constructor(port: AxBridgePort, options: NativeVisionFallbackOptions);
    static create(port: AxBridgePort, target?: AxTarget): Promise<NativeVisionFallback>;
    available(): boolean;
    ground(target: AxTarget | undefined, _context?: VisionContext): Promise<AxNode[]>;
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