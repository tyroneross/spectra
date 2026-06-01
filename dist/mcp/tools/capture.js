import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getStoragePath } from '../../core/storage.js';
import { screenshot } from '../../media/capture.js';
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
import { scoreElements, findRegions } from '../../intelligence/importance.js';
import { frame } from '../../intelligence/framing.js';
import { prepareForCapture, restoreAfterCapture } from '../../media/clean.js';
import { recordings } from '../../media/recordings.js';
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
export async function handleCapture(params, ctx) {
    const driver = ctx.drivers.get(params.sessionId);
    if (!driver)
        throw new Error(`Session ${params.sessionId} not found`);
    const session = ctx.sessions.get(params.sessionId);
    const platform = session?.platform ?? 'web';
    if (params.type === 'screenshot') {
        const mode = params.mode ?? 'full';
        const cleanRequested = params.clean !== false; // default: true
        const aspectRatio = params.aspectRatio ? parseAspectRatio(params.aspectRatio) : undefined;
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
                return { path, format: result.format, cleanApplied };
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
            return {
                path,
                format: 'png',
                crop: frameResult.crop,
                label: frameResult.label,
                cleanApplied,
            };
        }
        finally {
            if (cleanState) {
                await restoreAfterCapture(cleanState);
            }
        }
    }
    if (params.type === 'start_recording') {
        const outputDir = sessionStorageDir(ctx, params.sessionId);
        await mkdir(outputDir, { recursive: true });
        const videoOptions = {};
        if (params.fps)
            videoOptions.fps = params.fps;
        if (params.quality)
            videoOptions.quality = params.quality;
        if (params.hardware !== undefined)
            videoOptions.hardware = params.hardware;
        if (params.codec)
            videoOptions.codec = params.codec;
        if (params.bitrate)
            videoOptions.bitrate = params.bitrate;
        try {
            const r = await recordings.start({
                sessionId: params.sessionId,
                platform,
                outputDir,
                options: videoOptions,
            });
            return {
                recordingId: r.recordingId,
                startedAt: r.startedAt,
                fps: r.options.fps,
                codec: resolveCodecName(r.options),
                bitrate: r.options.bitrate,
            };
        }
        catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }
    if (params.type === 'stop_recording') {
        const outputDir = sessionStorageDir(ctx, params.sessionId);
        await mkdir(outputDir, { recursive: true });
        try {
            const r = await recordings.stop({
                sessionId: params.sessionId,
                outputDir,
            });
            return {
                recordingId: r.recordingId,
                path: r.path,
                format: 'mp4',
                durationMs: r.durationMs,
                sizeBytes: r.sizeBytes,
                codec: r.codec,
                fps: r.fps,
                droppedFrames: r.droppedFrames,
                alreadyStopped: r.alreadyStopped,
            };
        }
        catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }
    return { error: `Unknown capture type: ${params.type}` };
}
function resolveCodecName(options) {
    if (options.hardware && options.quality !== 'lossless') {
        return options.codec === 'hevc' ? 'hevc_videotoolbox' : 'h264_videotoolbox';
    }
    return options.codec === 'hevc' ? 'libx265' : 'libx264';
}
//# sourceMappingURL=capture.js.map