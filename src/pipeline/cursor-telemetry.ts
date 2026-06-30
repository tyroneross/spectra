import { readFile } from 'node:fs/promises'
import type { CursorPoint, ZoomClick } from './zoom-keyframes.js'

export interface CursorTelemetry {
  clicks: ZoomClick[]
  cursorPath: CursorPoint[]
}

interface RawCursorTelemetry {
  durationMs?: unknown
  samples?: unknown
  clicks?: unknown
}

export async function loadCursorTelemetry(jsonPath: string): Promise<CursorTelemetry> {
  const parsed = JSON.parse(await readFile(jsonPath, 'utf-8')) as RawCursorTelemetry
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('cursor telemetry must be a JSON object')
  }

  const cursorPath = readPointArray(parsed.samples, 'samples')
  const clicks = readPointArray(parsed.clicks, 'clicks')
  assertMonotonic(cursorPath, 'samples')
  assertMonotonic(clicks, 'clicks')

  return { clicks, cursorPath }
}

function readPointArray(value: unknown, field: string): CursorPoint[] {
  if (!Array.isArray(value)) {
    throw new Error(`cursor telemetry ${field} must be an array`)
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`cursor telemetry ${field}[${index}] must be an object`)
    }
    const candidate = entry as { tMs?: unknown; cx?: unknown; cy?: unknown }
    const tMs = readNonNegativeFinite(candidate.tMs, `${field}[${index}].tMs`)
    const cx = readNormalized(candidate.cx, `${field}[${index}].cx`)
    const cy = readNormalized(candidate.cy, `${field}[${index}].cy`)
    return { tMs, cx, cy }
  })
}

function readNonNegativeFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`cursor telemetry ${label} must be a non-negative finite number`)
  }
  return value
}

function readNormalized(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`cursor telemetry ${label} must be a finite number in [0,1]`)
  }
  return value
}

function assertMonotonic(points: CursorPoint[], field: string): void {
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].tMs < points[index - 1].tMs) {
      throw new Error(`cursor telemetry ${field} tMs values must be monotonic`)
    }
  }
}
