import { describe, it, expect, beforeEach } from 'vitest'
import { prepareForCapture, restoreAfterCapture } from '../../src/media/clean.js'
import type { CleanState } from '../../src/media/clean.js'

// ─── Mock CDP Connection ──────────────────────────────────────────────────────

class MockCdpConnection {
  sent: Array<{ method: string; params: Record<string, unknown>; sessionId?: string }> = []

  async send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    this.sent.push({ method, params, sessionId })
    return {}
  }

  sentMethods(): string[] {
    return this.sent.map((s) => s.method)
  }

  callFor(method: string) {
    return this.sent.find((s) => s.method === method)
  }

  allCallsFor(method: string) {
    return this.sent.filter((s) => s.method === method)
  }
}

// ─── Mock command runner ──────────────────────────────────────────────────────

function makeCommandRunner() {
  const calls: Array<{ cmd: string; args: string[] }> = []
  const runner = async (cmd: string, args: string[]) => {
    calls.push({ cmd, args })
  }
  return { runner, calls }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('prepareForCapture — web', () => {
  let conn: MockCdpConnection
  const SESSION = 'session-1'

  beforeEach(() => {
    conn = new MockCdpConnection()
  })

  it('hides scrollbars by default', async () => {
    await prepareForCapture(conn as never, SESSION, 'web')
    const call = conn.callFor('Emulation.setScrollbarsHidden')
    expect(call).toBeDefined()
    expect(call!.params.hidden).toBe(true)
    expect(call!.sessionId).toBe(SESSION)
  })

  it('hides cursor via Runtime.evaluate by default', async () => {
    await prepareForCapture(conn as never, SESSION, 'web')
    const call = conn.callFor('Runtime.evaluate')
    expect(call).toBeDefined()
    expect(String(call!.params.expression)).toContain('cursor: none')
  })

  it('applies viewport override when provided', async () => {
    await prepareForCapture(conn as never, SESSION, 'web', {
      viewport: { width: 1280, height: 800 },
    })
    const call = conn.callFor('Emulation.setDeviceMetricsOverride')
    expect(call).toBeDefined()
    expect(call!.params.width).toBe(1280)
    expect(call!.params.height).toBe(800)
    expect(call!.params.deviceScaleFactor).toBe(2)
    expect(call!.params.mobile).toBe(false)
  })

  it('restores scrollbars after capture', async () => {
    const state = await prepareForCapture(conn as never, SESSION, 'web')
    await restoreAfterCapture(state)
    const calls = conn.allCallsFor('Emulation.setScrollbarsHidden')
    // First call: hide, second call: restore
    expect(calls).toHaveLength(2)
    expect(calls[0].params.hidden).toBe(true)
    expect(calls[1].params.hidden).toBe(false)
  })

  it('defaults hideScrollbars and hideCursor to true', async () => {
    const state = await prepareForCapture(conn as never, SESSION, 'web')
    expect(state.applied).toContain('hideScrollbars')
    expect(state.applied).toContain('hideCursor')
  })

  it('skips scrollbar cleanup when hideScrollbars: false', async () => {
    const state = await prepareForCapture(conn as never, SESSION, 'web', {
      hideScrollbars: false,
    })
    expect(state.applied).not.toContain('hideScrollbars')
    expect(conn.callFor('Emulation.setScrollbarsHidden')).toBeUndefined()
  })

  it('skips cursor cleanup when hideCursor: false', async () => {
    const state = await prepareForCapture(conn as never, SESSION, 'web', {
      hideCursor: false,
    })
    expect(state.applied).not.toContain('hideCursor')
    expect(conn.callFor('Runtime.evaluate')).toBeUndefined()
  })

  it('tracks all applied actions', async () => {
    const state = await prepareForCapture(conn as never, SESSION, 'web', {
      viewport: { width: 1440, height: 900 },
    })
    expect(state.applied).toContain('hideScrollbars')
    expect(state.applied).toContain('hideCursor')
    expect(state.applied).toContain('viewportOverride')
  })
})

describe('prepareForCapture — iOS', () => {
  it('overrides status bar with clean values', async () => {
    const { runner, calls } = makeCommandRunner()
    const state = await prepareForCapture(null, null, 'ios', { commandRunner: runner })

    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('xcrun')
    expect(calls[0].args).toContain('status_bar')
    expect(calls[0].args).toContain('override')
    expect(calls[0].args).toContain('9:41')
    expect(state.applied).toContain('cleanStatusBar')
  })

  it('restores status bar to default after capture', async () => {
    const { runner, calls } = makeCommandRunner()
    const state = await prepareForCapture(null, null, 'ios', { commandRunner: runner })
    await restoreAfterCapture(state)

    expect(calls).toHaveLength(2)
    expect(calls[1].args).toContain('clear')
  })

  it('skips status bar cleanup when cleanStatusBar: false', async () => {
    const { runner, calls } = makeCommandRunner()
    const state = await prepareForCapture(null, null, 'ios', {
      commandRunner: runner,
      cleanStatusBar: false,
    })
    expect(calls).toHaveLength(0)
    expect(state.applied).not.toContain('cleanStatusBar')
  })
})

describe('prepareForCapture — watchOS', () => {
  it('overrides status bar for watchOS', async () => {
    const { runner, calls } = makeCommandRunner()
    await prepareForCapture(null, null, 'watchos', { commandRunner: runner })
    expect(calls).toHaveLength(1)
  })
})

describe('prepareForCapture — macOS', () => {
  it('returns empty applied list — no actions needed', async () => {
    const state = await prepareForCapture(null, null, 'macos')
    expect(state.applied).toHaveLength(0)
    expect(state.restoreActions).toHaveLength(0)
  })
})

describe('restoreAfterCapture', () => {
  it('continues restoring when one action throws', async () => {
    const executed: number[] = []

    const state: CleanState = {
      platform: 'web',
      applied: ['a', 'b', 'c'],
      restoreActions: [
        async () => { executed.push(0) },
        async () => { throw new Error('restore failed') },
        async () => { executed.push(2) },
      ],
    }

    // Should not throw
    await expect(restoreAfterCapture(state)).resolves.toBeUndefined()

    // Actions run in reverse; the failing one is skipped but others execute
    expect(executed).toContain(0)
    expect(executed).toContain(2)
  })

  it('executes restore actions in reverse order', async () => {
    const order: number[] = []
    const state: CleanState = {
      platform: 'web',
      applied: ['a', 'b', 'c'],
      restoreActions: [
        async () => { order.push(0) },
        async () => { order.push(1) },
        async () => { order.push(2) },
      ],
    }

    await restoreAfterCapture(state)
    expect(order).toEqual([2, 1, 0])
  })
})
