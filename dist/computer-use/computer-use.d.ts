import { type AxBridgePort } from './port.js';
import type { VisionFallback } from './vision-fallback.js';
import type { ActOutcome, AxSnapshot, AxTarget, ComputerUseAction, FillFormResult } from './types.js';
export interface ComputerUseOptions {
    /** Optional pixel-grounding fallback. Omit to run AX-only (returns signals). */
    visionFallback?: VisionFallback;
    /** Minimum AX node-count before the vision fallback is considered. Default 1
     * (i.e. an empty tree triggers the fallback). */
    visionFallbackThreshold?: number;
    /** App/window to scope to. Omit to target the focused (frontmost) app. */
    target?: AxTarget;
}
export declare class ComputerUse {
    private readonly port;
    private readonly opts;
    private readonly threshold;
    private cache;
    constructor(port: AxBridgePort, opts?: ComputerUseOptions);
    /** Preflight the Accessibility permission without prompting. */
    preflight(): Promise<{
        trusted: boolean;
    }>;
    /** Discard the cached snapshot so the next perceive re-reads the window. */
    invalidate(): void;
    /**
     * Snapshot the focused window as a scoped AX tree. Cached: repeated calls
     * reuse the last snapshot until an action invalidates it or `refresh` is set.
     */
    snapshotFocusedWindow(options?: {
        refresh?: boolean;
        visionFallbackThreshold?: number;
    }): Promise<AxSnapshot>;
    /** Route a single action to the right primitive. AX-node resolution first;
     * fall back to a signal (never a crash) when the tree can't ground it. */
    act(action: ComputerUseAction): Promise<ActOutcome>;
    /**
     * Resolve a {label → value} map against the focused window's editable AX
     * nodes, set each via AX, and verify each by read-back. First-class
     * form-filling: one snapshot, per-field verification, no blind coordinate typing.
     */
    fillForm(fields: Record<string, string>): Promise<FillFormResult>;
    private click;
    private setValue;
    private key;
    private clickVisionNode;
    private setVisionValue;
    private resolveEditable;
    private resolveByLabel;
    /** Unresolved target: not a crash. Signals a vision fallback when the tree is thin. */
    private unresolved;
}
//# sourceMappingURL=computer-use.d.ts.map