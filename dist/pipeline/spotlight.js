// src/pipeline/spotlight.ts
// Pipeline-facing spotlight pre-pass for polishClip. Reuses
// media/spotlight.ts's `buildSpotlightFilter` (split -> gblur+eq darken bg ->
// drawbox feathered mask -> alphamerge -> overlay) but tunes its defaults for
// the "dark-crush" reference look — the focal pane stays sharp and full
// brightness, everything else gets a feathered (~20-30px) blur plus a heavy
// darken toward near-black. buildSpotlightFilter's own defaults (dim 0.2,
// blur 22, feather 40) are a mild dim, not this look, and it's normally only
// reachable via the `polishDemo` segment path — this module makes it
// reachable as a single-focal-rect, whole-clip pre-pass inside polishClip.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireFfmpeg } from '../media/ffmpeg.js';
import { buildSpotlightFilter } from '../media/spotlight.js';
/**
 * Dark-crush spotlight tuning calibrated against the reference clip
 * (demo-candidates/polished/rally__personas-two-agents__MERGED_CAPTIONED.mp4):
 * heavy darken toward near-black (dim), a tight blur on the dimmed
 * background, and a soft ~26px feathered edge between focal and periphery.
 */
export const DARK_SPOTLIGHT_DEFAULTS = {
    dim: 0.75,
    blur: 8,
    feather: 26,
};
/**
 * Builds the dark-crush spotlight filtergraph stage (output label `[out]`).
 * Any field the caller omits falls back to DARK_SPOTLIGHT_DEFAULTS rather
 * than buildSpotlightFilter's own mild-dim defaults. Pure function — no
 * side effects, delegates entirely to media/spotlight.ts.
 */
export function buildDarkSpotlightFilter(opts) {
    return buildSpotlightFilter({
        focal: opts.focal,
        canvas: opts.canvas,
        dim: opts.dim ?? DARK_SPOTLIGHT_DEFAULTS.dim,
        blur: opts.blur ?? DARK_SPOTLIGHT_DEFAULTS.blur,
        feather: opts.feather ?? DARK_SPOTLIGHT_DEFAULTS.feather,
    });
}
/**
 * Renders the spotlight pre-pass to a temp mp4: the focal rect stays sharp
 * and full brightness, everything else is feathered-blur + dark-crushed.
 * Audio (if present) is stream-copied through untouched — the spotlight only
 * touches video. The returned path is meant to feed back in as the `input`
 * to the rest of the polish pipeline (zoom/framing/caption); callers own
 * cleanup via `cleanupSpotlightPrePass`.
 */
export async function renderSpotlightPrePass(opts) {
    const ffmpeg = requireFfmpeg();
    const outPath = join(tmpdir(), `spectra-spotlight-${randomUUID()}.mp4`);
    const filter = buildDarkSpotlightFilter(opts);
    const audioArgs = opts.hasAudio ? ['-map', '0:a?', '-c:a', 'copy'] : ['-an'];
    try {
        await new Promise((resolveProcess, reject) => {
            const proc = spawn(ffmpeg, [
                '-y',
                '-i', opts.input,
                '-filter_complex', filter,
                '-map', '[out]',
                ...audioArgs,
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-crf', '18',
                outPath,
            ], { stdio: 'pipe' });
            const stderrChunks = [];
            proc.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
            proc.on('error', reject);
            proc.on('close', (code) => {
                if (code === 0) {
                    resolveProcess();
                    return;
                }
                const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
                reject(new Error(`ffmpeg exited with code ${code}${stderr ? `\n${stderr}` : ''}`));
            });
        });
    }
    catch (err) {
        // The ffmpeg pass rejected — remove whatever partial output it wrote
        // before rethrowing, so callers never see a `path` that resolved but
        // whose file is an orphaned partial temp (rm swallows missing-file).
        await rm(outPath, { force: true }).catch(() => { });
        throw err;
    }
    return outPath;
}
/** Removes a spotlight pre-pass temp file. Swallows missing-file errors. */
export async function cleanupSpotlightPrePass(path) {
    await rm(path, { force: true }).catch(() => { });
}
//# sourceMappingURL=spotlight.js.map