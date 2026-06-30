import type { ZoomKeyframe } from './zoom-keyframes.js'

const DEFAULT_OUTPUT_WIDTH = 1920
const DEFAULT_OUTPUT_HEIGHT = 1080
const DEFAULT_OUTPUT_FPS = 60
const EPSILON = 0.000001
const MAX_EXPRESSION_POINTS = 120

export function zoomFilter(
  track: ZoomKeyframe[],
  srcW: number,
  srcH: number,
  outW = DEFAULT_OUTPUT_WIDTH,
  outH = DEFAULT_OUTPUT_HEIGHT,
  fps = DEFAULT_OUTPUT_FPS,
): string {
  assertPositiveInteger(srcW, 'srcW')
  assertPositiveInteger(srcH, 'srcH')
  assertPositiveInteger(outW, 'outW')
  assertPositiveInteger(outH, 'outH')
  assertPositiveInteger(fps, 'fps')

  const normalized = compactTrack(normalizeTrack(track))
  const zoomExpr = interpolatedExpression(1, normalized.map((point) => ({ frame: point.frame, value: point.scale })))
  const cxExpr = interpolatedExpression(0.5, normalized.map((point) => ({ frame: point.frame, value: point.cx })))
  const cyExpr = interpolatedExpression(0.5, normalized.map((point) => ({ frame: point.frame, value: point.cy })))
  const xExpr = `max(0\\,min(iw-iw/zoom\\,iw*(${cxExpr})-(iw/zoom/2)))`
  const yExpr = `max(0\\,min(ih-ih/zoom\\,ih*(${cyExpr})-(ih/zoom/2)))`

  return [
    `zoompan=z='${zoomExpr}'`,
    `x='${xExpr}'`,
    `y='${yExpr}'`,
    'd=1',
    `s=${outW}x${outH}`,
    `fps=${fps}`,
  ].join(':')
}

function compactTrack(track: ZoomKeyframe[]): ZoomKeyframe[] {
  if (track.length <= MAX_EXPRESSION_POINTS) return track

  const stride = Math.ceil(track.length / MAX_EXPRESSION_POINTS)
  const selected = new Map<number, ZoomKeyframe>()
  const add = (index: number) => {
    const point = track[Math.min(track.length - 1, Math.max(0, index))]
    selected.set(point.frame, point)
  }

  add(0)
  add(track.length - 1)
  for (let index = 1; index < track.length - 1; index += 1) {
    const previous = track[index - 1]
    const current = track[index]
    const next = track[index + 1]
    const boundary = isDefault(previous) !== isDefault(current) || isDefault(current) !== isDefault(next)
    if (boundary || index % stride === 0) add(index)
  }

  return [...selected.values()].sort((a, b) => a.frame - b.frame)
}

function isDefault(point: ZoomKeyframe): boolean {
  return Math.abs(point.scale - 1) <= EPSILON
    && Math.abs(point.cx - 0.5) <= EPSILON
    && Math.abs(point.cy - 0.5) <= EPSILON
}

function normalizeTrack(track: ZoomKeyframe[]): ZoomKeyframe[] {
  const byFrame = new Map<number, ZoomKeyframe>()
  for (const point of track) {
    if (!Number.isInteger(point.frame) || point.frame < 0) {
      throw new Error('track frames must be non-negative integers')
    }
    if (!Number.isFinite(point.scale) || point.scale < 1) {
      throw new Error('track scale values must be finite numbers greater than or equal to 1')
    }
    if (!Number.isFinite(point.cx) || !Number.isFinite(point.cy)) {
      throw new Error('track center values must be finite numbers')
    }
    byFrame.set(point.frame, {
      frame: point.frame,
      scale: point.scale,
      cx: clamp(point.cx, 0, 1),
      cy: clamp(point.cy, 0, 1),
    })
  }
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame)
}

function interpolatedExpression(defaultValue: number, values: Array<{ frame: number; value: number }>): string {
  const points = values
    .map(({ frame, value }) => ({ frame, value: round6(value) }))
    .filter((point, index, all) =>
      index === 0
      || index === all.length - 1
      || Math.abs(point.value - all[index - 1].value) > EPSILON
      || Math.abs(point.value - all[index + 1].value) > EPSILON
    )

  if (points.length === 0) return formatNumber(defaultValue)
  if (points.length === 1) {
    const point = points[0]
    return `if(eq(on\\,${point.frame})\\,${formatNumber(point.value)}\\,${formatNumber(defaultValue)})`
  }

  let expr = formatNumber(defaultValue)
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const current = points[index]
    const next = points[index + 1]
    expr = `if(lte(on\\,${next.frame})\\,${linearExpression(current, next)}\\,${expr})`
  }

  if (points[0].frame > 0) {
    expr = `if(lt(on\\,${points[0].frame})\\,${formatNumber(defaultValue)}\\,${expr})`
  }

  return expr
}

function linearExpression(
  current: { frame: number; value: number },
  next: { frame: number; value: number },
): string {
  if (current.frame === next.frame || Math.abs(current.value - next.value) <= EPSILON) {
    return formatNumber(current.value)
  }

  const delta = round6(next.value - current.value)
  const sign = delta < 0 ? '-' : '+'
  return `${formatNumber(current.value)}${sign}${formatNumber(Math.abs(delta))}*((on-${current.frame})/${next.frame - current.frame})`
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}
