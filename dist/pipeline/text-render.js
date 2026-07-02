import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ensureTextRenderBinary } from '../native/compiler.js';
const CACHE_VERSION = 2;
const DEFAULT_OUT_W = 1920;
const DEFAULT_OUT_H = 1080;
const DEFAULT_STEP_X = 120;
const DEFAULT_STEP_Y = 92;
const DEFAULT_STEP_FONT_SIZE = 40;
const DEFAULT_CAPTION_FONT_SIZE = 48;
const DEFAULT_FONT_PATH = '/System/Library/Fonts/Helvetica.ttc';
const DEFAULT_FONT_INDEX = 1;
const DEFAULT_CACHE_DIR = join(tmpdir(), 'spectra-text-render');
/**
 * Canonical caption banner / step-chip / caption-text spec, measured from the
 * reference clip demo-candidates/polished/rally__personas-two-agents__MERGED_CAPTIONED.mp4
 * (1600x900). Ratios are canonical; pixel values scale with outW/outH.
 * Shared by text-render.ts (native CoreText), framing.ts, and annotations.ts
 * (ffmpeg) so all three renderers agree on one look.
 */
export const CAPTION_BANNER_SPEC = {
    /** Banner height as a fraction of frame height. */
    bannerHeightRatio: 0.12,
    /** Banner background color, #050709. */
    bannerBackground: { r: 5, g: 7, b: 9 },
    /** Banner background opacity. */
    bannerBackgroundAlpha: 0.92,
    /** Numbered chip side length as a fraction of frame height. */
    chipSideRatio: 0.06,
    /** Chip corner radius as a fraction of the chip side. */
    chipCornerRadiusRatio: 0.2,
    /** Chip fill color, #27AFE8. */
    chipColor: { r: 39, g: 175, b: 232 },
    /** Chip inset from the left edge as a fraction of frame width. */
    chipInsetXRatio: 0.0325,
    /** Caption text color, #F8FAFC. */
    captionTextColor: { r: 248, g: 250, b: 252 },
    /** Gap between the chip's right edge and the caption text as a fraction of frame width. */
    captionGapRatio: 0.015,
};
/**
 * Named style presets for the caption banner / step chip, selectable via the
 * optional `style` param on renderStepCardPng / renderCaptionPng (and
 * threaded down from polishClip / polishScript). `cool` is the default and is
 * IDENTICAL to CAPTION_BANNER_SPEC -- omitting `style` renders exactly what
 * today's fixed constants produce.
 */
export const BANNER_STYLE_PRESETS = {
    cool: {
        bannerBackground: { ...CAPTION_BANNER_SPEC.bannerBackground },
        bannerBackgroundAlpha: CAPTION_BANNER_SPEC.bannerBackgroundAlpha,
        bannerHeightRatio: CAPTION_BANNER_SPEC.bannerHeightRatio,
        chipColor: { ...CAPTION_BANNER_SPEC.chipColor },
        chipScale: 1.0,
    },
    warm: {
        bannerBackground: { r: 17, g: 15, b: 13 },
        bannerBackgroundAlpha: 0.92,
        bannerHeightRatio: 0.13,
        chipColor: { r: 240, g: 182, b: 94 }, // #F0B65E
        chipScale: 1.08,
    },
    bold: {
        bannerBackground: { r: 0, g: 0, b: 0 },
        bannerBackgroundAlpha: 0.96,
        bannerHeightRatio: 0.14,
        chipColor: { r: 129, g: 140, b: 248 }, // #818CF8
        chipScale: 1.18,
    },
};
const DEFAULT_BANNER_STYLE_NAME = 'cool';
/** Resolves a style name or object to a concrete CaptionBannerStyle. Absent style => 'cool' (today's behavior). */
export function resolveBannerStyle(style) {
    if (!style)
        return BANNER_STYLE_PRESETS[DEFAULT_BANNER_STYLE_NAME];
    if (typeof style === 'string') {
        const preset = BANNER_STYLE_PRESETS[style];
        if (!preset)
            throw new Error(`Unknown caption banner style: ${style}`);
        return preset;
    }
    return style;
}
let availabilityPromise;
let availabilityOverride;
export async function textRendererAvailability() {
    if (availabilityOverride)
        return availabilityOverride;
    availabilityPromise ??= probeTextRenderer();
    return availabilityPromise;
}
export function setTextRendererAvailabilityForTests(availability) {
    availabilityOverride = availability;
    availabilityPromise = undefined;
}
export async function renderStepCardPng(options) {
    const stepText = options.stepText.trim();
    if (!stepText)
        return undefined;
    const outW = positiveInteger(options.outW ?? DEFAULT_OUT_W, 'outW');
    const outH = positiveInteger(options.outH ?? DEFAULT_OUT_H, 'outH');
    const requestBase = {
        version: CACHE_VERSION,
        kind: 'step-card',
        outW,
        outH,
        x: nonNegativeInteger(options.x ?? DEFAULT_STEP_X, 'x'),
        y: nonNegativeInteger(options.y ?? DEFAULT_STEP_Y, 'y'),
        fontSize: positiveInteger(options.fontSize ?? DEFAULT_STEP_FONT_SIZE, 'fontSize'),
        fontPath: DEFAULT_FONT_PATH,
        fontIndex: DEFAULT_FONT_INDEX,
        stepText,
        stepLabel: options.stepLabel?.trim() || undefined,
        style: resolveBannerStyle(options.style),
    };
    const outPath = cachedPath(options.cacheDir, requestBase);
    const request = { ...requestBase, outPath };
    return renderCachedPng(request, outPath);
}
export async function renderCaptionPng(options) {
    const text = options.text.trim();
    if (!text)
        return undefined;
    const requestBase = {
        version: CACHE_VERSION,
        kind: 'caption',
        outW: positiveInteger(options.outW ?? DEFAULT_OUT_W, 'outW'),
        outH: positiveInteger(options.outH ?? DEFAULT_OUT_H, 'outH'),
        fontSize: positiveInteger(options.fontSize ?? DEFAULT_CAPTION_FONT_SIZE, 'fontSize'),
        fontPath: DEFAULT_FONT_PATH,
        fontIndex: DEFAULT_FONT_INDEX,
        text,
        style: resolveBannerStyle(options.style),
    };
    const outPath = cachedPath(options.cacheDir, requestBase);
    const request = { ...requestBase, outPath };
    return renderCachedPng(request, outPath);
}
export async function renderFrameChromePng(options) {
    const requestBase = {
        version: CACHE_VERSION,
        outW: positiveInteger(options.outW, 'outW'),
        outH: positiveInteger(options.outH, 'outH'),
        contentW: positiveInteger(options.contentW, 'contentW'),
        contentH: positiveInteger(options.contentH, 'contentH'),
        contentX: nonNegativeInteger(options.contentX, 'contentX'),
        contentY: nonNegativeInteger(options.contentY, 'contentY'),
        cornerRadius: positiveInteger(options.cornerRadius, 'cornerRadius'),
    };
    const backgroundBase = { ...requestBase, kind: 'frame-background' };
    const maskBase = { ...requestBase, kind: 'frame-mask' };
    const backgroundPath = cachedPath(options.cacheDir, backgroundBase);
    const maskPath = cachedPath(options.cacheDir, maskBase);
    const background = await renderCachedPng({ ...backgroundBase, outPath: backgroundPath }, backgroundPath);
    const mask = await renderCachedPng({ ...maskBase, outPath: maskPath }, maskPath);
    return background && mask ? { backgroundPath, maskPath } : undefined;
}
async function renderCachedPng(request, outPath) {
    const availability = await textRendererAvailability();
    if (!availability.available)
        return undefined;
    if (await exists(outPath))
        return outPath;
    await mkdir(dirname(outPath), { recursive: true });
    const rendered = await runCoreTextRenderer([], JSON.stringify(request));
    return rendered.ok ? outPath : undefined;
}
/**
 * Probes the native CoreText renderer (native/swift/text-render/TextRender.swift,
 * compiled/resolved via src/native/compiler.ts's ensureTextRenderBinary()).
 * This replaced the python3/Pillow tier that used to be REQUIRED here --
 * CoreText is native, ships no external runtime dependency, and needs no
 * window server (headless CGBitmapContext rendering). When the helper can't
 * be resolved or fails its font-load self-check, callers fall back to the
 * ffmpeg drawbox/bitmap-font tier that already lives in annotations.ts --
 * this function returning `available: false` is what triggers that fallback.
 */
async function probeTextRenderer() {
    const result = await runCoreTextRenderer(['--probe'], '');
    return result.ok
        ? { available: true }
        : { available: false, reason: result.stderr || 'native CoreText text renderer is unavailable' };
}
async function runCoreTextRenderer(args, stdin) {
    let binaryPath;
    try {
        binaryPath = ensureTextRenderBinary();
    }
    catch (error) {
        return { ok: false, stderr: error instanceof Error ? error.message : String(error) };
    }
    return new Promise((resolve) => {
        const proc = spawn(binaryPath, args, { stdio: 'pipe' });
        const stderrChunks = [];
        let settled = false;
        const settle = (result) => {
            if (settled)
                return;
            settled = true;
            resolve(result);
        };
        proc.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
        proc.on('error', (error) => settle({ ok: false, stderr: error.message }));
        proc.on('close', (code) => {
            if (code !== 0) {
                settle({ ok: false, stderr: Buffer.concat(stderrChunks).toString('utf-8').trim() });
                return;
            }
            settle({ ok: true });
        });
        proc.stdin?.end(stdin);
    });
}
function cachedPath(cacheDir, request) {
    const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 32);
    return join(cacheDir ?? DEFAULT_CACHE_DIR, `${request.kind}-${hash}.png`);
}
async function exists(path) {
    return access(path).then(() => true, () => false);
}
function positiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}
function nonNegativeInteger(value, name) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative integer`);
    }
    return value;
}
//# sourceMappingURL=text-render.js.map