import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardsFromScript, timedStepCardsOverlayPlan } from './annotations.js';
import { deriveZoomTrackFromActivity } from './auto-zoom.js';
import { frameChromeRenderPlan, framingFilter } from './framing.js';
import { scriptDurationMs, scriptZoomWindows } from './script.js';
import { cleanupSpotlightPrePass, renderSpotlightPrePass } from './spotlight.js';
import { renderCaptionPng } from './text-render.js';
import { buildZoomTrack } from './zoom-keyframes.js';
import { timedZoomFilter, zoomFilter } from './zoom-render.js';
const OUTPUT_W = 1920;
const OUTPUT_H = 1080;
const DEFAULT_FPS = 60;
const DEFAULT_FADE_MS = 250;
const CHROME_CACHE_VERSION = 1;
const CHROME_CACHE_DIR = join(tmpdir(), 'spectra-frame-chrome');
export async function polishClip(options) {
    const fps = options.fps ?? DEFAULT_FPS;
    if (!Number.isInteger(fps) || fps <= 0) {
        throw new Error('fps must be a positive integer');
    }
    const [metadata, hasAudio] = await Promise.all([
        probeVideo(options.input),
        probeHasAudio(options.input),
    ]);
    let renderInput = options.input;
    let spotlightTempPath;
    if (options.spotlight) {
        spotlightTempPath = await renderSpotlightPrePass({
            input: options.input,
            canvas: { w: metadata.width, h: metadata.height },
            focal: options.spotlight.focal,
            dim: options.spotlight.dim,
            blur: options.spotlight.blur,
            feather: options.spotlight.feather,
            hasAudio,
        });
        renderInput = spotlightTempPath;
    }
    try {
        const parsed = await parseClicksJson(options.clicksJson);
        const durationMs = metadata.durationMs ?? inferDurationMs(parsed);
        // No hand-authored clicks or cursor path: auto-derive a zoom track from
        // scene-change activity (see auto-zoom.ts) so the clip still zooms during
        // active stretches. Explicit clicksJson (or a cursorPath) is always
        // honored as-is — this is fill-only for the empty case, and falls back
        // to the prior static (no-zoom) behavior when no activity is detected.
        const effectiveClicks = parsed.clicks.length === 0 && !parsed.cursorPath?.length
            ? await deriveZoomTrackFromActivity(options.input, durationMs)
            : parsed.clicks;
        const track = buildZoomTrack(effectiveClicks, durationMs, fps, {
            cursorPath: parsed.cursorPath,
        });
        let nextInputIndex = 1;
        const chrome = await renderFrameChromeAssets(nextInputIndex, OUTPUT_W, OUTPUT_H, fps);
        nextInputIndex += 1;
        const captionText = options.caption?.trim();
        const captionOverlay = captionText
            ? await buildClipCaptionOverlay(captionText, durationMs, nextInputIndex, OUTPUT_W, OUTPUT_H)
            : undefined;
        if (captionOverlay)
            nextInputIndex += 1;
        const fallbackCaption = captionOverlay ? undefined : captionText;
        const captionMode = fallbackCaption && !(await ffmpegHasFilter('drawtext')) ? 'bitmap' : 'drawtext';
        const zoom = zoomFilter(track, metadata.width, metadata.height, OUTPUT_W, OUTPUT_H, fps);
        const frame = framingFilter({
            inputLabel: 'zoomed',
            outputLabel: captionOverlay ? 'framed' : 'v',
            caption: fallbackCaption,
            captionMode,
            fps,
            outW: OUTPUT_W,
            outH: OUTPUT_H,
            chromeAssets: chrome.chromeAssets,
        });
        const filterComplex = [
            `[0:v]fps=${fps},${zoom}[zoomed]`,
            frame,
            ...(captionOverlay ? [captionOverlay.filter] : []),
        ].join(';');
        const audio = buildAudioArgs(hasAudio);
        await mkdir(dirname(options.outPath), { recursive: true });
        await runProcess('ffmpeg', [
            '-y',
            '-i', renderInput,
            ...chrome.maskInputArgs,
            ...imageInputArgs(captionOverlay ? [captionOverlay.path] : [], fps),
            '-filter_complex', filterComplex,
            '-map', '[v]',
            ...audio.mapArgs,
            '-frames:v', String(Math.max(1, track.length)),
            ...audio.codecArgs,
            '-r', String(fps),
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-crf', '18',
            '-movflags', '+faststart',
            options.outPath,
        ]);
        return {
            outPath: options.outPath,
            width: OUTPUT_W,
            height: OUTPUT_H,
            fps,
            durationMs,
            frames: track.length,
        };
    }
    finally {
        if (spotlightTempPath)
            await cleanupSpotlightPrePass(spotlightTempPath);
    }
}
export async function polishScript(options) {
    const fps = options.fps ?? DEFAULT_FPS;
    if (!Number.isInteger(fps) || fps <= 0) {
        throw new Error('fps must be a positive integer');
    }
    const [metadata, hasAudio] = await Promise.all([
        probeVideo(options.input),
        probeHasAudio(options.input),
    ]);
    const durationMs = metadata.durationMs ?? scriptDurationMs(options.script);
    const frames = frameCount(durationMs, fps);
    const finalCaption = options.script.finalCaption?.trim();
    let nextInputIndex = 1;
    const chrome = await renderFrameChromeAssets(nextInputIndex, OUTPUT_W, OUTPUT_H, fps);
    nextInputIndex += 1;
    const captionOverlay = finalCaption
        ? await buildCaptionOverlay(options.script, finalCaption, durationMs, nextInputIndex, OUTPUT_W, OUTPUT_H)
        : undefined;
    if (captionOverlay)
        nextInputIndex += 1;
    const fallbackCaption = captionOverlay ? undefined : finalCaption;
    const captionMode = fallbackCaption && !(await ffmpegHasFilter('drawtext')) ? 'bitmap' : 'drawtext';
    const zoom = timedZoomFilter(scriptZoomWindows(options.script, durationMs), durationMs, metadata.width, metadata.height, OUTPUT_W, OUTPUT_H, fps);
    const frame = framingFilter({
        inputLabel: 'zoomed',
        outputLabel: 'framed',
        caption: fallbackCaption,
        captionMode,
        fps,
        outW: OUTPUT_W,
        outH: OUTPUT_H,
        chromeAssets: chrome.chromeAssets,
    });
    const cardInputLabel = captionOverlay?.outputLabel ?? 'framed';
    const cardPlan = await timedStepCardsOverlayPlan({
        inputLabel: cardInputLabel,
        outputLabel: 'v',
        cards: cardsFromScript(options.script),
        fps,
        outW: OUTPUT_W,
        outH: OUTPUT_H,
        inputIndexStart: nextInputIndex,
    });
    const imagePaths = [
        ...(captionOverlay ? [captionOverlay.path] : []),
        ...cardPlan.imagePaths,
    ];
    const filterComplex = [
        `[0:v]fps=${fps},${zoom}[zoomed]`,
        frame,
        ...(captionOverlay ? [captionOverlay.filter] : []),
        cardPlan.filter,
    ].join(';');
    const audio = buildAudioArgs(hasAudio);
    await mkdir(dirname(options.outPath), { recursive: true });
    await runProcess('ffmpeg', [
        '-y',
        '-i', options.input,
        ...chrome.maskInputArgs,
        ...imageInputArgs(imagePaths, fps),
        '-filter_complex', filterComplex,
        '-map', '[v]',
        ...audio.mapArgs,
        '-frames:v', String(Math.max(1, frames)),
        ...audio.codecArgs,
        '-r', String(fps),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', '18',
        '-movflags', '+faststart',
        options.outPath,
    ]);
    return {
        outPath: options.outPath,
        width: OUTPUT_W,
        height: OUTPUT_H,
        fps,
        durationMs,
        frames,
    };
}
/**
 * Renders the rounded-rect mask ONCE via a single ffmpeg pass (see
 * `frameChromeRenderPlan` in framing.ts) and returns the ffmpeg input args
 * needed to supply it to `framingFilter` as a looped raw-video input.
 * Cached on disk by a hash of the render params, so repeated calls at the
 * same geometry (the common case -- every polish run uses the same
 * 1920x1080 / 0.88 / 20px chrome) reuse the existing file instead of
 * re-rendering.
 *
 * This is the fix for the dominant render-time cost: the rounded-rect mask
 * is otherwise recomputed via a per-pixel `geq` expression on every output
 * frame, which profiling showed as ~87% of total render time. The mask is a
 * pure boolean (0 or 255) cutout, so rendering it once and reusing the
 * result is bit-identical to recomputing it every frame -- it just isn't
 * recomputed N times.
 *
 * The mask is cached as raw video (not PNG): PNG's encode/decode round-trip
 * lets ffmpeg's pixel-format auto-negotiation pick slightly different
 * intermediate formats than the live per-frame graph, which measurably
 * (~5dB) eroded pixel parity in testing. Raw video has no container
 * metadata to negotiate over, so the reloaded mask is bit-identical to the
 * one ffmpeg would have computed inline.
 */
async function renderFrameChromeAssets(inputIndexStart, outW, outH, fps) {
    const plan = frameChromeRenderPlan({ outW, outH });
    const { contentW, contentH } = plan.layout;
    const cacheKey = createHash('sha256')
        .update(JSON.stringify({ version: CHROME_CACHE_VERSION, outW, outH, layout: plan.layout }))
        .digest('hex')
        .slice(0, 32);
    const maskPath = join(CHROME_CACHE_DIR, `mask-${cacheKey}.gray`);
    if (!(await exists(maskPath))) {
        await mkdir(CHROME_CACHE_DIR, { recursive: true });
        await runProcess('ffmpeg', [
            '-y',
            '-filter_complex', plan.filterComplex,
            '-map', plan.maskLabel,
            '-frames:v', '1',
            '-f', 'rawvideo',
            '-pix_fmt', 'gray',
            maskPath,
        ]);
    }
    return {
        maskInputArgs: [
            '-stream_loop', '-1',
            '-f', 'rawvideo',
            '-pix_fmt', 'gray',
            '-s', `${contentW}x${contentH}`,
            '-framerate', String(fps),
            '-i', maskPath,
        ],
        chromeAssets: { maskIndex: inputIndexStart },
    };
}
async function exists(path) {
    return access(path).then(() => true, () => false);
}
async function buildClipCaptionOverlay(caption, durationMs, inputIndex, outW, outH) {
    return buildTimedCaptionOverlay(caption, { startMs: 0, endMs: Math.max(0, durationMs) }, inputIndex, outW, outH, 'framed', 'v');
}
async function buildCaptionOverlay(script, finalCaption, durationMs, inputIndex, outW, outH) {
    const window = finalCaptionWindow(script, finalCaption, durationMs);
    // No valid placement (e.g. the matched beat is truncated out of a short input):
    // skip the final caption rather than defaulting it to the whole clip, which would
    // overlap the per-beat step cards.
    if (!window)
        return undefined;
    return buildTimedCaptionOverlay(finalCaption, window, inputIndex, outW, outH, 'framed', 'captioned');
}
async function buildTimedCaptionOverlay(text, window, inputIndex, outW, outH, inputLabel, outputLabel) {
    const path = await renderCaptionPng({
        text,
        outW,
        outH,
    });
    if (!path)
        return undefined;
    const startSec = seconds(window.startMs);
    const endSec = seconds(window.endMs);
    const duration = window.endMs - window.startMs;
    const fadeMs = Math.min(DEFAULT_FADE_MS, duration / 2);
    const fadeSec = seconds(fadeMs);
    const fadeOutStartSec = seconds(window.endMs - fadeMs);
    const fade = fadeSec === '0'
        ? ''
        : `,fade=t=in:st=${startSec}:d=${fadeSec}:alpha=1,fade=t=out:st=${fadeOutStartSec}:d=${fadeSec}:alpha=1`;
    const assetLabel = 'captionPng';
    return {
        path,
        outputLabel,
        filter: `${labelRef(`${inputIndex}:v`)}format=rgba${fade}${labelRef(assetLabel)};${labelRef(inputLabel)}${labelRef(assetLabel)}overlay=x=0:y=0:shortest=1:enable='between(t\\,${startSec}\\,${endSec})'${labelRef(outputLabel)}`,
    };
}
export function finalCaptionWindow(script, finalCaption, durationMs) {
    const validBeats = script.beats
        .filter((beat) => Number.isFinite(beat.startMs)
        && Number.isFinite(beat.endMs)
        && beat.endMs > beat.startMs);
    const matchingBeat = [...validBeats].reverse().find((beat) => beat.stepText?.trim() === finalCaption);
    const beat = matchingBeat ?? validBeats.at(-1);
    // No beats at all: caption-only script — show it for the whole clip.
    if (!beat)
        return { startMs: 0, endMs: durationMs };
    // The placing beat starts after the clip ends (input shorter than the script):
    // the payoff was truncated away, so the final caption should not appear.
    if (beat.startMs >= durationMs)
        return null;
    const window = {
        startMs: Math.max(0, Math.min(durationMs, beat.startMs)),
        endMs: Math.max(0, Math.min(durationMs, beat.endMs)),
    };
    // Window collapsed to zero length after clamping: don't fall back to full-clip
    // (that overlaps the step cards) — skip instead.
    return window.endMs > window.startMs ? window : null;
}
function imageInputArgs(paths, fps) {
    return paths.flatMap((path) => [
        '-loop', '1',
        '-framerate', String(fps),
        '-i', path,
    ]);
}
function seconds(ms) {
    return (ms / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
function labelRef(label) {
    return label.startsWith('[') && label.endsWith(']') ? label : `[${label}]`;
}
async function probeVideo(input) {
    const stdout = await runProcess('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,duration:format=duration',
        '-of', 'json',
        input,
    ]);
    const data = JSON.parse(stdout);
    const stream = data.streams?.[0];
    if (!stream?.width || !stream.height) {
        throw new Error(`Could not read video dimensions for ${input}`);
    }
    const durationSeconds = numberFromString(stream.duration) ?? numberFromString(data.format?.duration);
    return {
        width: stream.width,
        height: stream.height,
        durationMs: durationSeconds === undefined ? undefined : Math.round(durationSeconds * 1000),
    };
}
/**
 * Probes whether the input has an audio stream. Used so polishClip/
 * polishScript can preserve audio when it exists instead of unconditionally
 * stripping it with `-an`.
 */
async function probeHasAudio(input) {
    const stdout = await runProcess('ffprobe', [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=index',
        '-of', 'csv=p=0',
        input,
    ]).catch(() => '');
    return stdout.trim().length > 0;
}
/**
 * Builds the audio map + codec ffmpeg args. When the input has an audio
 * stream, it's preserved (re-encoded to AAC, since the rest of the pipeline
 * only ever re-encodes video). The audio is first padded with silence via
 * `-af apad` so it's never SHORTER than the `-frames:v`-limited video output
 * — without this, a source audio track shorter than the video would let
 * `-shortest` cut the video early too, truncating the final captioned
 * payoff. `-shortest` then trims the (now-padded) audio at the video's end,
 * so video duration always wins regardless of which track was originally
 * longer. When there's no audio, behavior is unchanged from before (`-an`).
 */
export function buildAudioArgs(hasAudio) {
    return hasAudio
        ? { mapArgs: ['-map', '0:a?'], codecArgs: ['-c:a', 'aac', '-af', 'apad', '-shortest'] }
        : { mapArgs: [], codecArgs: ['-an'] };
}
async function parseClicksJson(input) {
    const raw = typeof input === 'string'
        ? await readClicksSource(input)
        : input;
    if (Array.isArray(raw)) {
        return { clicks: raw };
    }
    return {
        clicks: raw.clicks ?? [],
        cursorPath: raw.cursorPath,
    };
}
async function readClicksSource(input) {
    const trimmed = input.trim();
    const json = trimmed.startsWith('{') || trimmed.startsWith('[')
        ? trimmed
        : await readFile(input, 'utf-8');
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed))
        return parsed;
    if (parsed && typeof parsed === 'object') {
        return parsed;
    }
    throw new Error('clicksJson must be a JSON array or an object with clicks/cursorPath');
}
function inferDurationMs(parsed) {
    const clickTimes = parsed.clicks.map((click) => click.tMs);
    const cursorTimes = parsed.cursorPath?.map((point) => point.tMs) ?? [];
    const latest = Math.max(0, ...clickTimes, ...cursorTimes);
    return latest + 3500;
}
function frameCount(durationMs, fps) {
    return Math.ceil((durationMs / 1000) * fps);
}
function numberFromString(value) {
    if (!value)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
async function ffmpegHasFilter(name) {
    const filters = await runProcess('ffmpeg', ['-hide_banner', '-filters']).catch(() => '');
    return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(filters);
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
async function runProcess(cmd, args) {
    return new Promise((resolveProcess, reject) => {
        const proc = spawn(cmd, args, { stdio: 'pipe' });
        const stdoutChunks = [];
        const stderrChunks = [];
        proc.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
        proc.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
        proc.on('error', reject);
        proc.on('close', (code) => {
            const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
            if (code === 0) {
                resolveProcess(stdout);
                return;
            }
            const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
            reject(new Error(`${cmd} exited with code ${code}${stderr ? `\n${stderr}` : ''}`));
        });
    });
}
function parseCliArgs(argv) {
    const values = new Map();
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith('--'))
            continue;
        const key = arg.slice(2);
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for --${key}`);
        }
        values.set(key, value);
        index += 1;
    }
    const input = values.get('input');
    const outPath = values.get('out') ?? values.get('outPath');
    const clicksJson = values.get('clicks-json') ?? values.get('clicksJson') ?? values.get('clicks');
    if (!input || !outPath || !clicksJson) {
        throw new Error('Usage: polish --input <video> --clicks-json <json-or-path> --caption <text> --out <mp4>');
    }
    const rawFps = values.get('fps');
    return {
        input,
        outPath,
        clicksJson,
        caption: values.get('caption'),
        fps: rawFps ? Number(rawFps) : undefined,
    };
}
function isDirectRun() {
    return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}
if (isDirectRun()) {
    polishClip(parseCliArgs(process.argv.slice(2))).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=polish.js.map