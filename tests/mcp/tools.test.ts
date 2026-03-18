import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleConnect } from '../../src/mcp/tools/connect.js'
import { handleSnapshot } from '../../src/mcp/tools/snapshot.js'
import type { ToolContext } from '../../src/mcp/context.js'
import type { SessionManager } from '../../src/core/session.js'
import type { CdpDriver } from '../../src/cdp/driver.js'
import type { Snapshot } from '../../src/core/types.js'

const mockSnapshot: Snapshot = {
  url: 'http://localhost:3000',
  platform: 'web',
  elements: [
    { id: 'e1', role: 'button', label: 'OK', value: null, enabled: true, focused: false, actions: ['press'], bounds: [0, 0, 80, 32], parent: null },
  ],
  timestamp: Date.now(),
}

function mockDriver(): CdpDriver {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue(mockSnapshot),
    act: vi.fn().mockResolvedValue({ success: true, snapshot: mockSnapshot }),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('PNG')),
    close: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
  } as unknown as CdpDriver
}

function mockContext(): ToolContext {
  return {
    sessions: {
      create: vi.fn().mockResolvedValue({
        id: 'abc123', name: 'test', platform: 'web',
        target: { url: 'http://localhost:3000' },
        steps: [], createdAt: Date.now(), updatedAt: Date.now(),
      }),
      addStep: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockReturnValue({
        id: 'abc123', name: 'test', platform: 'web',
        target: { url: 'http://localhost:3000' },
        steps: [], createdAt: Date.now(), updatedAt: Date.now(),
      }),
      list: vi.fn().mockReturnValue([]),
      close: vi.fn().mockResolvedValue(undefined),
      closeAll: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionManager,
    drivers: new Map(),
  }
}

describe('handleConnect', () => {
  it('creates a web session for URL targets', async () => {
    const ctx = mockContext()
    const driver = mockDriver()
    const result = await handleConnect(
      { target: 'http://localhost:3000', name: 'login' },
      ctx,
      () => driver,
    )

    expect(ctx.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'web',
      target: { url: 'http://localhost:3000' },
    }))
    expect(driver.connect).toHaveBeenCalledWith({ url: 'http://localhost:3000' })
    expect(result.sessionId).toBe('abc123')
    expect(result.platform).toBe('web')
    expect(result.snapshot).toContain('[e1] button "OK"')
  })

  it('detects macOS platform for app names', async () => {
    const ctx = mockContext()
    vi.mocked(ctx.sessions.create).mockResolvedValue({
      id: 'def456', name: 'safari', platform: 'macos',
      target: { appName: 'Safari' },
      steps: [], createdAt: Date.now(), updatedAt: Date.now(),
    })

    await handleConnect(
      { target: 'Safari' },
      ctx,
      () => mockDriver(),
    )

    expect(ctx.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'macos',
    }))
  })
})

describe('handleSnapshot', () => {
  it('returns compact AX tree', async () => {
    const ctx = mockContext()
    const driver = mockDriver()
    ctx.drivers.set('abc123', driver)

    const result = await handleSnapshot({ sessionId: 'abc123' }, ctx)

    expect(result.snapshot).toContain('[e1] button "OK"')
    expect(result.elementCount).toBe(1)
  })

  it('includes screenshot when requested', async () => {
    const ctx = mockContext()
    const driver = mockDriver()
    ctx.drivers.set('abc123', driver)

    const result = await handleSnapshot({ sessionId: 'abc123', screenshot: true }, ctx)

    expect(result.screenshot).toBeDefined()
    expect(driver.screenshot).toHaveBeenCalled()
  })

  it('throws for unknown session', async () => {
    const ctx = mockContext()
    await expect(handleSnapshot({ sessionId: 'unknown' }, ctx)).rejects.toThrow()
  })
})
