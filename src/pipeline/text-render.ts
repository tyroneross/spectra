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
}

export interface CaptionPngOptions {
  text: string
  outW?: number
  outH?: number
  fontSize?: number
  cacheDir?: string
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

const CACHE_VERSION = 1
const DEFAULT_OUT_W = 1920
const DEFAULT_OUT_H = 1080
const DEFAULT_STEP_X = 120
const DEFAULT_STEP_Y = 92
const DEFAULT_STEP_FONT_SIZE = 40
const DEFAULT_CAPTION_FONT_SIZE = 48
const DEFAULT_FONT_PATH = '/System/Library/Fonts/Helvetica.ttc'
const DEFAULT_FONT_INDEX = 1
const DEFAULT_CACHE_DIR = join(tmpdir(), 'spectra-text-render')

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

def render_step_card(request, draw, image):
    out_w = int(request['outW'])
    x = int(request['x'])
    y = int(request['y'])
    font_size = int(request['fontSize'])
    text = request['stepText']
    label = request.get('stepLabel')
    font = fit_font(draw, request['fontPath'], font_size, request['fontIndex'], text, int(out_w * 0.68), 28)
    label_font = load_font(request['fontPath'], max(24, int(font_size * 0.72)), request['fontIndex'])
    text_box, text_w, text_h = text_size(draw, text, font)

    pad_x = 34
    pad_y = 24
    gap = 24 if label else 0
    pill = max(56, int(font_size * 1.38)) if label else 0
    card_w = pad_x * 2 + pill + gap + text_w
    card_h = max(82, pad_y * 2 + max(text_h, pill))
    radius = 18

    draw.rounded_rectangle(
        (x, y, x + card_w, y + card_h),
        radius=radius,
        fill=(10, 12, 18, 210),
        outline=(255, 255, 255, 32),
        width=1,
    )

    text_x = x + pad_x
    center_y = y + card_h / 2
    if label:
        pill_x = x + pad_x
        pill_y = y + (card_h - pill) / 2
        draw.ellipse((pill_x, pill_y, pill_x + pill, pill_y + pill), fill=(59, 130, 246, 255))
        label_box, label_w, label_h = text_size(draw, label, label_font)
        label_x = pill_x + (pill - label_w) / 2 - label_box[0]
        label_y = pill_y + (pill - label_h) / 2 - label_box[1]
        draw.text((label_x, label_y), label, font=label_font, fill=(255, 255, 255, 255))
        text_x += pill + gap

    draw_centered_text(draw, text_x - text_box[0], center_y, text, font, (255, 255, 255, 255))

def render_caption(request, draw, image):
    out_w = int(request['outW'])
    out_h = int(request['outH'])
    text = request['text']
    font = fit_font(draw, request['fontPath'], int(request['fontSize']), request['fontIndex'], text, int(out_w * 0.86), 32)
    box, text_w, _ = text_size(draw, text, font)
    x = (out_w - text_w) / 2 - box[0]
    y = out_h - int(out_h * 0.13) - box[1]
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 255))

request = json.load(sys.stdin)
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
