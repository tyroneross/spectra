// tests/mcp/llm-step.test.ts
//
// Unit tests for handleLlmStep. Drives a MockDriver through a pre-formed
// action plan and asserts step-by-step results, session persistence, and
// short-circuit-on-error behavior.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import { describe, it, expect, vi } from 'vitest'
import { handleLlmStep } from '../../src/mcp/tools/llm-step.js'
import type { ToolContext } from '../../src/mcp/context.js'
import type { SessionManager } from '../../src/core/session.js'
import type { Driver, Snapshot, ActionType, ActResult, DriverTarget } from '../../src/core/types.js'

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/core/storage.js', () => ({
  getStoragePath: vi.fn().mockReturnValue('/tmp/spectra'),
}))

const SESSION_ID = 'test-session-llm'

function makeSnapshot(): Snapshot {
  return {
    platform: 'web',
    url: 'http://localhost:3000',
    elements: [
      { id: 'e1', role: 'button', label: 'Login', value: null, enabled: true,
        focused: false, actions: ['press'], bounds: [0, 0, 80, 32], parent: null },
      { id: 'e2', role: 'textfield', label: 'Email', value: null, enabled: true,
        focused: false, actions: ['type'], bounds: [0, 40, 200, 32], parent: null },
    ],
    timestamp: Date.now(),
  }
}

class MockDriver implements Driver {
  public snapshotCallCount = 0
  public actCallCount = 0
  public screenshotCallCount = 0
  public actCalls: Array<{ elementId: string; action: ActionType; value?: string }> = []
  private failIndices: Set<number>
  private failCounter = 0

  constructor(options: { failOnActIndex?: number[] } = {}) {
    this.failIndices = new Set(options.failOnActIndex ?? [])
  }

  async connect(_target: DriverTarget): Promise<void> {}
  async snapshot(): Promise<Snapshot> { this.snapshotCallCount++; return makeSnapshot() }

  async act(elementId: string, action: ActionType, value?: string): Promise<ActResult> {
    const i = this.failCounter++
    this.actCallCount++
    this.actCalls.push({ elementId, action, value })
    if (this.failIndices.has(i)) {
      return { success: false, snapshot: makeSnapshot(), error: `intentional failure at ${i}` }
    }
    return { success: true, snapshot: makeSnapshot() }
  }

  async screenshot(): Promise<Buffer> {
    this.screenshotCallCount++
    return Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
      '2e0000000c4944415408d7636060600000000400017f18dd8a0000000049454e44ae426082',
      'hex',
    )
  }

  async navigate(_url: string): Promise<void> {}
  async close(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

function makeContext(driver: Driver | null = new MockDriver()): ToolContext {
  const sessionData = {
    id: SESSION_ID, name: 'test', platform: 'web' as const,
    target: { url: 'http://localhost:3000' },
    steps: [], createdAt: Date.now(), updatedAt: Date.now(),
  }
  const sessions = {
    create: vi.fn().mockResolvedValue(sessionData),
    addStep: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockReturnValue(sessionData),
    list: vi.fn().mockReturnValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    closeAll: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionManager
  const drivers = new Map<string, Driver>()
  if (driver) drivers.set(SESSION_ID, driver)
  return { sessions, drivers, launches: new Map() }
}

describe('handleLlmStep', () => {

  it('rejects empty actions', async () => {
    const ctx = makeContext()
    await expect(
      handleLlmStep({ sessionId: SESSION_ID, actions: [] }, ctx)
    ).rejects.toThrow('actions must be a non-empty array')
  })

  it('rejects missing session', async () => {
    const ctx = makeContext(null)
    await expect(
      handleLlmStep({ sessionId: SESSION_ID, actions: [
        { type: 'click', elementId: 'e1' },
      ] }, ctx)
    ).rejects.toThrow(`Session ${SESSION_ID} not found`)
  })

  it('executes a 3-step plan in order, returns per-step results', async () => {
    const driver = new MockDriver()
    const ctx = makeContext(driver)

    const result = await handleLlmStep({
      sessionId: SESSION_ID,
      actions: [
        { type: 'click', elementId: 'e1', intent: 'click Login' },
        { type: 'type', elementId: 'e2', value: 'foo@bar.com', intent: 'enter email' },
        { type: 'click', elementId: 'e1', intent: 'submit' },
      ],
    }, ctx)

    expect(result.success).toBe(true)
    expect(result.stepsExecuted).toBe(3)
    expect(result.stepsTotal).toBe(3)
    expect(result.results.map(r => r.elementId)).toEqual(['e1', 'e2', 'e1'])
    expect(result.results.map(r => r.success)).toEqual([true, true, true])
    expect(driver.actCallCount).toBe(3)
    expect(driver.actCalls[1].value).toBe('foo@bar.com')
    expect(result.finalSnapshot).toBeDefined()
  })

  it('short-circuits on first failure by default', async () => {
    const driver = new MockDriver({ failOnActIndex: [1] })
    const ctx = makeContext(driver)

    const result = await handleLlmStep({
      sessionId: SESSION_ID,
      actions: [
        { type: 'click', elementId: 'e1' },
        { type: 'click', elementId: 'e1' },
        { type: 'click', elementId: 'e1' },
      ],
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.stepsExecuted).toBe(2)
    expect(result.results[1].success).toBe(false)
    expect(result.results[1].error).toContain('intentional failure')
    expect(driver.actCallCount).toBe(2) // third never ran
  })

  it('continues past failure when continueOnError=true', async () => {
    const driver = new MockDriver({ failOnActIndex: [1] })
    const ctx = makeContext(driver)

    const result = await handleLlmStep({
      sessionId: SESSION_ID,
      actions: [
        { type: 'click', elementId: 'e1' },
        { type: 'click', elementId: 'e1' },
        { type: 'click', elementId: 'e1' },
      ],
      continueOnError: true,
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.stepsExecuted).toBe(3)
    expect(result.results.map(r => r.success)).toEqual([true, false, true])
    expect(driver.actCallCount).toBe(3)
  })

  it('persists successful steps via SessionManager.addStep', async () => {
    const driver = new MockDriver()
    const ctx = makeContext(driver)

    await handleLlmStep({
      sessionId: SESSION_ID,
      actions: [
        { type: 'click', elementId: 'e1', intent: 'click thing' },
      ],
    }, ctx)

    expect(ctx.sessions.addStep).toHaveBeenCalledTimes(1)
    const call = (ctx.sessions.addStep as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe(SESSION_ID)
    expect(call[1].action.type).toBe('click')
    expect(call[1].intent).toBe('click thing')
    expect(call[1].success).toBe(true)
  })

  it('honors waitAfterMs between steps', async () => {
    const driver = new MockDriver()
    const ctx = makeContext(driver)
    const start = Date.now()

    await handleLlmStep({
      sessionId: SESSION_ID,
      actions: [
        { type: 'click', elementId: 'e1', waitAfterMs: 50 },
        { type: 'click', elementId: 'e1', waitAfterMs: 50 },
      ],
    }, ctx)

    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(95) // 2 × 50ms minus slack
  })
})
