import { describe, it, expect, vi, beforeEach } from 'vitest'
import { waitForEvent, waitForStable } from '../../src/cdp/wait.js'
import type { CdpConnection } from '../../src/cdp/connection.js'
import type { Element } from '../../src/core/types.js'

function makeEl(role: string, label: string, actions = ['press']): Element {
  return {
    id: 'e1', role, label, value: null, enabled: true, focused: false,
    actions, bounds: [0, 0, 0, 0], parent: null,
  }
}

/**
 * Minimal mock of CdpConnection — captures on/off registrations
 * so tests can trigger events manually.
 */
function mockConnection() {
  const handlers = new Map<string, Set<(params: unknown) => void>>()

  const conn = {
    on: vi.fn((event: string, handler: (params: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    }),
    off: vi.fn((event: string, handler: (params: unknown) => void) => {
      handlers.get(event)?.delete(handler)
    }),
    emit: (event: string, params?: unknown) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(params ?? {})
      }
    },
  } as unknown as CdpConnection & { emit: (event: string, params?: unknown) => void }

  return { conn, handlers }
}

describe('waitForEvent', () => {
  it('resolves when the event fires', async () => {
    const { conn } = mockConnection()

    // Fire the event after a short delay
    setTimeout(() => (conn as unknown as { emit: (e: string) => void }).emit('Page.loadEventFired'), 20)

    await expect(
      waitForEvent(conn, 'Page.loadEventFired', { timeout: 1000 }),
    ).resolves.toBeUndefined()
  })

  it('rejects with timeout error when event never fires', async () => {
    const { conn } = mockConnection()

    await expect(
      waitForEvent(conn, 'Page.loadEventFired', { timeout: 50 }),
    ).rejects.toThrow('Timed out waiting for Page.loadEventFired after 50ms')
  })

  it('cleans up handler after resolving', async () => {
    const { conn } = mockConnection()
    const connAny = conn as unknown as { emit: (e: string) => void }

    setTimeout(() => connAny.emit('Page.loadEventFired'), 10)
    await waitForEvent(conn, 'Page.loadEventFired', { timeout: 500 })

    // off should have been called once to clean up
    expect(conn.off).toHaveBeenCalledWith('Page.loadEventFired', expect.any(Function))
  })

  it('cleans up handler after timeout', async () => {
    const { conn } = mockConnection()

    await expect(
      waitForEvent(conn, 'SomeEvent', { timeout: 30 }),
    ).rejects.toThrow()

    expect(conn.off).toHaveBeenCalledWith('SomeEvent', expect.any(Function))
  })
})

describe('waitForStable', () => {
  it('resolves when fingerprint stabilizes after event', async () => {
    const { conn } = mockConnection()
    const connAny = conn as unknown as { emit: (e: string) => void }

    const stableElements = [makeEl('button', 'Submit')]
    const getSnapshot = vi.fn().mockResolvedValue(stableElements)

    // Fire an update event shortly after start, then let it stabilize
    setTimeout(() => connAny.emit('Accessibility.nodesUpdated'), 30)

    const result = await waitForStable(conn, getSnapshot, {
      timeout: 2000,
      stableTime: 100,
    })

    expect(result.timedOut).toBe(false)
    expect(result.elements).toEqual(stableElements)
  })

  it('resolves immediately when already stable (no events needed)', async () => {
    const { conn } = mockConnection()

    const elements = [makeEl('button', 'OK')]
    const getSnapshot = vi.fn().mockResolvedValue(elements)

    const result = await waitForStable(conn, getSnapshot, {
      timeout: 2000,
      stableTime: 80,
    })

    expect(result.timedOut).toBe(false)
    expect(result.elements).toEqual(elements)
  })

  it('returns timedOut:true when fingerprint never stabilizes', async () => {
    const { conn } = mockConnection()
    const connAny = conn as unknown as { emit: (e: string) => void }

    let counter = 0
    const getSnapshot = vi.fn().mockImplementation(async () => {
      counter++
      // Keep firing events to prevent stabilization
      setTimeout(() => connAny.emit('Accessibility.nodesUpdated'), 5)
      return [makeEl('button', `changing-${counter}`)]
    })

    const result = await waitForStable(conn, getSnapshot, {
      timeout: 200,
      stableTime: 150,
    })

    expect(result.timedOut).toBe(true)
  })

  it('uses custom eventName when provided', async () => {
    const { conn } = mockConnection()
    const connAny = conn as unknown as { emit: (e: string) => void }

    const elements = [makeEl('button', 'Done')]
    const getSnapshot = vi.fn().mockResolvedValue(elements)

    setTimeout(() => connAny.emit('Page.frameNavigated'), 20)

    const result = await waitForStable(conn, getSnapshot, {
      timeout: 2000,
      stableTime: 80,
      eventName: 'Page.frameNavigated',
    })

    // Should have registered on the custom event name
    expect(conn.on).toHaveBeenCalledWith('Page.frameNavigated', expect.any(Function))
    expect(result.timedOut).toBe(false)
  })

  it('cleans up event handler in finally block (even on timeout)', async () => {
    const { conn } = mockConnection()

    let counter = 0
    const getSnapshot = vi.fn().mockImplementation(async () => {
      return [makeEl('button', `state-${counter++}`)]
    })

    await waitForStable(conn, getSnapshot, {
      timeout: 100,
      stableTime: 200, // stableTime > timeout → always times out
    })

    expect(conn.off).toHaveBeenCalledWith('Accessibility.nodesUpdated', expect.any(Function))
  })
})
