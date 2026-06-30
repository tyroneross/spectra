export interface ZoomClick {
  tMs: number
  cx: number
  cy: number
}

export interface CursorPoint {
  tMs: number
  cx: number
  cy: number
}

export interface ZoomKeyframe {
  frame: number
  scale: number
  cx: number
  cy: number
}

export interface ZoomTrackOptions {
  scale?: number
  preMs?: number
  postMs?: number
  mergeGapMs?: number
  ignoreTailMs?: number
  easeInMs?: number
  easeOutMs?: number
  cursorPath?: CursorPoint[]
  dwellMinMs?: number
  dwellMaxMs?: number
  dwellDisplacement?: number
}

interface ZoomSegment {
  startMs: number
  endMs: number
  clicks: ZoomClick[]
}

const DEFAULT_SCALE = 1.45
const DEFAULT_PRE_MS = 300
const DEFAULT_POST_MS = 2500
const DEFAULT_MERGE_GAP_MS = 2500
const DEFAULT_IGNORE_TAIL_MS = 1000
const DEFAULT_EASE_IN_MS = 900
const DEFAULT_EASE_OUT_MS = 1000
const DEFAULT_DWELL_MIN_MS = 450
const DEFAULT_DWELL_MAX_MS = 2600
const DEFAULT_DWELL_DISPLACEMENT = 0.02

export function buildZoomTrack(
  clicks: ZoomClick[],
  totalMs: number,
  fps: number,
  opts: ZoomTrackOptions = {},
): ZoomKeyframe[] {
  if (!Number.isFinite(totalMs) || totalMs < 0) {
    throw new Error('totalMs must be a non-negative finite number')
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error('fps must be a positive finite number')
  }

  const scale = opts.scale ?? DEFAULT_SCALE
  if (!Number.isFinite(scale) || scale < 1) {
    throw new Error('scale must be a finite number greater than or equal to 1')
  }

  const frameCount = Math.ceil((totalMs / 1000) * fps)
  const frameDurationMs = 1000 / fps
  const sourceClicks = clicks.length > 0 ? clicks : deriveDwellClicks(opts.cursorPath ?? [], totalMs, opts)
  const segments = mergeSegments(
    buildSegments(sourceClicks, totalMs, scale, opts),
    opts.mergeGapMs ?? DEFAULT_MERGE_GAP_MS,
  )

  const track: ZoomKeyframe[] = []
  let segmentIndex = 0

  for (let frame = 0; frame < frameCount; frame += 1) {
    const tMs = frame * frameDurationMs
    while (segmentIndex < segments.length && tMs > segments[segmentIndex].endMs) {
      segmentIndex += 1
    }

    const segment = segments[segmentIndex]
    if (!segment || tMs < segment.startMs || tMs > segment.endMs) {
      track.push({ frame, scale: 1, cx: 0.5, cy: 0.5 })
      continue
    }

    const currentScale = scaleAt(tMs, segment, scale, opts)
    const center = centerAt(tMs, segment, currentScale)
    track.push({
      frame,
      scale: round6(currentScale),
      cx: round6(center.cx),
      cy: round6(center.cy),
    })
  }

  return track
}

function buildSegments(
  clicks: ZoomClick[],
  totalMs: number,
  scale: number,
  opts: ZoomTrackOptions,
): ZoomSegment[] {
  const preMs = opts.preMs ?? DEFAULT_PRE_MS
  const postMs = opts.postMs ?? DEFAULT_POST_MS
  const ignoreTailMs = opts.ignoreTailMs ?? DEFAULT_IGNORE_TAIL_MS
  const latestClickMs = Math.max(0, totalMs - ignoreTailMs)

  return clicks
    .filter((click) =>
      Number.isFinite(click.tMs)
      && Number.isFinite(click.cx)
      && Number.isFinite(click.cy)
      && click.tMs >= 0
      && click.tMs <= latestClickMs
    )
    .sort((a, b) => a.tMs - b.tMs)
    .map((click) => {
      const normalized = {
        tMs: click.tMs,
        ...clampCenter(click.cx, click.cy, scale),
      }
      return {
        startMs: Math.max(0, click.tMs - preMs),
        endMs: Math.min(totalMs, click.tMs + postMs),
        clicks: [normalized],
      }
    })
    .filter((segment) => segment.endMs > segment.startMs)
}

function mergeSegments(segments: ZoomSegment[], mergeGapMs: number): ZoomSegment[] {
  const merged: ZoomSegment[] = []
  for (const segment of segments) {
    const previous = merged[merged.length - 1]
    if (previous && segment.startMs - previous.endMs <= mergeGapMs) {
      previous.endMs = Math.max(previous.endMs, segment.endMs)
      previous.clicks.push(...segment.clicks)
      previous.clicks.sort((a, b) => a.tMs - b.tMs)
    } else {
      merged.push({
        startMs: segment.startMs,
        endMs: segment.endMs,
        clicks: [...segment.clicks],
      })
    }
  }
  return merged
}

function scaleAt(tMs: number, segment: ZoomSegment, targetScale: number, opts: ZoomTrackOptions): number {
  const durationMs = segment.endMs - segment.startMs
  const easeInMs = Math.min(opts.easeInMs ?? DEFAULT_EASE_IN_MS, durationMs / 2)
  const easeOutMs = Math.min(opts.easeOutMs ?? DEFAULT_EASE_OUT_MS, Math.max(0, durationMs - easeInMs))
  const easeOutStartMs = segment.endMs - easeOutMs
  const delta = targetScale - 1

  if (easeInMs > 0 && tMs < segment.startMs + easeInMs) {
    return 1 + delta * smoothstep((tMs - segment.startMs) / easeInMs)
  }
  if (easeOutMs > 0 && tMs > easeOutStartMs) {
    return targetScale - delta * smoothstep((tMs - easeOutStartMs) / easeOutMs)
  }
  return targetScale
}

function centerAt(tMs: number, segment: ZoomSegment, scale: number): { cx: number; cy: number } {
  const clicks = segment.clicks
  if (clicks.length === 0) return { cx: 0.5, cy: 0.5 }
  if (clicks.length === 1 || tMs <= clicks[0].tMs) {
    return clampCenter(clicks[0].cx, clicks[0].cy, scale)
  }

  for (let index = 0; index < clicks.length - 1; index += 1) {
    const current = clicks[index]
    const next = clicks[index + 1]
    if (tMs <= next.tMs) {
      const spanMs = Math.max(1, next.tMs - current.tMs)
      const p = smoothstep((tMs - current.tMs) / spanMs)
      return clampCenter(
        current.cx + (next.cx - current.cx) * p,
        current.cy + (next.cy - current.cy) * p,
        scale,
      )
    }
  }

  const last = clicks[clicks.length - 1]
  return clampCenter(last.cx, last.cy, scale)
}

function deriveDwellClicks(
  cursorPath: CursorPoint[],
  totalMs: number,
  opts: ZoomTrackOptions,
): ZoomClick[] {
  const minMs = opts.dwellMinMs ?? DEFAULT_DWELL_MIN_MS
  const maxMs = opts.dwellMaxMs ?? DEFAULT_DWELL_MAX_MS
  const displacement = opts.dwellDisplacement ?? DEFAULT_DWELL_DISPLACEMENT
  const ignoreTailMs = opts.ignoreTailMs ?? DEFAULT_IGNORE_TAIL_MS
  const latestClickMs = Math.max(0, totalMs - ignoreTailMs)
  const points = cursorPath
    .filter((point) =>
      Number.isFinite(point.tMs)
      && Number.isFinite(point.cx)
      && Number.isFinite(point.cy)
      && point.tMs >= 0
      && point.tMs <= latestClickMs
    )
    .sort((a, b) => a.tMs - b.tMs)

  const dwellClicks: ZoomClick[] = []
  let start = 0
  while (start < points.length) {
    let end = start
    while (
      end + 1 < points.length
      && points[end + 1].tMs - points[start].tMs <= maxMs
      && distance(points[start], points[end + 1]) < displacement
    ) {
      end += 1
    }

    const durationMs = points[end].tMs - points[start].tMs
    if (durationMs >= minMs) {
      const run = points.slice(start, end + 1)
      dwellClicks.push({
        tMs: (points[start].tMs + points[end].tMs) / 2,
        cx: average(run.map((point) => point.cx)),
        cy: average(run.map((point) => point.cy)),
      })
      start = end + 1
    } else {
      start += 1
    }
  }

  return dwellClicks
}

function smoothstep(value: number): number {
  const p = clamp(value, 0, 1)
  return 3 * p * p - 2 * p * p * p
}

function clampCenter(cx: number, cy: number, scale: number): { cx: number; cy: number } {
  const min = 0.5 / scale
  const max = 1 - min
  return {
    cx: clamp(cx, min, max),
    cy: clamp(cy, min, max),
  }
}

function distance(a: CursorPoint, b: CursorPoint): number {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy)
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
