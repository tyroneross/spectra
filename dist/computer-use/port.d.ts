import type { AxNode, AxStatus, AxTarget } from './types.js';
export interface RawAxSnapshot {
    window: {
        title: string;
        bounds: [number, number, number, number];
    } | null;
    elements: AxNode[];
    nodeCount: number;
    axStatus: AxStatus;
    focusedWindowTitle: string;
}
export interface RawActRequest {
    target?: AxTarget;
    elementPath: number[];
    /** Native verb — the orchestrator maps click→press, set-value→setValue. */
    action: 'press' | 'setValue';
    value?: string;
}
export interface RawActResult {
    success: boolean;
    /** setValue: post-set read-back of the field value (verification). */
    value?: string | null;
    error?: string;
}
export interface RawKeyRequest {
    target?: AxTarget;
    key: string;
}
export interface AxBridgePort {
    /** Snapshot the focused window of the target (or frontmost app). */
    snapshotFocused(target?: AxTarget): Promise<RawAxSnapshot>;
    act(req: RawActRequest): Promise<RawActResult>;
    key(req: RawKeyRequest): Promise<{
        success: boolean;
        error?: string;
    }>;
    preflight(): Promise<{
        trusted: boolean;
    }>;
}
/** Thrown when the OS denies Accessibility access — surfaced as a clear,
 * actionable error rather than an opaque bridge failure or a crash. */
export declare class AxPermissionError extends Error {
    constructor(message: string);
}
/** Heuristic: does a native bridge error indicate missing AX permission? */
export declare function isPermissionMessage(message: string): boolean;
//# sourceMappingURL=port.d.ts.map