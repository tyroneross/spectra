import type { ToolContext } from '../context.js'
import { resolve } from '../../core/resolve.js'
import { serializeSnapshot, serializeElement } from '../../core/serialize.js'

export interface StepParams {
  sessionId: string
  intent: string
}

export interface StepResult {
  snapshot: string
  candidates?: Array<{ id: string; role: string; label: string }>
  autoExecuted?: boolean
  action?: string
  error?: string
}

export async function handleStep(params: StepParams, ctx: ToolContext): Promise<StepResult> {
  const driver = ctx.drivers.get(params.sessionId)
  if (!driver) throw new Error(`Session ${params.sessionId} not found`)

  const snap = await driver.snapshot()
  const resolved = resolve({ intent: params.intent, elements: snap.elements, mode: 'claude' })

  // High confidence → auto-execute
  if (resolved.confidence > 0.9 && !resolved.candidates) {
    const actionType = inferActionFromIntent(params.intent)
    const value = extractValue(params.intent)
    const actResult = await driver.act(resolved.element.id, actionType, value)

    return {
      snapshot: serializeSnapshot(actResult.snapshot),
      autoExecuted: true,
      action: `${actionType} on ${serializeElement(resolved.element)}`,
    }
  }

  // Low confidence or multiple candidates → return for Claude to pick
  const candidates = (resolved.candidates ?? [resolved.element]).map((el) => ({
    id: el.id,
    role: el.role,
    label: el.label,
  }))

  return {
    snapshot: serializeSnapshot(snap),
    candidates,
  }
}

function inferActionFromIntent(intent: string): 'click' | 'type' | 'clear' | 'scroll' | 'hover' | 'focus' | 'select' {
  const lower = intent.toLowerCase()
  if (lower.includes('type') || lower.includes('enter') || lower.includes('fill')) return 'type'
  if (lower.includes('clear')) return 'clear'
  if (lower.includes('scroll')) return 'scroll'
  if (lower.includes('hover')) return 'hover'
  return 'click'
}

function extractValue(intent: string): string | undefined {
  const match = intent.match(/"([^"]+)"/)
  return match?.[1]
}
