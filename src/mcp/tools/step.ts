import type { ToolContext } from '../context.js'
import { resolve } from '../../core/resolve.js'
import { serializeSnapshot, serializeElement } from '../../core/serialize.js'
import { selectActionForElement } from '../../core/actions.js'
import type { CaptureRunCandidate, Element } from '../../core/types.js'

export interface StepParams {
  sessionId: string
  intent: string
}

export interface StepResult {
  snapshot: string
  candidates?: Array<{ id: string; role: string; label: string }>
  autoExecuted?: boolean
  action?: string
  actionReason?: string
  error?: string
  visionFallback?: boolean
  screenshot?: string
}

function toCandidate(element: Element): CaptureRunCandidate {
  return {
    id: element.id,
    role: element.role,
    label: element.label,
  }
}

export async function handleStep(params: StepParams, ctx: ToolContext): Promise<StepResult> {
  const driver = ctx.drivers.get(params.sessionId)
  if (!driver) throw new Error(`Session ${params.sessionId} not found`)

  const snap = await driver.snapshot()
  const resolved = resolve({ intent: params.intent, elements: snap.elements, mode: 'claude' })

  // High confidence → auto-execute
  if (resolved.confidence > 0.9 && !resolved.candidates) {
    const selected = selectActionForElement(resolved.element, {
      intent: params.intent,
      purpose: 'step',
    })
    if (!selected) {
      await ctx.sessions.addDecision(params.sessionId, {
        tool: 'spectra_step',
        plannerSource: 'host-agent',
        intent: params.intent,
        mode: 'claude',
        confidence: resolved.confidence,
        outcome: 'failed',
        selected: toCandidate(resolved.element),
        error: `No supported action found for ${serializeElement(resolved.element)}`,
      })
      return {
        snapshot: serializeSnapshot(snap),
        candidates: [{
          id: resolved.element.id,
          role: resolved.element.role,
          label: resolved.element.label,
        }],
        error: `No supported action found for ${serializeElement(resolved.element)}`,
      }
    }

    const decision = await ctx.sessions.addDecision(params.sessionId, {
      tool: 'spectra_step',
      plannerSource: 'host-agent',
      intent: params.intent,
      mode: 'claude',
      confidence: resolved.confidence,
      outcome: 'auto-executed',
      selected: toCandidate(resolved.element),
      action: {
        type: selected.action,
        elementId: resolved.element.id,
        value: selected.value,
      },
      actionReason: selected.reason,
    })

    const start = Date.now()
    const actResult = await driver.act(resolved.element.id, selected.action, selected.value)
    const duration = Date.now() - start
    const screenshot = await driver.screenshot()

    await ctx.sessions.addStep(params.sessionId, {
      action: { type: selected.action, elementId: resolved.element.id, value: selected.value },
      snapshotBefore: snap,
      snapshotAfter: actResult.snapshot,
      screenshot,
      success: actResult.success,
      error: actResult.error,
      duration,
      intent: params.intent,
      tool: 'spectra_step',
      plannerSource: 'host-agent',
      decisionId: decision.id,
    })

    return {
      snapshot: serializeSnapshot(actResult.snapshot),
      autoExecuted: true,
      action: `${selected.action} on ${serializeElement(resolved.element)}`,
      actionReason: selected.reason,
    }
  }

  // Low confidence or multiple candidates → return for Claude to pick
  const candidates = (resolved.candidates ?? [resolved.element]).map((el) => ({
    id: el.id,
    role: el.role,
    label: el.label,
  }))

  await ctx.sessions.addDecision(params.sessionId, {
    tool: 'spectra_step',
    plannerSource: 'host-agent',
    intent: params.intent,
    mode: 'claude',
    confidence: resolved.confidence,
    outcome: 'needs-host-decision',
    selected: resolved.element ? toCandidate(resolved.element) : undefined,
    candidates: (resolved.candidates ?? [resolved.element]).filter(Boolean).map(toCandidate),
    visionFallback: resolved.visionFallback,
  })

  const result: StepResult = {
    snapshot: serializeSnapshot(snap),
    candidates,
  }

  // Vision fallback: include screenshot so Claude can visually identify the target
  if (resolved.visionFallback) {
    result.visionFallback = true
    const buf = await driver.screenshot()
    result.screenshot = buf.toString('base64')
  }

  return result
}
