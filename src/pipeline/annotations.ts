import { bitmapTextLayer, hexColor, type BitmapTextLayer } from './framing.js'
import type { DemoScript } from './script.js'
import { CAPTION_BANNER_SPEC, renderStepCardPng } from './text-render.js'

export interface TimedStepCard {
  stepLabel?: string
  stepText: string
  startMs: number
  endMs: number
}

export interface TimedStepCardsFilterOptions {
  inputLabel?: string
  outputLabel?: string
  cards: TimedStepCard[]
  outW?: number
  outH?: number
  fps?: number
  x?: number
  y?: number
  fadeMs?: number
  fontPixel?: number
  fontSize?: number
  cacheDir?: string
  inputIndexStart?: number
}

export interface TimedStepCardsFilterPlan {
  filter: string
  imagePaths: string[]
  usedPng: boolean
  nextInputIndex: number
}

interface PreparedCard extends TimedStepCard {
  startSec: string
  endSec: string
  fadeSec: string
  fadeOutStartSec: string
  normalizedLabel?: string
}

interface CardGraph {
  filters: string[]
  label: string
  width: number
  height: number
}

const DEFAULT_OUT_W = 1920
const DEFAULT_OUT_H = 1080
const DEFAULT_FPS = 60
const DEFAULT_FADE_MS = 250
const DEFAULT_FONT_PIXEL = 7
const DEFAULT_FONT_SIZE = 40

export function cardsFromScript(script: DemoScript): TimedStepCard[] {
  return script.beats
    .filter((beat) => beat.stepText?.trim())
    .map((beat) => ({
      stepLabel: beat.stepLabel,
      stepText: beat.stepText?.trim() ?? '',
      startMs: beat.startMs,
      endMs: beat.endMs,
    }))
}

export function timedStepCardsFilter(opts: TimedStepCardsFilterOptions): string {
  const outW = positiveInteger(opts.outW ?? DEFAULT_OUT_W, 'outW')
  const outH = positiveInteger(opts.outH ?? DEFAULT_OUT_H, 'outH')
  const fps = positiveInteger(opts.fps ?? DEFAULT_FPS, 'fps')
  const fadeMs = nonNegativeNumber(opts.fadeMs ?? DEFAULT_FADE_MS, 'fadeMs')
  const bannerH = Math.round(outH * CAPTION_BANNER_SPEC.bannerHeightRatio)
  const x = nonNegativeInteger(opts.x ?? 0, 'x')
  const y = nonNegativeInteger(opts.y ?? (outH - bannerH), 'y')
  const fontPixel = positiveInteger(opts.fontPixel ?? DEFAULT_FONT_PIXEL, 'fontPixel')
  const inputRef = labelRef(opts.inputLabel ?? '0:v')
  const outputRef = labelRef(opts.outputLabel ?? 'v')
  const cards = prepareCards(opts.cards, fadeMs)

  if (cards.length === 0) return `${inputRef}format=yuv420p${outputRef}`

  const filters: string[] = []
  let currentLabel = stripLabel(inputRef)
  for (let index = 0; index < cards.length; index += 1) {
    const timedCard = cards[index]
    const cardGraph = buildCardGraph(timedCard, index, outW, outH, fps, fontPixel)
    filters.push(...cardGraph.filters)

    const nextLabel = `stepAnnotated${index}`
    filters.push(
      `${labelRef(currentLabel)}${labelRef(cardGraph.label)}overlay=x=${x}:y=${y}:shortest=1:enable='between(t\\,${timedCard.startSec}\\,${timedCard.endSec})'${labelRef(nextLabel)}`,
    )
    currentLabel = nextLabel
  }

  filters.push(`${labelRef(currentLabel)}format=yuv420p${outputRef}`)
  return filters.join(';')
}

export async function timedStepCardsOverlayPlan(opts: TimedStepCardsFilterOptions): Promise<TimedStepCardsFilterPlan> {
  const pngPlan = await timedStepCardsPngFilter(opts)
  if (pngPlan) return pngPlan

  const inputIndexStart = positiveInteger(opts.inputIndexStart ?? 1, 'inputIndexStart')
  return {
    filter: timedStepCardsFilter(opts),
    imagePaths: [],
    usedPng: false,
    nextInputIndex: inputIndexStart,
  }
}

export async function timedStepCardsPngFilter(opts: TimedStepCardsFilterOptions): Promise<TimedStepCardsFilterPlan | undefined> {
  const outW = positiveInteger(opts.outW ?? DEFAULT_OUT_W, 'outW')
  const outH = positiveInteger(opts.outH ?? DEFAULT_OUT_H, 'outH')
  const fps = positiveInteger(opts.fps ?? DEFAULT_FPS, 'fps')
  const fadeMs = nonNegativeNumber(opts.fadeMs ?? DEFAULT_FADE_MS, 'fadeMs')
  const x = nonNegativeInteger(opts.x ?? Math.round(outW * 0.045), 'x')
  const y = nonNegativeInteger(opts.y ?? Math.round(outH * 0.075), 'y')
  const fontSize = positiveInteger(opts.fontSize ?? DEFAULT_FONT_SIZE, 'fontSize')
  const inputIndexStart = positiveInteger(opts.inputIndexStart ?? 1, 'inputIndexStart')
  const inputRef = labelRef(opts.inputLabel ?? '0:v')
  const outputRef = labelRef(opts.outputLabel ?? 'v')
  const cards = prepareCards(opts.cards, fadeMs)

  if (cards.length === 0) {
    return {
      filter: `${inputRef}format=yuv420p${outputRef}`,
      imagePaths: [],
      usedPng: false,
      nextInputIndex: inputIndexStart,
    }
  }

  const imagePaths: string[] = []
  for (const card of cards) {
    const path = await renderStepCardPng({
      stepLabel: card.normalizedLabel,
      stepText: card.stepText,
      outW,
      outH,
      x,
      y,
      fontSize,
      cacheDir: opts.cacheDir,
    })
    if (!path) return undefined
    imagePaths.push(path)
  }

  const filters: string[] = []
  let currentLabel = stripLabel(inputRef)
  for (let index = 0; index < cards.length; index += 1) {
    const timedCard = cards[index]
    const assetLabel = `stepCardPng${index}`
    filters.push(`${labelRef(`${inputIndexStart + index}:v`)}format=rgba${fadeSuffix(timedCard)}${labelRef(assetLabel)}`)

    const nextLabel = `stepAnnotated${index}`
    filters.push(
      `${labelRef(currentLabel)}${labelRef(assetLabel)}overlay=x=0:y=0:shortest=1:enable='between(t\\,${timedCard.startSec}\\,${timedCard.endSec})'${labelRef(nextLabel)}`,
    )
    currentLabel = nextLabel
  }

  filters.push(`${labelRef(currentLabel)}format=yuv420p${outputRef}`)
  return {
    filter: filters.join(';'),
    imagePaths,
    usedPng: true,
    nextInputIndex: inputIndexStart + imagePaths.length,
  }
}

export function normalizeStepLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim()
  if (!trimmed) return undefined
  const mapped = [...trimmed].map((char) => CIRCLED_DIGITS[char] ?? char).join('')
  const cleaned = mapped.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return cleaned || undefined
}

function prepareCards(cards: TimedStepCard[], fadeMs: number): PreparedCard[] {
  return cards
    .filter((card) =>
      card.stepText.trim().length > 0
      && Number.isFinite(card.startMs)
      && Number.isFinite(card.endMs)
      && card.endMs > card.startMs
    )
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map((card) => {
      const durationMs = card.endMs - card.startMs
      const effectiveFadeMs = Math.min(fadeMs, durationMs / 2)
      return {
        ...card,
        stepText: card.stepText.trim(),
        normalizedLabel: normalizeStepLabel(card.stepLabel),
        startSec: seconds(card.startMs),
        endSec: seconds(card.endMs),
        fadeSec: seconds(effectiveFadeMs),
        fadeOutStartSec: seconds(card.endMs - effectiveFadeMs),
      }
    })
}

function buildCardGraph(card: PreparedCard, index: number, outW: number, outH: number, fps: number, fontPixel: number): CardGraph {
  // Bottom-anchored, full-width caption banner with an optional numbered
  // chip -- the bitmap-font fallback used when Pillow rendering (text-render.ts)
  // is unavailable. A true rounded "squircle" corner isn't achievable with
  // plain ffmpeg drawbox rectangles; color and geometry otherwise follow
  // CAPTION_BANNER_SPEC.
  const bannerH = Math.round(outH * CAPTION_BANNER_SPEC.bannerHeightRatio)
  const chipSide = Math.round(outH * CAPTION_BANNER_SPEC.chipSideRatio)
  const chipInsetX = Math.round(outW * CAPTION_BANNER_SPEC.chipInsetXRatio)
  const gap = Math.round(outW * CAPTION_BANNER_SPEC.captionGapRatio)
  const captionTextColor = `${hexColor(CAPTION_BANNER_SPEC.captionTextColor)}@1`

  const maxTextWidth = Math.round(outW * 0.68)
  const text = fitTextLayer(`stepCardText${index}`, card.stepText, fontPixel, maxTextWidth, fps, captionTextColor)
  const label = card.normalizedLabel
    ? fitTextLayer(`stepCardLabel${index}`, card.normalizedLabel, Math.max(3, Math.round(fontPixel * 0.85)), chipSide, fps)
    : undefined

  const textX = chipInsetX + (label ? chipSide + gap : 0)
  const textY = Math.round((bannerH - text.height) / 2)
  const cardBase = `stepCardBase${index}`
  const cardBody = `stepCardBody${index}`
  const cardWithLabel = `stepCardWithLabel${index}`
  const cardLabel = `stepCard${index}`
  const bannerColor = hexColor(CAPTION_BANNER_SPEC.bannerBackground)
  const filters = [
    text.filter,
    `color=c=${bannerColor}@${CAPTION_BANNER_SPEC.bannerBackgroundAlpha}:s=${outW}x${bannerH}:r=${fps},format=rgba${labelRef(cardBase)}`,
  ]

  if (label) {
    const chipColor = hexColor(CAPTION_BANNER_SPEC.chipColor)
    const chipY = Math.round((bannerH - chipSide) / 2)
    const labelX = chipInsetX + Math.round((chipSide - label.width) / 2)
    const labelY = chipY + Math.round((chipSide - label.height) / 2)
    filters.unshift(label.filter)
    filters.push(
      `${labelRef(cardBase)}drawbox=x=${chipInsetX}:y=${chipY}:w=${chipSide}:h=${chipSide}:color=${chipColor}:t=fill${labelRef(cardBody)}`,
      `${labelRef(cardBody)}${labelRef(`stepCardLabel${index}`)}overlay=x=${labelX}:y=${labelY}:shortest=1${labelRef(cardWithLabel)}`,
      `${labelRef(cardWithLabel)}${labelRef(`stepCardText${index}`)}overlay=x=${textX}:y=${textY}:shortest=1${fadeSuffix(card)}${labelRef(cardLabel)}`,
    )
  } else {
    filters.push(
      `${labelRef(cardBase)}${labelRef(`stepCardText${index}`)}overlay=x=${textX}:y=${textY}:shortest=1${fadeSuffix(card)}${labelRef(cardLabel)}`,
    )
  }

  return {
    filters,
    label: cardLabel,
    width: outW,
    height: bannerH,
  }
}

function fitTextLayer(label: string, text: string, preferredPixel: number, maxWidth: number, fps: number, color?: string): BitmapTextLayer {
  let pixel = preferredPixel
  let layer = bitmapTextLayer(label, text, pixel, fps, color)
  while (layer.width > maxWidth && pixel > 2) {
    pixel -= 1
    layer = bitmapTextLayer(label, text, pixel, fps, color)
  }
  return layer
}

function fadeSuffix(card: PreparedCard): string {
  if (card.fadeSec === '0') return ''
  return `,fade=t=in:st=${card.startSec}:d=${card.fadeSec}:alpha=1,fade=t=out:st=${card.fadeOutStartSec}:d=${card.fadeSec}:alpha=1`
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function labelRef(label: string): string {
  return label.startsWith('[') && label.endsWith(']') ? label : `[${label}]`
}

function stripLabel(label: string): string {
  return label.startsWith('[') && label.endsWith(']') ? label.slice(1, -1) : label
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

function nonNegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`)
  }
  return value
}

const CIRCLED_DIGITS: Record<string, string> = {
  '⓪': '0',
  '①': '1',
  '②': '2',
  '③': '3',
  '④': '4',
  '⑤': '5',
  '⑥': '6',
  '⑦': '7',
  '⑧': '8',
  '⑨': '9',
}
