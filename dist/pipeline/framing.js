import { CAPTION_BANNER_SPEC } from './text-render.js';
/**
 * Single source of truth for window-chrome geometry, shared by the per-frame
 * `framingFilter` graph and the one-time `frameChromeRenderPlan` precompute
 * so both agree on identical placement/sizing.
 */
export function frameLayout(outW, outH, contentScale = DEFAULT_CONTENT_SCALE, cornerRadius = DEFAULT_CORNER_RADIUS) {
    if (!Number.isFinite(contentScale) || contentScale <= 0 || contentScale > 1) {
        throw new Error('contentScale must be a finite number in the range (0, 1]');
    }
    const contentW = even(Math.round(outW * contentScale));
    const contentH = even(Math.round(outH * contentScale));
    const contentX = Math.round((outW - contentW) / 2);
    const contentY = Math.round((outH - contentH) / 2) - Math.round(outH * 0.02);
    const radius = Math.min(positiveInteger(cornerRadius, 'cornerRadius'), Math.floor(Math.min(contentW, contentH) / 2));
    const shadowPad = Math.max(18, Math.ceil(24 * 3));
    return { contentW, contentH, contentX, contentY, radius, shadowPad };
}
const DEFAULT_OUT_W = 1920;
const DEFAULT_OUT_H = 1080;
const DEFAULT_FPS = 60;
const DEFAULT_CONTENT_SCALE = 0.88;
const DEFAULT_CORNER_RADIUS = 20;
const DEFAULT_FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';
export function bitmapTextLayer(label, text, pixel, fps, color = 'white@1') {
    const normalizedText = normalizeBitmapText(text);
    const metrics = bitmapMetrics(normalizedText, positiveInteger(pixel, 'pixel'));
    const rects = bitmapTextRects(normalizedText, pixel);
    const textBoxes = rects.map((rect) => `drawbox=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}:color=${color}:t=fill:replace=1`);
    return {
        filter: `color=c=white@0:s=${metrics.width}x${metrics.height}:r=${positiveInteger(fps, 'fps')},format=rgba${textBoxes.length > 0 ? `,${textBoxes.join(',')}` : ''}${labelRef(label)}`,
        width: metrics.width,
        height: metrics.height,
        normalizedText,
    };
}
export function framingFilter(opts = {}) {
    const outW = positiveInteger(opts.outW ?? DEFAULT_OUT_W, 'outW');
    const outH = positiveInteger(opts.outH ?? DEFAULT_OUT_H, 'outH');
    const fps = positiveInteger(opts.fps ?? DEFAULT_FPS, 'fps');
    const layout = frameLayout(outW, outH, opts.contentScale ?? DEFAULT_CONTENT_SCALE, opts.cornerRadius ?? DEFAULT_CORNER_RADIUS);
    const { contentW, contentH, contentX, contentY, radius, shadowPad } = layout;
    const shadowW = contentW + shadowPad * 2;
    const shadowH = contentH + shadowPad * 2;
    const inRef = labelRef(opts.inputLabel ?? '0:v');
    const outRef = labelRef(opts.outputLabel ?? 'v');
    const caption = opts.caption?.trim();
    const fontSize = positiveInteger(opts.fontSize ?? 46, 'fontSize');
    const bannerH = Math.round(outH * CAPTION_BANNER_SPEC.bannerHeightRatio);
    const finalFilter = caption && (opts.captionMode ?? 'drawtext') === 'drawtext'
        ? `[framed]${captionBannerPrefix(opts.captionPill ?? true, bannerH)}drawtext=fontfile=${escapeFilterValue(opts.fontFile ?? DEFAULT_FONT)}:text='${escapeDrawtext(caption)}':fontcolor=${hexColor(CAPTION_BANNER_SPEC.captionTextColor)}:fontsize=${fontSize}:x=(w-text_w)/2:y=h-${(bannerH / 2).toFixed(2)}-(text_h/2),format=yuv420p${outRef}`
        : bitmapCaptionGraph('framed', caption, outW, outH, fps, fontSize, opts.captionPill ?? true, outRef);
    const scaledFilter = `${inRef}scale=${contentW}:${contentH}:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=${contentW}:${contentH}:(ow-iw)/2:(oh-ih)/2:color=0x00000000[scaled]`;
    // The rounded-rect mask is purely a function of static geometry (no
    // dependency on the source frame), so it can be rendered ONCE and reused
    // as a looped raw-video input instead of re-evaluated via `geq` on every
    // output frame -- profiling showed that per-frame `geq` evaluation is
    // ~87% of total render time. `chromeAssets` carries the ffmpeg input
    // index of that precomputed mask; everything downstream of `[mask]`
    // (the alphamerge + the gradient/shadow composite + the final overlay)
    // is untouched, so window-chrome geometry and shading are unaffected.
    //
    // The gradient + 3x blurred-shadow background is deliberately NOT
    // precomputed even though it's also static: measured pixel comparisons
    // (tests/pipeline/framing.test.ts) showed ffmpeg's pixel-format
    // auto-negotiation diverges by a few dB once that composite is persisted
    // to an image and reloaded as a separate input, because that subgraph's
    // RGBA alpha-blending is sensitive to the surrounding graph shape in a
    // way the pure-binary mask isn't. Recomputing it per frame is cheap next
    // to `geq` (gblur is a small, SIMD-friendly filter) and keeps output
    // byte-for-byte identical to the pre-optimization renderer.
    const maskFilter = opts.chromeAssets
        ? `${labelRef(`${opts.chromeAssets.maskIndex}:v`)}format=gray[mask]`
        : `color=c=white:s=${contentW}x${contentH}:r=${fps},format=gray,geq=lum='${roundedRectMaskExpression(contentW, contentH, radius)}'[mask]`;
    return [
        scaledFilter,
        maskFilter,
        '[mask]split=4[maskWindow][maskA][maskB][maskC]',
        '[scaled][maskWindow]alphamerge[window]',
        shadowLayer('A', shadowW, shadowH, shadowPad, fps, 0.20, 24),
        shadowLayer('B', shadowW, shadowH, shadowPad, fps, 0.26, 18),
        shadowLayer('C', shadowW, shadowH, shadowPad, fps, 0.14, 8),
        `gradients=s=${outW}x${outH}:r=${fps}:c0=0x12141a:c1=0x20242e:nb_colors=2:x0=0:y0=0:x1=${outW}:y1=${outH}:type=linear:speed=0[bg]`,
        `[bg][shadowA]overlay=x=${contentX - shadowPad}:y=${contentY - shadowPad + 14}:shortest=1[shadowedA]`,
        `[shadowedA][shadowB]overlay=x=${contentX - shadowPad}:y=${contentY - shadowPad + 10}:shortest=1[shadowedB]`,
        `[shadowedB][shadowC]overlay=x=${contentX - shadowPad}:y=${contentY - shadowPad + 24}:shortest=1[shadowedC]`,
        `[shadowedC][window]overlay=x=${contentX}:y=${contentY}:shortest=1[framed]`,
        finalFilter,
    ].join(';');
}
/**
 * Builds a one-shot ffmpeg filter graph that renders the rounded-rect mask
 * EXACTLY once, using the identical `geq` math `framingFilter`'s fallback
 * path would otherwise re-evaluate every frame. The mask is a pure boolean
 * (0 or 255) cutout with no blending, so rendering it once and reloading it
 * as a raw-video input is bit-identical to recomputing it per frame -- it
 * just avoids paying for that recomputation ~N times. Pair with
 * `FrameChromeAssets.maskIndex` in `framingFilter`.
 */
export function frameChromeRenderPlan(opts = {}) {
    const outW = positiveInteger(opts.outW ?? DEFAULT_OUT_W, 'outW');
    const outH = positiveInteger(opts.outH ?? DEFAULT_OUT_H, 'outH');
    const layout = frameLayout(outW, outH, opts.contentScale ?? DEFAULT_CONTENT_SCALE, opts.cornerRadius ?? DEFAULT_CORNER_RADIUS);
    const { contentW, contentH, radius } = layout;
    const maskExpr = roundedRectMaskExpression(contentW, contentH, radius);
    const filterComplex = `color=c=white:s=${contentW}x${contentH}:r=1,format=gray,geq=lum='${maskExpr}'[maskOut]`;
    return { layout, filterComplex, maskLabel: '[maskOut]' };
}
function bitmapCaptionGraph(inputLabel, caption, outW, outH, fps, fontSize, pill, outRef) {
    const inputRef = labelRef(inputLabel);
    if (!caption)
        return `${inputRef}format=yuv420p${outRef}`;
    const text = normalizeBitmapText(caption);
    let pixel = Math.max(2, Math.round(fontSize / 8));
    let metrics = bitmapMetrics(text, pixel);
    while (metrics.width > outW * 0.86 && pixel > 2) {
        pixel -= 1;
        metrics = bitmapMetrics(text, pixel);
    }
    const bannerH = Math.round(outH * CAPTION_BANNER_SPEC.bannerHeightRatio);
    const bannerY = outH - bannerH;
    const textX = Math.round((outW - metrics.width) / 2);
    const textY = Math.round(bannerY + (bannerH - metrics.height) / 2);
    const rects = bitmapTextRects(text, pixel);
    const captionTextColor = hexColor(CAPTION_BANNER_SPEC.captionTextColor);
    const textBoxes = rects.map((rect) => `drawbox=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}:color=${captionTextColor}@1:t=fill:replace=1`);
    const filters = [
        `color=c=white@0:s=${metrics.width}x${metrics.height}:r=${fps},format=rgba${textBoxes.length > 0 ? `,${textBoxes.join(',')}` : ''}[captionText]`,
    ];
    if (pill) {
        const bannerColor = hexColor(CAPTION_BANNER_SPEC.bannerBackground);
        filters.unshift(`color=c=${bannerColor}@${CAPTION_BANNER_SPEC.bannerBackgroundAlpha}:s=${outW}x${bannerH}:r=${fps},format=rgba[captionPill]`);
        filters.push(`${inputRef}[captionPill]overlay=x=0:y=${bannerY}:shortest=1[captionBase]`);
        filters.push('[captionBase][captionText]overlay=x=' + textX + ':y=' + textY + `:shortest=1,format=yuv420p${outRef}`);
    }
    else {
        filters.push(`${inputRef}[captionText]overlay=x=${textX}:y=${textY}:shortest=1,format=yuv420p${outRef}`);
    }
    return filters.join(';');
}
function bitmapTextRects(text, pixel) {
    const rects = [];
    let cursorX = 0;
    for (const char of text) {
        const glyph = BITMAP_FONT[char] ?? BITMAP_FONT[' '];
        if (char === ' ') {
            cursorX += pixel * 4;
            continue;
        }
        for (let rowIndex = 0; rowIndex < glyph.length; rowIndex += 1) {
            const row = glyph[rowIndex];
            let col = 0;
            while (col < row.length) {
                if (row[col] !== '1') {
                    col += 1;
                    continue;
                }
                const startCol = col;
                while (col < row.length && row[col] === '1')
                    col += 1;
                rects.push({
                    x: cursorX + startCol * pixel,
                    y: rowIndex * pixel,
                    w: (col - startCol) * pixel,
                    h: pixel,
                });
            }
        }
        cursorX += pixel * (glyph[0].length + 1);
    }
    return rects;
}
function bitmapMetrics(text, pixel) {
    let width = 0;
    for (const char of text) {
        const glyph = BITMAP_FONT[char] ?? BITMAP_FONT[' '];
        width += char === ' ' ? pixel * 4 : pixel * (glyph[0].length + 1);
    }
    return {
        width: Math.max(pixel, width - pixel),
        height: pixel * 7,
    };
}
function normalizeBitmapText(caption) {
    return caption
        .toUpperCase()
        .replace(/[–—]/g, '-')
        .replace(/[^A-Z0-9 .,!?\-+]/g, ' ');
}
function shadowLayer(name, width, height, pad, fps, alpha, sigma) {
    const scale = 4;
    const smallContentW = Math.max(2, even(Math.round((width - pad * 2) / scale)));
    const smallContentH = Math.max(2, even(Math.round((height - pad * 2) / scale)));
    const smallPad = Math.max(2, Math.round(pad / scale));
    const smallW = smallContentW + smallPad * 2;
    const smallH = smallContentH + smallPad * 2;
    const smallSigma = Math.max(1, sigma / scale);
    return [
        `[mask${name}]scale=${smallContentW}:${smallContentH}:flags=bilinear,pad=${smallW}:${smallH}:${smallPad}:${smallPad}:color=black[mask${name}Padded]`,
        `color=c=black:s=${smallW}x${smallH}:r=${fps},format=rgba[shadowColor${name}]`,
        `[shadowColor${name}][mask${name}Padded]alphamerge,colorchannelmixer=aa=${alpha.toFixed(2)},gblur=sigma=${smallSigma},scale=${width}:${height}:flags=bicubic[shadow${name}]`,
    ].join(';');
}
function roundedRectMaskExpression(width, height, radius) {
    const right = width - radius - 1;
    const bottom = height - radius - 1;
    const radiusSquared = radius * radius;
    const centerX = `${gte('X', radius)}*${lte('X', right)}`;
    const centerY = `${gte('Y', radius)}*${lte('Y', bottom)}`;
    const topLeft = `${lt('X', radius)}*${lt('Y', radius)}*${lte(`pow(X-${radius}\\,2)+pow(Y-${radius}\\,2)`, radiusSquared)}`;
    const topRight = `${gt('X', right)}*${lt('Y', radius)}*${lte(`pow(X-${right}\\,2)+pow(Y-${radius}\\,2)`, radiusSquared)}`;
    const bottomLeft = `${lt('X', radius)}*${gt('Y', bottom)}*${lte(`pow(X-${radius}\\,2)+pow(Y-${bottom}\\,2)`, radiusSquared)}`;
    const bottomRight = `${gt('X', right)}*${gt('Y', bottom)}*${lte(`pow(X-${right}\\,2)+pow(Y-${bottom}\\,2)`, radiusSquared)}`;
    return `255*min(1\\,${centerX}+${centerY}+${topLeft}+${topRight}+${bottomLeft}+${bottomRight})`;
}
function captionBannerPrefix(enabled, bannerH) {
    if (!enabled)
        return '';
    const bannerColor = hexColor(CAPTION_BANNER_SPEC.bannerBackground);
    return `drawbox=x=0:y=h-${bannerH}:w=iw:h=${bannerH}:color=${bannerColor}@${CAPTION_BANNER_SPEC.bannerBackgroundAlpha}:t=fill,`;
}
export function hexColor(rgb) {
    const channel = (value) => value.toString(16).padStart(2, '0');
    return `0x${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}
function labelRef(label) {
    return label.startsWith('[') && label.endsWith(']') ? label : `[${label}]`;
}
function positiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}
function even(value) {
    return value % 2 === 0 ? value : value + 1;
}
function gte(left, right) {
    return `gte(${left}\\,${right})`;
}
function gt(left, right) {
    return `gt(${left}\\,${right})`;
}
function lte(left, right) {
    return `lte(${left}\\,${right})`;
}
function lt(left, right) {
    return `lt(${left}\\,${right})`;
}
function escapeDrawtext(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/:/g, '\\:')
        .replace(/,/g, '\\,')
        .replace(/%/g, '\\%');
}
function escapeFilterValue(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:')
        .replace(/,/g, '\\,');
}
const BITMAP_FONT = {
    ' ': [
        '000',
        '000',
        '000',
        '000',
        '000',
        '000',
        '000',
    ],
    '!': [
        '1',
        '1',
        '1',
        '1',
        '1',
        '0',
        '1',
    ],
    ',': [
        '00',
        '00',
        '00',
        '00',
        '00',
        '01',
        '10',
    ],
    '+': [
        '00000',
        '00100',
        '00100',
        '11111',
        '00100',
        '00100',
        '00000',
    ],
    '-': [
        '00000',
        '00000',
        '00000',
        '11111',
        '00000',
        '00000',
        '00000',
    ],
    '.': [
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '1',
    ],
    '?': [
        '11110',
        '00001',
        '00001',
        '00110',
        '00100',
        '00000',
        '00100',
    ],
    '0': [
        '01110',
        '10001',
        '10011',
        '10101',
        '11001',
        '10001',
        '01110',
    ],
    '1': [
        '00100',
        '01100',
        '00100',
        '00100',
        '00100',
        '00100',
        '01110',
    ],
    '2': [
        '01110',
        '10001',
        '00001',
        '00010',
        '00100',
        '01000',
        '11111',
    ],
    '3': [
        '11110',
        '00001',
        '00001',
        '01110',
        '00001',
        '00001',
        '11110',
    ],
    '4': [
        '00010',
        '00110',
        '01010',
        '10010',
        '11111',
        '00010',
        '00010',
    ],
    '5': [
        '11111',
        '10000',
        '10000',
        '11110',
        '00001',
        '00001',
        '11110',
    ],
    '6': [
        '01110',
        '10000',
        '10000',
        '11110',
        '10001',
        '10001',
        '01110',
    ],
    '7': [
        '11111',
        '00001',
        '00010',
        '00100',
        '01000',
        '01000',
        '01000',
    ],
    '8': [
        '01110',
        '10001',
        '10001',
        '01110',
        '10001',
        '10001',
        '01110',
    ],
    '9': [
        '01110',
        '10001',
        '10001',
        '01111',
        '00001',
        '00001',
        '01110',
    ],
    A: [
        '01110',
        '10001',
        '10001',
        '11111',
        '10001',
        '10001',
        '10001',
    ],
    B: [
        '11110',
        '10001',
        '10001',
        '11110',
        '10001',
        '10001',
        '11110',
    ],
    C: [
        '01111',
        '10000',
        '10000',
        '10000',
        '10000',
        '10000',
        '01111',
    ],
    D: [
        '11110',
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '11110',
    ],
    E: [
        '11111',
        '10000',
        '10000',
        '11110',
        '10000',
        '10000',
        '11111',
    ],
    F: [
        '11111',
        '10000',
        '10000',
        '11110',
        '10000',
        '10000',
        '10000',
    ],
    G: [
        '01111',
        '10000',
        '10000',
        '10011',
        '10001',
        '10001',
        '01111',
    ],
    H: [
        '10001',
        '10001',
        '10001',
        '11111',
        '10001',
        '10001',
        '10001',
    ],
    I: [
        '11111',
        '00100',
        '00100',
        '00100',
        '00100',
        '00100',
        '11111',
    ],
    J: [
        '00111',
        '00010',
        '00010',
        '00010',
        '00010',
        '10010',
        '01100',
    ],
    K: [
        '10001',
        '10010',
        '10100',
        '11000',
        '10100',
        '10010',
        '10001',
    ],
    L: [
        '10000',
        '10000',
        '10000',
        '10000',
        '10000',
        '10000',
        '11111',
    ],
    M: [
        '10001',
        '11011',
        '10101',
        '10101',
        '10001',
        '10001',
        '10001',
    ],
    N: [
        '10001',
        '11001',
        '10101',
        '10011',
        '10001',
        '10001',
        '10001',
    ],
    O: [
        '01110',
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '01110',
    ],
    P: [
        '11110',
        '10001',
        '10001',
        '11110',
        '10000',
        '10000',
        '10000',
    ],
    Q: [
        '01110',
        '10001',
        '10001',
        '10001',
        '10101',
        '10010',
        '01101',
    ],
    R: [
        '11110',
        '10001',
        '10001',
        '11110',
        '10100',
        '10010',
        '10001',
    ],
    S: [
        '01111',
        '10000',
        '10000',
        '01110',
        '00001',
        '00001',
        '11110',
    ],
    T: [
        '11111',
        '00100',
        '00100',
        '00100',
        '00100',
        '00100',
        '00100',
    ],
    U: [
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '01110',
    ],
    V: [
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '01010',
        '00100',
    ],
    W: [
        '10001',
        '10001',
        '10001',
        '10101',
        '10101',
        '10101',
        '01010',
    ],
    X: [
        '10001',
        '10001',
        '01010',
        '00100',
        '01010',
        '10001',
        '10001',
    ],
    Y: [
        '10001',
        '10001',
        '01010',
        '00100',
        '00100',
        '00100',
        '00100',
    ],
    Z: [
        '11111',
        '00001',
        '00010',
        '00100',
        '01000',
        '10000',
        '11111',
    ],
};
//# sourceMappingURL=framing.js.map