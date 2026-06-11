import type { ToolContext } from '../context.js'
import type { ActionType } from '../../core/types.js'
import { serializeSnapshot } from '../../core/serialize.js'

export interface ActParams {
  sessionId: string
  elementId: string
  action: string
  value?: string
}

export interface ActResult {
  success: boolean
  error?: string
  snapshot: string
}

export async function handleAct(params: ActParams, ctx: ToolContext): Promise<ActResult> {
  const driver = ctx.drivers.get(params.sessionId)
  if (!driver) throw new Error(`Session ${params.sessionId} not found`)

  const session = ctx.sessions.get(params.sessionId)
  const snapshotBefore = await driver.snapshot()
  const startTime = Date.now()
  const selectedElement = snapshotBefore.elements.find((el) => el.id === params.elementId)

  const decision = session
    ? await ctx.sessions.addDecision(params.sessionId, {
      tool: 'spectra_act',
      plannerSource: 'manual',
      outcome: 'manual',
      selected: {
        id: params.elementId,
        role: selectedElement?.role ?? 'unknown',
        label: selectedElement?.label ?? params.elementId,
      },
      action: {
        type: params.action as ActionType,
        elementId: params.elementId,
        value: params.value,
      },
    })
    : null

  const result = await driver.act(params.elementId, params.action as ActionType, params.value)

  // Record step
  if (session) {
    const screenshot = await driver.screenshot()
    await ctx.sessions.addStep(params.sessionId, {
      action: { type: params.action as ActionType, elementId: params.elementId, value: params.value },
      snapshotBefore,
      snapshotAfter: result.snapshot,
      screenshot,
      success: result.success,
      error: result.error,
      duration: Date.now() - startTime,
      tool: 'spectra_act',
      plannerSource: 'manual',
      decisionId: decision?.id,
    })
  }

  return {
    success: result.success,
    error: result.error,
    snapshot: serializeSnapshot(result.snapshot),
  }
}
