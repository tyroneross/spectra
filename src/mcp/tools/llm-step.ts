// src/mcp/tools/llm-step.ts
//
// `spectra_llm_step` — execute a fully-formed action plan against a session.
//
// Designed for the "planner: 'client'" path: the Swift menu-bar app (which
// holds the user's Anthropic key) builds an `ActionPlan[]` from a single LLM
// turn, POSTs it here, and the daemon executes each step in order without
// ever touching the API key. Failures don't roll back (the UI side has no
// transactional model); they short-circuit with the partial result so the
// caller can decide whether to keep going.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import type { ToolContext } from '../context.js'
import type { ActionType } from '../../core/types.js'
import { serializeSnapshot } from '../../core/serialize.js'

export interface ActionPlanStep {
  /** What kind of action the LLM decided on. */
  type: ActionType
  /** Element ID resolved by the planner against the most-recent snapshot. */
  elementId: string
  /** For 'type' actions, the text to enter. */
  value?: string
  /** Optional rationale string, recorded into the session step for replay. */
  intent?: string
  /** Optional ms wait AFTER the action, before snapshotting. Defaults to 0. */
  waitAfterMs?: number
}

export interface LlmStepParams {
  sessionId: string
  actions: ActionPlanStep[]
  /**
   * If true, the executor continues past a single failing step (best-effort).
   * Default false — short-circuit on first error.
   */
  continueOnError?: boolean
}

export interface LlmStepResult {
  sessionId: string
  stepsExecuted: number
  stepsTotal: number
  success: boolean
  results: Array<{
    index: number
    intent?: string
    type: ActionType
    elementId: string
    success: boolean
    error?: string
    durationMs: number
  }>
  /** Final snapshot after the last executed step. Serialized text form. */
  finalSnapshot?: string
}

export async function handleLlmStep(
  params: LlmStepParams,
  ctx: ToolContext,
): Promise<LlmStepResult> {
  if (!params.sessionId) {
    throw new Error('sessionId is required')
  }
  if (!Array.isArray(params.actions) || params.actions.length === 0) {
    throw new Error('actions must be a non-empty array')
  }
  const driver = ctx.drivers.get(params.sessionId)
  if (!driver) {
    throw new Error(`Session ${params.sessionId} not found`)
  }

  const session = ctx.sessions.get(params.sessionId)
  const results: LlmStepResult['results'] = []
  let lastSnapshotSerialized: string | undefined
  let overallSuccess = true

  for (let i = 0; i < params.actions.length; i++) {
    const step = params.actions[i]
    const startedAt = Date.now()

    // Snapshot before each step so element IDs resolved by the LLM against an
    // older snapshot would have been mapped consistently. (The Swift app is
    // expected to plan against the most-recent snapshot it has; the driver
    // resolves elementId against current DOM/AX state regardless.)
    let snapshotBefore
    try {
      snapshotBefore = await driver.snapshot()
    } catch (err) {
      results.push({
        index: i,
        intent: step.intent,
        type: step.type,
        elementId: step.elementId,
        success: false,
        error: `snapshot before step failed: ${(err as Error).message}`,
        durationMs: Date.now() - startedAt,
      })
      overallSuccess = false
      if (!params.continueOnError) break
      else continue
    }

    let actResult
    try {
      actResult = await driver.act(step.elementId, step.type, step.value)
    } catch (err) {
      results.push({
        index: i,
        intent: step.intent,
        type: step.type,
        elementId: step.elementId,
        success: false,
        error: (err as Error).message,
        durationMs: Date.now() - startedAt,
      })
      overallSuccess = false
      if (!params.continueOnError) break
      else continue
    }

    if (step.waitAfterMs && step.waitAfterMs > 0) {
      await new Promise(resolve => setTimeout(resolve, step.waitAfterMs))
    }

    // Persist as a Session.Step so reveal/Save lands the screenshot.
    if (session && actResult.success) {
      try {
        const screenshot = await driver.screenshot()
        await ctx.sessions.addStep(params.sessionId, {
          action: { type: step.type, elementId: step.elementId, value: step.value },
          snapshotBefore,
          snapshotAfter: actResult.snapshot,
          screenshot,
          success: actResult.success,
          error: actResult.error,
          duration: Date.now() - startedAt,
          intent: step.intent,
        })
      } catch {
        // Persistence failures shouldn't fail the action.
      }
    }

    lastSnapshotSerialized = serializeSnapshot(actResult.snapshot)
    results.push({
      index: i,
      intent: step.intent,
      type: step.type,
      elementId: step.elementId,
      success: actResult.success,
      error: actResult.error,
      durationMs: Date.now() - startedAt,
    })

    if (!actResult.success) {
      overallSuccess = false
      if (!params.continueOnError) break
    }
  }

  return {
    sessionId: params.sessionId,
    stepsExecuted: results.length,
    stepsTotal: params.actions.length,
    success: overallSuccess,
    results,
    finalSnapshot: lastSnapshotSerialized,
  }
}
