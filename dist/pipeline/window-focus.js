// src/pipeline/window-focus.ts
// Auto-focal-window detection for the dark-crush spotlight (spotlight.ts /
// polishClip's `autoFocus` option). Wraps the `spectra-window-bounds` native
// helper (native/swift/window-bounds/WindowBounds.swift) -- a lightweight
// CGWindowListCopyWindowInfo CLI, deliberately separate from the
// Accessibility-API AXBridge -- and turns its window-bounds JSON into a
// pixel FocalRect the dark-crush spotlight stage can consume directly.
//
// Runtime execution failures, a non-GUI session, and unparseable output all
// resolve to `undefined` so callers can skip auto-focus. Configuration and
// bundle-integrity failures are intentionally propagated before execution;
// production must not hide a missing or unsafe bundled helper.
import { spawnSync } from 'node:child_process';
import { ensureWindowBoundsBinary, WINDOW_BOUNDS_BINARY_PATH, } from '../native/compiler.js';
export const DEFAULT_WINDOW_BOUNDS_BINARY = WINDOW_BOUNDS_BINARY_PATH;
/** Resolve through the shared override/bundle/development helper contract. */
export function windowBoundsBinaryPath() {
    return ensureWindowBoundsBinary();
}
function defaultRunBinary(binaryPath, args) {
    const result = spawnSync(binaryPath, args, { encoding: 'utf-8' });
    if (result.error)
        throw result.error;
    return { status: result.status, stdout: result.stdout ?? '' };
}
/**
 * Resolves the on-screen bounds of the frontmost window (or a window
 * matching `app`/`title`) as a pixel FocalRect scaled to `canvas`. Returns
 * `undefined` when the resolved binary cannot run, exits non-zero (no matching
 * window, e.g. no GUI session), or emits unparseable/empty output. Strict
 * helper-resolution errors reject before the runner executes.
 */
export async function resolveFocalRect(opts) {
    const binaryPath = opts.binaryPath ?? windowBoundsBinaryPath();
    const run = opts.runBinary ?? defaultRunBinary;
    const args = [];
    if (opts.app)
        args.push('--app', opts.app);
    if (opts.title)
        args.push('--title', opts.title);
    let result;
    try {
        result = run(binaryPath, args);
    }
    catch {
        return undefined;
    }
    if (result.status !== 0 || !result.stdout.trim())
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(result.stdout);
    }
    catch {
        return undefined;
    }
    return toFocalRect(parsed, opts.canvas);
}
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
export function toFocalRect(bounds, canvas) {
    const { x, y, w, h } = bounds;
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0)
        return undefined;
    if (canvas.w <= 0 || canvas.h <= 0)
        return undefined;
    if (bounds.normalized) {
        return clampToCanvas({
            x: x * canvas.w,
            y: y * canvas.h,
            w: w * canvas.w,
            h: h * canvas.h,
        }, canvas);
    }
    const scaleX = bounds.screenW && bounds.screenW > 0 ? canvas.w / bounds.screenW : 1;
    const scaleY = bounds.screenH && bounds.screenH > 0 ? canvas.h / bounds.screenH : 1;
    return clampToCanvas({
        x: x * scaleX,
        y: y * scaleY,
        w: w * scaleX,
        h: h * scaleY,
    }, canvas);
}
function clampToCanvas(rect, canvas) {
    const x = Math.max(0, Math.min(Math.round(rect.x), canvas.w - 1));
    const y = Math.max(0, Math.min(Math.round(rect.y), canvas.h - 1));
    const w = Math.max(1, Math.min(Math.round(rect.w), canvas.w - x));
    const h = Math.max(1, Math.min(Math.round(rect.h), canvas.h - y));
    return { x, y, w, h };
}
//# sourceMappingURL=window-focus.js.map