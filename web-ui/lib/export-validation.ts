import { isAbsolute, relative, resolve } from 'node:path'
import type { ExportCapture, ExportRequest } from './types'

type ValidationResult =
  | { ok: true; value: ExportRequest }
  | { ok: false; error: string }

type Box = { x: number; y: number; width: number; height: number }

const EXPORT_FORMATS = new Set<ExportRequest['format']>([
  'zip',
  'markdown',
  'individual',
  'production',
])

const EXPORT_TEMPLATES = new Set<NonNullable<ExportRequest['template']>>([
  'blog',
  'social',
  'docs',
])

const MAX_BOX_EDGE = 10000
const MAX_HIGHLIGHTS_PER_CAPTURE = 20

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPathInside(candidate: string, root: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

function validateBox(value: unknown, label: string): { ok: true; value: Box } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: `${label} must be an object` }
  const { x, y, width, height } = value
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return { ok: false, error: `${label} must contain finite x, y, width, and height values` }
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    return { ok: false, error: `${label} must use non-negative coordinates and positive dimensions` }
  }
  if (width > MAX_BOX_EDGE || height > MAX_BOX_EDGE) {
    return { ok: false, error: `${label} dimensions are too large` }
  }
  return { ok: true, value: { x, y, width, height } }
}

function validateCapture(value: unknown, index: number): { ok: true; value: ExportCapture } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: `captures[${index}] must be an object` }

  const { captureId, order, caption, crop, highlights } = value
  if (typeof captureId !== 'string' || captureId.trim().length === 0) {
    return { ok: false, error: `captures[${index}].captureId is required` }
  }
  if (!isFiniteNumber(order) || !Number.isInteger(order) || order <= 0) {
    return { ok: false, error: `captures[${index}].order must be a positive integer` }
  }
  if (caption !== undefined && typeof caption !== 'string') {
    return { ok: false, error: `captures[${index}].caption must be a string` }
  }

  const validated: ExportCapture = { captureId: captureId.trim(), order }
  if (caption !== undefined) validated.caption = caption

  if (crop !== undefined) {
    const result = validateBox(crop, `captures[${index}].crop`)
    if (!result.ok) return result
    validated.crop = result.value
  }

  if (highlights !== undefined) {
    if (!Array.isArray(highlights)) {
      return { ok: false, error: `captures[${index}].highlights must be an array` }
    }
    if (highlights.length > MAX_HIGHLIGHTS_PER_CAPTURE) {
      return { ok: false, error: `captures[${index}].highlights has too many entries` }
    }
    validated.highlights = []
    for (let highlightIndex = 0; highlightIndex < highlights.length; highlightIndex += 1) {
      const result = validateBox(highlights[highlightIndex], `captures[${index}].highlights[${highlightIndex}]`)
      if (!result.ok) return result
      const color = isRecord(highlights[highlightIndex]) ? highlights[highlightIndex].color : undefined
      if (color !== undefined && typeof color !== 'string') {
        return { ok: false, error: `captures[${index}].highlights[${highlightIndex}].color must be a string` }
      }
      validated.highlights.push(color ? { ...result.value, color } : result.value)
    }
  }

  return { ok: true, value: validated }
}

export function validateExportRequestBody(body: unknown): ValidationResult {
  if (!isRecord(body)) return { ok: false, error: 'Request body must be an object' }

  const { format, template, outputDir, captures } = body
  if (typeof format !== 'string' || !EXPORT_FORMATS.has(format as ExportRequest['format'])) {
    return { ok: false, error: 'Unsupported export format' }
  }
  if (template !== undefined && (typeof template !== 'string' || !EXPORT_TEMPLATES.has(template as NonNullable<ExportRequest['template']>))) {
    return { ok: false, error: 'Unsupported export template' }
  }
  if (outputDir !== undefined && typeof outputDir !== 'string') {
    return { ok: false, error: 'outputDir must be a string' }
  }
  if (!Array.isArray(captures) || captures.length === 0) {
    return { ok: false, error: 'No captures specified' }
  }

  const exportCaptures: ExportCapture[] = []
  for (let index = 0; index < captures.length; index += 1) {
    const result = validateCapture(captures[index], index)
    if (!result.ok) return result
    exportCaptures.push(result.value)
  }

  const request: ExportRequest = {
    format: format as ExportRequest['format'],
    captures: exportCaptures,
  }
  if (template !== undefined) request.template = template as ExportRequest['template']
  if (typeof outputDir === 'string' && outputDir.trim()) request.outputDir = outputDir.trim()

  return { ok: true, value: request }
}

export function resolveExportOutputDir(
  requestedOutputDir: string | undefined,
  defaultOutputDir: string,
  allowedRoots: string[],
): { ok: true; path: string } | { ok: false; error: string } {
  if (!requestedOutputDir) return { ok: true, path: defaultOutputDir }

  const normalizedAllowedRoots = allowedRoots.map((root) => resolve(root))
  const baseRoot = normalizedAllowedRoots[0] ?? process.cwd()
  const candidate = isAbsolute(requestedOutputDir)
    ? resolve(requestedOutputDir)
    : resolve(baseRoot, requestedOutputDir)

  if (!normalizedAllowedRoots.some((root) => isPathInside(candidate, root))) {
    return { ok: false, error: 'outputDir must be inside the project or system temporary directory' }
  }

  return { ok: true, path: candidate }
}
