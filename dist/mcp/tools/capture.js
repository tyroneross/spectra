import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getStoragePath } from '../../core/storage.js';
import { screenshot } from '../../media/capture.js';
import { scoreElements, findRegions } from '../../intelligence/importance.js';
import { frame } from '../../intelligence/framing.js';
import { prepareForCapture, restoreAfterCapture } from '../../media/clean.js';
import { resolveScreenshotCaptureOptions } from '../../media/presets.js';
/**
 * Resolve the per-session storage directory. Prefers the SessionManager's
 * record (which honors a `repoPath` passed at connect time) so launchd-spawned
 * daemons write artifacts into the user's repo and not $HOME (C2.6). Falls
 * back to process-CWD-derived path for legacy contexts and narrow test mocks.
 */
function sessionStorageDir(ctx, sessionId) {
    const sdir = ctx.sessions.sessionDir;
    if (typeof sdir === 'function') {
        const dir = sdir.call(ctx.sessions, sessionId);
        if (dir)
            return dir;
    }
    return join(getStoragePath(), 'sessions', sessionId);
}
/** Parse an aspect ratio string like "16:9" or "4:3" into a numeric ratio (w/h). */
function parseAspectRatio(value) {
    const parts = value.split(':');
    if (parts.length !== 2)
        return undefined;
    const w = parseFloat(parts[0]);
    const h = parseFloat(parts[1]);
    if (!isFinite(w) || !isFinite(h) || h === 0)
        return undefined;
    return w / h;
}
const DEFAULT_VIEWPORT = { width: 1280, height: 800, devicePixelRatio: 1 };
function buildMetadata(values) {
    const metadata = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
    return Object.keys(metadata).length > 0 ? metadata : undefined;
}
export async function handleCapture(params, ctx) {
    const driver = ctx.drivers.get(params.sessionId);
    if (!driver)
        throw new Error(`Session ${params.sessionId} not found`);
    const session = ctx.sessions.get(params.sessionId);
    const platform = session?.platform ?? 'web';
    if (params.type === 'screenshot') {
        const screenshotOptions = resolveScreenshotCaptureOptions(params);
        const mode = screenshotOptions.mode;
        const cleanRequested = screenshotOptions.clean;
        const aspectRatio = screenshotOptions.aspectRatio
            ? parseAspectRatio(screenshotOptions.aspectRatio)
            : undefined;
        // Extract CDP connection if the driver exposes one
        const connection = driver.getConnection?.();
        const conn = (connection?.conn ?? null);
        const driverSessionId = connection?.sessionId ?? null;
        // Apply cleanup before capture
        let cleanState = null;
        if (cleanRequested) {
            cleanState = await prepareForCapture(conn, driverSessionId, platform);
        }
        const cleanApplied = cleanRequested && (cleanState?.applied.length ?? 0) > 0;
        try {
            // Full screenshot (no intelligence)
            if (mode === 'full' || (!params.elementId && !params.region && mode !== 'auto')) {
                const result = await screenshot(driver, platform);
                const filename = `capture-${Date.now()}.${result.format}`;
                const dir = sessionStorageDir(ctx, params.sessionId);
                await mkdir(dir, { recursive: true });
                const path = join(dir, filename);
                await writeFile(path, result.buffer);
                await ctx.sessions.addArtifact(params.sessionId, {
                    type: 'screenshot',
                    path: filename,
                    format: result.format,
                    label: 'Full screen',
                    metadata: buildMetadata({
                        mode,
                        preset: screenshotOptions.preset,
                        aspectRatio: screenshotOptions.aspectRatio,
                        quality: screenshotOptions.quality,
                        productionReady: screenshotOptions.productionReady,
                    }),
                });
                return { path, format: result.format, cleanApplied, preset: screenshotOptions.preset };
            }
            // All intelligence modes need a snapshot + screenshot
            const snapshot = await driver.snapshot();
            const rawBuf = await driver.screenshot();
            const scores = scoreElements(snapshot.elements, DEFAULT_VIEWPORT);
            let frameResult;
            if (mode === 'element' && params.elementId) {
                // Find the element and crop to its bounds
                const el = snapshot.elements.find(e => e.id === params.elementId);
                if (!el) {
                    return { error: `Element ${params.elementId} not found in snapshot` };
                }
                frameResult = frame(rawBuf, scores, snapshot.elements, {
                    target: 'element',
                    elementId: params.elementId,
                    aspectRatio,
                });
            }
            else if (mode === 'region' && params.region) {
                // Find regions, match by label
                const regions = findRegions(scores, snapshot.elements);
                const label = params.region.toLowerCase();
                const regionIndex = regions.findIndex(r => r.label.toLowerCase() === label);
                frameResult = frame(rawBuf, scores, snapshot.elements, {
                    target: 'region',
                    regionIndex: regionIndex >= 0 ? regionIndex : 0,
                    aspectRatio,
                });
            }
            else {
                // Auto: score elements and auto-frame to the best region
                frameResult = frame(rawBuf, scores, snapshot.elements, {
                    target: undefined, // triggers auto path in frame()
                    aspectRatio,
                });
            }
            const filename = `capture-${Date.now()}.png`;
            const dir = sessionStorageDir(ctx, params.sessionId);
            await mkdir(dir, { recursive: true });
            const path = join(dir, filename);
            await writeFile(path, frameResult.buffer);
            await ctx.sessions.addArtifact(params.sessionId, {
                type: 'screenshot',
                path: filename,
                format: 'png',
                label: frameResult.label,
                metadata: {
                    crop: frameResult.crop,
                    mode,
                    preset: screenshotOptions.preset,
                    aspectRatio: screenshotOptions.aspectRatio,
                    quality: screenshotOptions.quality,
                    productionReady: screenshotOptions.productionReady,
                },
            });
            return {
                path,
                format: 'png',
                crop: frameResult.crop,
                label: frameResult.label,
                cleanApplied,
                preset: screenshotOptions.preset,
            };
        }
        finally {
            if (cleanState) {
                await restoreAfterCapture(cleanState);
            }
        }
    }
    return { error: `Unknown capture type: ${params.type}` };
}
//# sourceMappingURL=capture.js.map