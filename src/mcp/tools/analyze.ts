import type { ToolContext } from '../context.js'
import { scoreElements, findRegions } from '../../intelligence/importance.js'
import { detectState } from '../../intelligence/states.js'
import type { Viewport } from '../../intelligence/types.js'

export interface AnalyzeParams {
  sessionId: string
  viewport?: { width: number; height: number; devicePixelRatio?: number }
}

export interface AnalyzeResult {
  state: string
  stateConfidence: number
  regions: Array<{
    label: string
    score: number
    bounds: [number, number, number, number]
    elementCount: number
  }>
  topElements: Array<{
    id: string
    role: string
    label: string
    importance: number
    bounds: [number, number, number, number]
  }>
  totalElements: number
  consoleErrors: Array<{
    type: string
    text: string
    url?: string
  }>
}

export async function handleAnalyze(params: AnalyzeParams, ctx: ToolContext): Promise<AnalyzeResult> {
  const driver = ctx.drivers.get(params.sessionId)
  if (!driver) throw new Error(`Session ${params.sessionId} not found`)

  const snapshot = await driver.snapshot()

  // Default viewport if not provided
  const viewport: Viewport = {
    width: params.viewport?.width ?? 1280,
    height: params.viewport?.height ?? 800,
    devicePixelRatio: params.viewport?.devicePixelRatio ?? 1,
  }

  // Score elements
  const scores = scoreElements(snapshot.elements, viewport)

  // Find regions
  const regions = findRegions(scores, snapshot.elements)

  // Detect state
  const stateDetection = detectState(snapshot)

  // Top 10 elements by importance
  const topElements = scores.slice(0, 10).map(s => {
    const el = snapshot.elements.find(e => e.id === s.elementId)
    return {
      id: s.elementId,
      role: el?.role ?? 'unknown',
      label: el?.label ?? '',
      importance: Math.round(s.score * 1000) / 1000,
      bounds: el?.bounds ?? ([0, 0, 0, 0] as [number, number, number, number]),
    }
  })

  // Collect console errors from CDP driver if available
  const driverAny = driver as any
  const consoleErrors: Array<{ type: string; text: string; url?: string }> =
    driverAny.console?.getErrors
      ? driverAny.console.getErrors().map((e: any) => ({
          type: e.type,
          text: e.text,
          url: e.url,
        }))
      : []

  return {
    state: stateDetection.state,
    stateConfidence: Math.round(stateDetection.confidence * 1000) / 1000,
    regions: regions.map(r => ({
      label: r.label,
      score: Math.round(r.score * 1000) / 1000,
      bounds: r.bounds,
      elementCount: r.elements.length,
    })),
    topElements,
    totalElements: snapshot.elements.length,
    consoleErrors,
  }
}
