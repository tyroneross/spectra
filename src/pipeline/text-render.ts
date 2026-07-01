import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface TextRendererAvailability {
  available: boolean
  reason?: string
}

export interface StepCardPngOptions {
  stepText: string
  stepLabel?: string
  outW?: number
  outH?: number
  x?: number
  y?: number
  fontSize?: number
  cacheDir?: string
  style?: CaptionBannerStyle | CaptionBannerStyleName
}

export interface CaptionPngOptions {
  text: string
  outW?: number
  outH?: number
  fontSize?: number
  cacheDir?: string
  style?: CaptionBannerStyle | CaptionBannerStyleName
}

export interface FrameChromePngOptions {
  outW: number
  outH: number
  contentW: number
  contentH: number
  contentX: number
  contentY: number
  cornerRadius: number
  cacheDir?: string
}

export interface FrameChromePngResult {
  backgroundPath: string
  maskPath: string
}

type RenderRequest =
  | {
    version: number
    kind: 'step-card'
    outPath: string
    outW: number
    outH: number
    x: number
    y: number
    fontSize: number
    fontPath: string
    fontIndex: number
    stepText: string
    stepLabel?: string
    style: CaptionBannerStyle
  }
  | {
    version: number
    kind: 'caption'
    outPath: string
    outW: number
    outH: number
    fontSize: number
    fontPath: string
    fontIndex: number
    text: string
    style: CaptionBannerStyle
  }
  | {
    version: number
    kind: 'frame-background' | 'frame-mask'
    outPath: string
    outW: number
    outH: number
    contentW: number
    contentH: number
    contentX: number
    contentY: number
    cornerRadius: number
  }

const CACHE_VERSION = 2
const DEFAULT_OUT_W = 1920
const DEFAULT_OUT_H = 1080
const DEFAULT_STEP_X = 120
const DEFAULT_STEP_Y = 92
const DEFAULT_STEP_FONT_SIZE = 40
const DEFAULT_CAPTION_FONT_SIZE = 48
const DEFAULT_FONT_PATH = '/System/Library/Fonts/Helvetica.ttc'
const DEFAULT_FONT_INDEX = 1
const DEFAULT_CACHE_DIR = join(tmpdir(), 'spectra-text-render')

/**
 * Canonical caption banner / step-chip / caption-text spec, measured from the
 * reference clip demo-candidates/polished/rally__personas-two-agents__MERGED_CAPTIONED.mp4
 * (1600x900). Ratios are canonical; pixel values scale with outW/outH.
 * Shared by text-render.ts (Pillow), framing.ts, and annotations.ts (ffmpeg) so
 * all three renderers agree on one look.
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
} as const

/**
 * Overridable subset of CAPTION_BANNER_SPEC for a named look. Everything not
 * covered here (corner radius ratio, inset/gap ratios, caption text color)
 * stays fixed across presets so the layout math doesn't drift, only the
 * banner/chip color and relative sizing do. `chipScale` multiplies
 * CAPTION_BANNER_SPEC.chipSideRatio (bigger chip on louder presets).
 */
export interface CaptionBannerStyle {
  bannerBackground: { r: number; g: number; b: number }
  bannerBackgroundAlpha: number
  bannerHeightRatio: number
  chipColor: { r: number; g: number; b: number }
  chipScale: number
}

export type CaptionBannerStyleName = 'cool' | 'warm' | 'bold'

/**
 * Named style presets for the caption banner / step chip, selectable via the
 * optional `style` param on renderStepCardPng / renderCaptionPng (and
 * threaded down from polishClip / polishScript). `cool` is the default and is
 * IDENTICAL to CAPTION_BANNER_SPEC -- omitting `style` renders exactly what
 * today's fixed constants produce.
 */
export const BANNER_STYLE_PRESETS: Record<CaptionBannerStyleName, CaptionBannerStyle> = {
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
}

const DEFAULT_BANNER_STYLE_NAME: CaptionBannerStyleName = 'cool'

/** Resolves a style name or object to a concrete CaptionBannerStyle. Absent style => 'cool' (today's behavior). */
export function resolveBannerStyle(style: CaptionBannerStyle | CaptionBannerStyleName | undefined): CaptionBannerStyle {
  if (!style) return BANNER_STYLE_PRESETS[DEFAULT_BANNER_STYLE_NAME]
  if (typeof style === 'string') {
    const preset = BANNER_STYLE_PRESETS[style]
    if (!preset) throw new Error(`Unknown caption banner style: ${style}`)
    return preset
  }
  return style
}

let availabilityPromise: Promise<TextRendererAvailability> | undefined
let availabilityOverride: TextRendererAvailability | undefined

export async function textRendererAvailability(): Promise<TextRendererAvailability> {
  if (availabilityOverride) return availabilityOverride
  availabilityPromise ??= probeTextRenderer()
  return availabilityPromise
}

export function setTextRendererAvailabilityForTests(availability: TextRendererAvailability | undefined): void {
  availabilityOverride = availability
  availabilityPromise = undefined
}

export async function renderStepCardPng(options: StepCardPngOptions): Promise<string | undefined> {
  const stepText = options.stepText.trim()
  if (!stepText) return undefined

  const outW = positiveInteger(options.outW ?? DEFAULT_OUT_W, 'outW')
  const outH = positiveInteger(options.outH ?? DEFAULT_OUT_H, 'outH')
  const requestBase = {
    version: CACHE_VERSION,
    kind: 'step-card' as const,
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
  }
  const outPath = cachedPath(options.cacheDir, requestBase)
  const request: RenderRequest = { ...requestBase, outPath }
  return renderCachedPng(request, outPath)
}

export async function renderCaptionPng(options: CaptionPngOptions): Promise<string | undefined> {
  const text = options.text.trim()
  if (!text) return undefined

  const requestBase = {
    version: CACHE_VERSION,
    kind: 'caption' as const,
    outW: positiveInteger(options.outW ?? DEFAULT_OUT_W, 'outW'),
    outH: positiveInteger(options.outH ?? DEFAULT_OUT_H, 'outH'),
    fontSize: positiveInteger(options.fontSize ?? DEFAULT_CAPTION_FONT_SIZE, 'fontSize'),
    fontPath: DEFAULT_FONT_PATH,
    fontIndex: DEFAULT_FONT_INDEX,
    text,
    style: resolveBannerStyle(options.style),
  }
  const outPath = cachedPath(options.cacheDir, requestBase)
  const request: RenderRequest = { ...requestBase, outPath }
  return renderCachedPng(request, outPath)
}

export async function renderFrameChromePng(options: FrameChromePngOptions): Promise<FrameChromePngResult | undefined> {
  const requestBase = {
    version: CACHE_VERSION,
    outW: positiveInteger(options.outW, 'outW'),
    outH: positiveInteger(options.outH, 'outH'),
    contentW: positiveInteger(options.contentW, 'contentW'),
    contentH: positiveInteger(options.contentH, 'contentH'),
    contentX: nonNegativeInteger(options.contentX, 'contentX'),
    contentY: nonNegativeInteger(options.contentY, 'contentY'),
    cornerRadius: positiveInteger(options.cornerRadius, 'cornerRadius'),
  }
  const backgroundBase = { ...requestBase, kind: 'frame-background' as const }
  const maskBase = { ...requestBase, kind: 'frame-mask' as const }
  const backgroundPath = cachedPath(options.cacheDir, backgroundBase)
  const maskPath = cachedPath(options.cacheDir, maskBase)
  const background = await renderCachedPng({ ...backgroundBase, outPath: backgroundPath }, backgroundPath)
  const mask = await renderCachedPng({ ...maskBase, outPath: maskPath }, maskPath)
  return background && mask ? { backgroundPath, maskPath } : undefined
}

async function renderCachedPng(request: RenderRequest, outPath: string): Promise<string | undefined> {
  const availability = await textRendererAvailability()
  if (!availability.available) return undefined

  if (await exists(outPath)) return outPath

  await mkdir(dirname(outPath), { recursive: true })
  const rendered = await runPython(PYTHON_RENDER_SCRIPT, JSON.stringify(request))
  return rendered.ok ? outPath : undefined
}

async function probeTextRenderer(): Promise<TextRendererAvailability> {
  const result = await runPython(PYTHON_PROBE_SCRIPT, '')
  return result.ok
    ? { available: true }
    : { available: false, reason: result.stderr || 'python3, Pillow, or Helvetica.ttc is unavailable' }
}

async function runPython(script: string, stdin: string): Promise<{ ok: boolean; stderr?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-c', script], { stdio: 'pipe' })
    const stderrChunks: Buffer[] = []
    let settled = false
    const settle = (result: { ok: boolean; stderr?: string }): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)))
    proc.on('error', (error) => settle({ ok: false, stderr: error.message }))
    proc.on('close', (code) => {
      if (code !== 0) {
        settle({ ok: false, stderr: Buffer.concat(stderrChunks).toString('utf-8').trim() })
        return
      }
      settle({ ok: true })
    })
    proc.stdin?.end(stdin)
  })
}

function cachedPath(cacheDir: string | undefined, request: Omit<RenderRequest, 'outPath'>): string {
  const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 32)
  return join(cacheDir ?? DEFAULT_CACHE_DIR, `${request.kind}-${hash}.png`)
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return value
}

const PYTHON_PROBE_SCRIPT = String.raw`
from PIL import Image, ImageDraw, ImageFont
ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 40, index=1)
`

const PYTHON_RENDER_SCRIPT = String.raw`
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont

# Parsed up front (rather than at the bottom of the script) so the
# style-derived banner/chip constants below can read request['style'] --
# style is per-request (varies by caption-banner preset), unlike the other
# constants here which used to be fixed at script-generation time.
request = json.load(sys.stdin)

def load_font(path, size, index):
    return ImageFont.truetype(path, int(size), index=int(index))

def text_size(draw, text, font):
    box = draw.textbbox((0, 0), text, font=font)
    return box, box[2] - box[0], box[3] - box[1]

def fit_font(draw, path, size, index, text, max_width, min_size):
    current = int(size)
    while current > int(min_size):
        font = load_font(path, current, index)
        _, width, _ = text_size(draw, text, font)
        if width <= max_width:
            return font
        current -= 2
    return load_font(path, max(int(min_size), current), index)

def draw_centered_text(draw, x, center_y, text, font, fill):
    box, _, height = text_size(draw, text, font)
    y = center_y - (height / 2) - box[1]
    draw.text((x, y), text, font=font, fill=fill)

# Style-overridable (per BANNER_STYLE_PRESETS in text-render.ts); falls back
# to the canonical 'cool' CAPTION_BANNER_SPEC values when style is absent
# (frame-background/frame-mask requests, or any caller that skips it).
_style = request.get('style') or {}
_banner_bg = _style.get('bannerBackground', {'r': ${CAPTION_BANNER_SPEC.bannerBackground.r}, 'g': ${CAPTION_BANNER_SPEC.bannerBackground.g}, 'b': ${CAPTION_BANNER_SPEC.bannerBackground.b}})
_chip_color = _style.get('chipColor', {'r': ${CAPTION_BANNER_SPEC.chipColor.r}, 'g': ${CAPTION_BANNER_SPEC.chipColor.g}, 'b': ${CAPTION_BANNER_SPEC.chipColor.b}})

BANNER_HEIGHT_RATIO = float(_style.get('bannerHeightRatio', ${CAPTION_BANNER_SPEC.bannerHeightRatio}))
BANNER_BG = (int(_banner_bg['r']), int(_banner_bg['g']), int(_banner_bg['b']), round(255 * float(_style.get('bannerBackgroundAlpha', ${CAPTION_BANNER_SPEC.bannerBackgroundAlpha}))))
CHIP_SIDE_RATIO = ${CAPTION_BANNER_SPEC.chipSideRatio} * float(_style.get('chipScale', 1.0))
CHIP_RADIUS_RATIO = ${CAPTION_BANNER_SPEC.chipCornerRadiusRatio}
CHIP_COLOR = (int(_chip_color['r']), int(_chip_color['g']), int(_chip_color['b']), 255)
CHIP_INSET_X_RATIO = ${CAPTION_BANNER_SPEC.chipInsetXRatio}
CAPTION_TEXT_COLOR = (${CAPTION_BANNER_SPEC.captionTextColor.r}, ${CAPTION_BANNER_SPEC.captionTextColor.g}, ${CAPTION_BANNER_SPEC.captionTextColor.b}, 255)
CAPTION_GAP_RATIO = ${CAPTION_BANNER_SPEC.captionGapRatio}

def render_step_card(request, draw, image):
    # Bottom-anchored, full-width caption banner with an optional numbered
    # squircle chip. x/y from the request are no longer used for layout
    # (kept in the request shape for cache-key/back-compat purposes only) --
    # the banner is always full width, flush to the bottom of the frame.
    out_w = int(request['outW'])
    out_h = int(request['outH'])
    font_size = int(request['fontSize'])
    text = request['stepText']
    label = request.get('stepLabel')

    banner_h = max(1, round(out_h * BANNER_HEIGHT_RATIO))
    banner_y = out_h - banner_h
    draw.rectangle((0, banner_y, out_w, out_h), fill=BANNER_BG)
    center_y = banner_y + banner_h / 2

    chip_inset_x = round(out_w * CHIP_INSET_X_RATIO)
    text_start_x = chip_inset_x

    if label:
        chip_side = max(1, round(out_h * CHIP_SIDE_RATIO))
        chip_radius = max(1, round(chip_side * CHIP_RADIUS_RATIO))
        chip_x = chip_inset_x
        chip_y = banner_y + (banner_h - chip_side) / 2
        draw.rounded_rectangle(
            (chip_x, chip_y, chip_x + chip_side, chip_y + chip_side),
            radius=chip_radius,
            fill=CHIP_COLOR,
        )
        label_font = load_font(request['fontPath'], max(10, round(chip_side * 0.62)), request['fontIndex'])
        label_box, label_w, label_h = text_size(draw, label, label_font)
        label_x = chip_x + (chip_side - label_w) / 2 - label_box[0]
        label_y = chip_y + (chip_side - label_h) / 2 - label_box[1]
        draw.text((label_x, label_y), label, font=label_font, fill=(255, 255, 255, 255))
        text_start_x = chip_x + chip_side + round(out_w * CAPTION_GAP_RATIO)

    max_text_width = max(20, out_w - text_start_x - chip_inset_x)
    font = fit_font(draw, request['fontPath'], font_size, request['fontIndex'], text, max_text_width, 20)
    text_box, _, _ = text_size(draw, text, font)
    draw_centered_text(draw, text_start_x - text_box[0], center_y, text, font, CAPTION_TEXT_COLOR)

def render_caption(request, draw, image):
    # Bottom-anchored, full-width caption banner. No step chip (no label is
    # available on this code path) -- text stays horizontally centered.
    out_w = int(request['outW'])
    out_h = int(request['outH'])
    text = request['text']

    banner_h = max(1, round(out_h * BANNER_HEIGHT_RATIO))
    banner_y = out_h - banner_h
    draw.rectangle((0, banner_y, out_w, out_h), fill=BANNER_BG)
    center_y = banner_y + banner_h / 2

    inset_x = round(out_w * CHIP_INSET_X_RATIO)
    max_text_width = max(20, out_w - inset_x * 2)
    font = fit_font(draw, request['fontPath'], int(request['fontSize']), request['fontIndex'], text, max_text_width, 32)
    box, text_w, _ = text_size(draw, text, font)
    x = (out_w - text_w) / 2 - box[0]
    draw_centered_text(draw, x, center_y, text, font, CAPTION_TEXT_COLOR)

image = Image.new('RGBA', (int(request['outW']), int(request['outH'])), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

if request['kind'] == 'step-card':
    render_step_card(request, draw, image)
elif request['kind'] == 'caption':
    render_caption(request, draw, image)
elif request['kind'] == 'frame-background':
    from PIL import ImageFilter
    out_w = int(request['outW'])
    out_h = int(request['outH'])
    content_w = int(request['contentW'])
    content_h = int(request['contentH'])
    content_x = int(request['contentX'])
    content_y = int(request['contentY'])
    radius = int(request['cornerRadius'])
    top = (18, 20, 26, 255)
    bottom = (32, 36, 46, 255)
    for y in range(out_h):
        p = y / max(1, out_h - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * p) for i in range(4))
        draw.line((0, y, out_w, y), fill=color)
    for offset, alpha, sigma in ((14, 0.20, 24), (10, 0.26, 18), (24, 0.14, 8)):
        shadow_alpha = Image.new('L', (out_w, out_h), 0)
        shadow_draw = ImageDraw.Draw(shadow_alpha)
        shadow_draw.rounded_rectangle(
            (content_x, content_y + offset, content_x + content_w, content_y + offset + content_h),
            radius=radius,
            fill=int(255 * alpha),
        )
        shadow_alpha = shadow_alpha.filter(ImageFilter.GaussianBlur(radius=float(sigma)))
        shadow = Image.new('RGBA', (out_w, out_h), (0, 0, 0, 255))
        image.alpha_composite(Image.composite(shadow, Image.new('RGBA', (out_w, out_h), (0, 0, 0, 0)), shadow_alpha))
elif request['kind'] == 'frame-mask':
    content_w = int(request['contentW'])
    content_h = int(request['contentH'])
    radius = int(request['cornerRadius'])
    image = Image.new('L', (content_w, content_h), 0)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, content_w - 1, content_h - 1), radius=radius, fill=255)
else:
    raise ValueError('unknown render kind')

os.makedirs(os.path.dirname(request['outPath']), exist_ok=True)
image.save(request['outPath'])
`
