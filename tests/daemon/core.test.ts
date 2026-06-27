import { describe, expect, it } from 'vitest'
import { API_VERSION } from '../../src/contract/wire.js'
import { createDaemonCore } from '../../src/daemon/core.js'
import { eventEnvelope, formatSseFrame, sseFrame, successEnvelope } from '../../src/daemon/envelope.js'
import type { KeepAwakeController } from '../../src/daemon/keep-awake.js'

class FakeKeepAwake implements KeepAwakeController {
  readonly events: string[] = []
  private readonly recordings = new Set<string>()

  get activeRecordings(): number {
    return this.recordings.size
  }

  get engaged(): boolean {
    return this.recordings.size > 0
  }

  async recordingStarted(recordingId: string): Promise<void> {
    this.events.push(`start:${recordingId}`)
    this.recordings.add(recordingId)
  }

  async recordingStopped(recordingId: string): Promise<void> {
    this.events.push(`stop:${recordingId}`)
    this.recordings.delete(recordingId)
  }

  async close(): Promise<void> {
    this.events.push('close')
    this.recordings.clear()
  }
}

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

  it('records composite video through the daemon worker with keep-awake bracketing', async () => {
    const keepAwake = new FakeKeepAwake()
    const core = createDaemonCore({
      keepAwake,
      recordCompositeWorker: async () => {
        expect(keepAwake.activeRecordings).toBe(1)
        expect(keepAwake.engaged).toBe(true)
        return {
          ok: true,
          output: '/tmp/out.mp4',
          command: '/tmp/spectra-composite-capture --out /tmp/out.mp4',
          blackFrameGuard: {
            sampleCount: 3,
            meanLuma: 72,
            allBlack: false,
            skipped: false,
          },
          warnings: [],
        }
      },
    })

    const result = await core.recordComposite({
      appA: 'Codex',
      appB: 'Chrome',
      outPath: '/tmp/out.mp4',
    })

    expect(result).toMatchObject({
      ok: true,
      output: '/tmp/out.mp4',
      blackFrameGuard: { meanLuma: 72, allBlack: false },
    })
    expect(keepAwake.events[0]).toMatch(/^start:composite-/)
    expect(keepAwake.events[1]).toMatch(/^stop:composite-/)
    expect(keepAwake.activeRecordings).toBe(0)
  })

  it('stops daemon keep-awake when the composite worker fails', async () => {
    const keepAwake = new FakeKeepAwake()
    const core = createDaemonCore({
      keepAwake,
      recordCompositeWorker: async () => {
        throw new Error('worker failed')
      },
    })

    await expect(core.recordComposite({
      appA: 'Codex',
      appB: 'Chrome',
      outPath: '/tmp/out.mp4',
    })).rejects.toMatchObject({
      code: 'recording_failed',
      status: 500,
    })
    expect(keepAwake.events).toHaveLength(2)
    expect(keepAwake.activeRecordings).toBe(0)
  })

  it('returns typed composite permission failures with keep-awake bracketing', async () => {
    const keepAwake = new FakeKeepAwake()
    const core = createDaemonCore({
      keepAwake,
      recordCompositeWorker: async () => ({
        ok: false,
        command: '/tmp/spectra-composite-capture --out /tmp/out.mp4',
        blackFrameGuard: {
          sampleCount: 0,
          meanLuma: null,
          allBlack: false,
          skipped: true,
        },
        warnings: [],
        error: 'Screen Recording not granted to Spectra.',
        errorCode: 'permission_denied',
        hint: 'Enable Screen Recording for the signed Spectra daemon helper in System Settings > Privacy & Security > Screen Recording, then retry.',
        details: {
          nativeCode: 'screen_recording_not_granted',
          permission: 'screen-recording',
        },
        retryable: false,
      }),
    })

    const result = await core.recordComposite({
      appA: 'Codex',
      appB: 'Chrome',
      outPath: '/tmp/out.mp4',
    })

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'permission_denied',
      error: 'Screen Recording not granted to Spectra.',
      details: {
        nativeCode: 'screen_recording_not_granted',
        permission: 'screen-recording',
      },
    })
    expect(keepAwake.events[0]).toMatch(/^start:composite-/)
    expect(keepAwake.events[1]).toMatch(/^stop:composite-/)
    expect(keepAwake.activeRecordings).toBe(0)
  })

  it('does not wire daemon start/stop recording to the legacy full-display path', async () => {
    const core = createDaemonCore()

    await expect(core.startRecording({ sessionId: 's' })).rejects.toMatchObject({
      code: 'recording_failed',
      status: 501,
    })
    await expect(core.stopRecording({ sessionId: 's' })).rejects.toMatchObject({
      code: 'recording_failed',
      status: 501,
    })
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
