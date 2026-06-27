import { describe, expect, it } from 'vitest'
import { API_VERSION } from '../../src/contract/wire.js'
import { createDaemonCore } from '../../src/daemon/core.js'
import { eventEnvelope, formatSseFrame, sseFrame, successEnvelope } from '../../src/daemon/envelope.js'

describe('daemon core', () => {
  it('reports versioned daemon health with structured permission states', async () => {
    const core = createDaemonCore({
      startedAt: 123,
      daemonVersion: '0.3.2',
      healthProbe: {
        aquaSessionProbe: async () => true,
        windowServerProbe: async () => ({ connected: true }),
      },
    })

    const health = await core.health({ includePermissions: true })

    expect(health).toMatchObject({
      ok: true,
      apiVersion: API_VERSION,
      daemonVersion: expect.any(String),
      startedAt: 123,
      aquaSession: true,
      windowServer: { connected: true },
    })
    expect(health.permissions).toHaveLength(4)
    expect(health.permissions).toEqual([
      expect.objectContaining({
        permission: 'accessibility',
        state: expect.stringMatching(/^(granted|denied|not-determined|restricted|unsupported|unknown)$/),
        requiredFor: expect.any(Array),
        canPrompt: expect.any(Boolean),
        lastCheckedAt: expect.any(Number),
      }),
      expect.objectContaining({
        permission: 'screen-recording',
        state: expect.stringMatching(/^(granted|denied|not-determined|restricted|unsupported|unknown)$/),
        requiredFor: expect.any(Array),
        canPrompt: expect.any(Boolean),
        lastCheckedAt: expect.any(Number),
      }),
      expect.objectContaining({
        permission: 'automation',
        state: expect.stringMatching(/^(granted|denied|not-determined|restricted|unsupported|unknown)$/),
        requiredFor: expect.any(Array),
        canPrompt: expect.any(Boolean),
        lastCheckedAt: expect.any(Number),
      }),
      expect.objectContaining({
        permission: 'developer-tools',
        state: expect.stringMatching(/^(granted|denied|not-determined|restricted|unsupported|unknown)$/),
        requiredFor: expect.any(Array),
        canPrompt: expect.any(Boolean),
        lastCheckedAt: expect.any(Number),
      }),
    ])
  })

  it('delegates empty session listing through the shared context', async () => {
    const core = createDaemonCore()

    await expect(core.listSessions()).resolves.toEqual({ sessions: [] })
  })
})

describe('daemon envelopes', () => {
  it('wraps successful API results with apiVersion and request identity', () => {
    const envelope = successEnvelope(
      {
        apiVersion: API_VERSION,
        requestId: 'req-1',
        operation: 'listSessions',
      },
      { sessions: [] },
      { timestamp: 456, deliveryPath: 'test' },
    )

    expect(envelope).toEqual({
      apiVersion: API_VERSION,
      requestId: 'req-1',
      ok: true,
      result: { sessions: [] },
      timestamp: 456,
      caller: undefined,
      deliveryPath: 'test',
    })
  })

  it('builds SSE frames from daemon events', () => {
    const envelope = eventEnvelope(
      {
        type: 'session.closed',
        sessionId: 'sess-1',
        data: { sessionId: 'sess-1' },
      },
      { eventId: 'evt-1', timestamp: 789 },
    )
    const frame = sseFrame(envelope, 1000)

    expect(frame).toEqual({
      event: 'session.closed',
      id: 'evt-1',
      data: envelope,
      retry: 1000,
    })
    expect(formatSseFrame(frame)).toContain('event: session.closed')
    expect(formatSseFrame(frame)).toContain('"sessionId":"sess-1"')
  })
})
