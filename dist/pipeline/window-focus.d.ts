import type { CanvasSize, FocalRect } from '../media/spotlight.js';
export declare const DEFAULT_WINDOW_BOUNDS_BINARY: string;
/** Resolved binary path -- `SPECTRA_WINDOW_BOUNDS_BIN` env override wins (used by tests/CI). */
export declare function windowBoundsBinaryPath(): string;
export interface WindowBoundsJson {
    x: number;
    y: number;
    w: number;
    h: number;
    screenW?: number;
    screenH?: number;
    normalized?: boolean;
    app?: string;
    title?: string;
}
export interface BinaryRunResult {
    status: number | null;
    stdout: string;
}
export type BinaryRunner = (binaryPath: string, args: string[]) => BinaryRunResult;
export interface ResolveFocalRectOptions {
    /** Substring filter on the owning app name (e.g. "Safari"). Omit for frontmost-app detection. */
    app?: string;
    /** Substring filter on the window title. */
    title?: string;
    /** Capture canvas -- the resolved window bounds are scaled into this frame. */
    canvas: CanvasSize;
    /** Override the binary path -- otherwise `windowBoundsBinaryPath()`. */
    binaryPath?: string;
    /** Injectable runner for tests -- otherwise spawns the real binary via spawnSync. */
    runBinary?: BinaryRunner;
}
/**
 * Resolves the on-screen bounds of the frontmost window (or a window
 * matching `app`/`title`) as a pixel FocalRect scaled to `canvas`. Returns
 * `undefined` -- never throws -- when the binary is missing, exits non-zero
 * (no matching window, e.g. no GUI session), or emits unparseable/empty
 * output.
 */
export declare function resolveFocalRect(opts: ResolveFocalRectOptions): Promise<FocalRect | undefined>;
/**
 * Converts the binary's window-bounds JSON into a pixel FocalRect for
 * `canvas`. Bounds reported as already-normalized (0..1, `normalized: true`)
 * are scaled up by the canvas dimensions directly. Absolute-pixel bounds
 * reported against a source screen size (`screenW`/`screenH`) are rescaled
 * proportionally to `canvas` -- so a focal rect captured on a 1512x982
 * display maps correctly onto a 1920x1080 capture canvas. Returns
 * `undefined` for malformed input (non-finite or non-positive dimensions).
 * Pure function.
 */
export declare function toFocalRect(bounds: WindowBoundsJson, canvas: CanvasSize): FocalRect | undefined;
//# sourceMappingURL=window-focus.d.ts.map