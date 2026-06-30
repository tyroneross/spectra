export interface FramingFilterOptions {
  inputLabel?: string
  outputLabel?: string
  outW?: number
  outH?: number
  fps?: number
  contentScale?: number
  cornerRadius?: number
  caption?: string
  fontFile?: string
  fontSize?: number
  captionPill?: boolean
  captionMode?: 'drawtext' | 'bitmap'
}

const DEFAULT_OUT_W = 1920
const DEFAULT_OUT_H = 1080
const DEFAULT_FPS = 60
const DEFAULT_CONTENT_SCALE = 0.88
const DEFAULT_CORNER_RADIUS = 20
const DEFAULT_FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'

export function framingFilter(opts: FramingFilterOptions = {}): string {
  const outW = positiveInteger(opts.outW ?? DEFAULT_OUT_W, 'outW')
  const outH = positiveInteger(opts.outH ?? DEFAULT_OUT_H, 'outH')
  const fps = positiveInteger(opts.fps ?? DEFAULT_FPS, 'fps')
  const contentScale = opts.contentScale ?? DEFAULT_CONTENT_SCALE
  const radius = positiveInteger(opts.cornerRadius ?? DEFAULT_CORNER_RADIUS, 'cornerRadius')
  if (!Number.isFinite(contentScale) || contentScale <= 0 || contentScale > 1) {
    throw new Error('contentScale must be a finite number in the range (0, 1]')
  }

  const contentW = even(Math.round(outW * contentScale))
  const contentH = even(Math.round(outH * contentScale))
  const contentX = Math.round((outW - contentW) / 2)
  const contentY = Math.round((outH - contentH) / 2) - Math.round(outH * 0.02)
  const shadowPad = Math.max(18, Math.ceil(24 * 3))
  const shadowW = contentW + shadowPad * 2
  const shadowH = contentH + shadowPad * 2
  const inRef = labelRef(opts.inputLabel ?? '0:v')
  const outRef = labelRef(opts.outputLabel ?? 'v')
  const maskExpr = roundedRectMaskExpression(contentW, contentH, Math.min(radius, Math.floor(Math.min(contentW, contentH) / 2)))
  const caption = opts.caption?.trim()
  const fontSize = positiveInteger(opts.fontSize ?? 46, 'fontSize')
  const finalFilter = caption && (opts.captionMode ?? 'drawtext') === 'drawtext'
    ? `[framed]drawtext=fontfile=${escapeFilterValue(opts.fontFile ?? DEFAULT_FONT)}:text='${escapeDrawtext(caption)}':fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=h-${Math.round(outH * 0.12)}${captionBox(opts.captionPill ?? true)},format=yuv420p${outRef}`
    : bitmapCaptionGraph('framed', caption, outW, outH, fps, fontSize, opts.captionPill ?? true, outRef)

  return [
    `${inRef}scale=${contentW}:${contentH}:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=${contentW}:${contentH}:(ow-iw)/2:(oh-ih)/2:color=0x00000000[scaled]`,
    `color=c=white:s=${contentW}x${contentH}:r=${fps},format=gray,geq=lum='${maskExpr}'[mask]`,
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
  ].join(';')
}

function bitmapCaptionGraph(
  inputLabel: string,
  caption: string | undefined,
  outW: number,
  outH: number,
  fps: number,
  fontSize: number,
  pill: boolean,
  outRef: string,
): string {
  const inputRef = labelRef(inputLabel)
  if (!caption) return `${inputRef}format=yuv420p${outRef}`

  const text = normalizeBitmapText(caption)
  let pixel = Math.max(2, Math.round(fontSize / 8))
  let metrics = bitmapMetrics(text, pixel)
  while (metrics.width > outW * 0.86 && pixel > 2) {
    pixel -= 1
    metrics = bitmapMetrics(text, pixel)
  }

  const textX = Math.round((outW - metrics.width) / 2)
  const textY = outH - Math.round(outH * 0.12)
  const rects = bitmapTextRects(text, pixel)
  const padX = Math.round(pixel * 4)
  const padY = Math.round(pixel * 3)
  const pillX = textX - padX
  const pillY = textY - padY
  const pillW = metrics.width + padX * 2
  const pillH = metrics.height + padY * 2
  const textBoxes = rects.map((rect) =>
    `drawbox=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}:color=white@1:t=fill:replace=1`
  )
  const filters: string[] = [
    `color=c=white@0:s=${metrics.width}x${metrics.height}:r=${fps},format=rgba${textBoxes.length > 0 ? `,${textBoxes.join(',')}` : ''}[captionText]`,
  ]

  if (pill) {
    filters.unshift(`color=c=0x0b0d12@0.58:s=${pillW}x${pillH}:r=${fps},format=rgba[captionPill]`)
    filters.push(`${inputRef}[captionPill]overlay=x=${pillX}:y=${pillY}:shortest=1[captionBase]`)
    filters.push('[captionBase][captionText]overlay=x=' + textX + ':y=' + textY + `:shortest=1,format=yuv420p${outRef}`)
  } else {
    filters.push(`${inputRef}[captionText]overlay=x=${textX}:y=${textY}:shortest=1,format=yuv420p${outRef}`)
  }

  return filters.join(';')
}

interface BitmapRect {
  x: number
  y: number
  w: number
  h: number
}

function bitmapTextRects(text: string, pixel: number): BitmapRect[] {
  const rects: BitmapRect[] = []
  let cursorX = 0
  for (const char of text) {
    const glyph = BITMAP_FONT[char] ?? BITMAP_FONT[' ']
    if (char === ' ') {
      cursorX += pixel * 4
      continue
    }

    for (let rowIndex = 0; rowIndex < glyph.length; rowIndex += 1) {
      const row = glyph[rowIndex]
      let col = 0
      while (col < row.length) {
        if (row[col] !== '1') {
          col += 1
          continue
        }
        const startCol = col
        while (col < row.length && row[col] === '1') col += 1
        rects.push({
          x: cursorX + startCol * pixel,
          y: rowIndex * pixel,
          w: (col - startCol) * pixel,
          h: pixel,
        })
      }
    }

    cursorX += pixel * (glyph[0].length + 1)
  }
  return rects
}

function bitmapMetrics(text: string, pixel: number): { width: number; height: number } {
  let width = 0
  for (const char of text) {
    const glyph = BITMAP_FONT[char] ?? BITMAP_FONT[' ']
    width += char === ' ' ? pixel * 4 : pixel * (glyph[0].length + 1)
  }
  return {
    width: Math.max(pixel, width - pixel),
    height: pixel * 7,
  }
}

function normalizeBitmapText(caption: string): string {
  return caption
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/[^A-Z0-9 .,!?\-]/g, ' ')
}

function shadowLayer(
  name: 'A' | 'B' | 'C',
  width: number,
  height: number,
  pad: number,
  fps: number,
  alpha: number,
  sigma: number,
): string {
  const scale = 4
  const smallContentW = Math.max(2, even(Math.round((width - pad * 2) / scale)))
  const smallContentH = Math.max(2, even(Math.round((height - pad * 2) / scale)))
  const smallPad = Math.max(2, Math.round(pad / scale))
  const smallW = smallContentW + smallPad * 2
  const smallH = smallContentH + smallPad * 2
  const smallSigma = Math.max(1, sigma / scale)

  return [
    `[mask${name}]scale=${smallContentW}:${smallContentH}:flags=bilinear,pad=${smallW}:${smallH}:${smallPad}:${smallPad}:color=black[mask${name}Padded]`,
    `color=c=black:s=${smallW}x${smallH}:r=${fps},format=rgba[shadowColor${name}]`,
    `[shadowColor${name}][mask${name}Padded]alphamerge,colorchannelmixer=aa=${alpha.toFixed(2)},gblur=sigma=${smallSigma},scale=${width}:${height}:flags=bicubic[shadow${name}]`,
  ].join(';')
}

function roundedRectMaskExpression(width: number, height: number, radius: number): string {
  const right = width - radius - 1
  const bottom = height - radius - 1
  const radiusSquared = radius * radius
  const centerX = `${gte('X', radius)}*${lte('X', right)}`
  const centerY = `${gte('Y', radius)}*${lte('Y', bottom)}`
  const topLeft = `${lt('X', radius)}*${lt('Y', radius)}*${lte(`pow(X-${radius}\\,2)+pow(Y-${radius}\\,2)`, radiusSquared)}`
  const topRight = `${gt('X', right)}*${lt('Y', radius)}*${lte(`pow(X-${right}\\,2)+pow(Y-${radius}\\,2)`, radiusSquared)}`
  const bottomLeft = `${lt('X', radius)}*${gt('Y', bottom)}*${lte(`pow(X-${radius}\\,2)+pow(Y-${bottom}\\,2)`, radiusSquared)}`
  const bottomRight = `${gt('X', right)}*${gt('Y', bottom)}*${lte(`pow(X-${right}\\,2)+pow(Y-${bottom}\\,2)`, radiusSquared)}`
  return `255*min(1\\,${centerX}+${centerY}+${topLeft}+${topRight}+${bottomLeft}+${bottomRight})`
}

function captionBox(enabled: boolean): string {
  return enabled
    ? ':box=1:boxcolor=0x0b0d12@0.58:boxborderw=22'
    : ''
}

function labelRef(label: string): string {
  return label.startsWith('[') && label.endsWith(']') ? label : `[${label}]`
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function even(value: number): number {
  return value % 2 === 0 ? value : value + 1
}

function gte(left: string, right: number): string {
  return `gte(${left}\\,${right})`
}

function gt(left: string, right: number): string {
  return `gt(${left}\\,${right})`
}

function lte(left: string, right: number): string {
  return `lte(${left}\\,${right})`
}

function lt(left: string, right: number): string {
  return `lt(${left}\\,${right})`
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%')
}

function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
}

const BITMAP_FONT: Record<string, string[]> = {
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
}
