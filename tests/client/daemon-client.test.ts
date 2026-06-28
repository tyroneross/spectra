// tests/client/daemon-client.test.ts
//
// Headless tests for the unix-socket DaemonClient against the mock daemon.
// Covers: contract round-trip, client-side param validation, daemon error
// envelopes, the fail-open ladder (probe → bootstrap → re-probe → actionable
// error), and the CGS_REQUIRE_INIT re-framing guard.

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DaemonClient,
  DaemonError,
  RECORD_COMPOSITE_TIMEOUT_BUFFER_MS,
  timeoutForOperation,
} from '../../src/client/daemon-client.js'
import { startMockDaemon, type MockDaemon } from '../helpers/mock-daemon.js'
import type { HealthResult } from '../../src/contract/core-api.js'

let daemon: MockDaemon | undefined

afterEach(async () => {
  await daemon?.close().catch(() => {})
  daemon = undefined
})

describe('DaemonClient — contract round-trip', () => {
  it('forwards health and parses the success envelope', async () => {
    daemon = await startMockDaemon()
    const client = new DaemonClient({ socketPath: daemon.socketPath, surface: 'test' })
    const health = await client.call<HealthResult>('health', {})
    expect(health.apiVersion).toBe(2)
    expect(health.windowServer.connected).toBe(true)
    expect(daemon.calls[0]).toMatchObject({ operation: 'health' })
  })

  it('forwards createSession params intact over the socket', async () => {
    daemon = await startMockDaemon()
    const client = new DaemonClient({ socketPath: daemon.socketPath, surface: 'test' })
    const res = await client.call<{ sessionId: string }>('createSession', { target: 'http://localhost:3000', name: 'demo' })
    expect(res.sessionId).toBe('mock-session-1')
    expect(daemon.calls[0].params).toMatchObject({ target: 'http://localhost:3000', name: 'demo' })
  })

  it('strips undefined params before sending', async () => {
    daemon = await startMockDaemon()
    const client = new DaemonClient({ socketPath: daemon.socketPath, surface: 'test' })
    await client.call('snapshot', { sessionId: 's1', screenshot: undefined })
    expect(daemon.calls[0].params).toEqual({ sessionId: 's1' })
  })

  it('isUp() is true when the daemon answers, false when down', async () => {
    daemon = await startMockDaemon()
    const client = new DaemonClient({ socketPath: daemon.socketPath, surface: 'test', probeTimeoutMs: 500 })
    expect(await client.isUp()).toBe(true)
    await daemon.close()
    daemon = undefined
    expect(await client.isUp()).toBe(false)
  })

  it('scales recordComposite timeout by requested duration plus encode buffer', () => {
    expect(timeoutForOperation('health', {}, 30_000)).toBe(30_000)
    expect(timeoutForOperation('recordComposite', {
      appA: 'Chrome',
      appB: 'Ghostty',
      outPath: '/tmp/out.mp4',
      durationSeconds: 15,
    }, 30_000)).toBe(15_000 + RECORD_COMPOSITE_TIMEOUT_BUFFER_MS)
    expect(timeoutForOperation('recordComposite', {
      appA: 'Chrome',
      appB: 'Ghostty',
      outPath: '/tmp/out.mp4',
      durationSeconds: 15,
      async: true,
    }, 30_000)).toBe(30_000)
  })
})

describe('DaemonClient — validation + error envelopes', () => {
  it('rejects invalid params client-side with an actionable DaemonError', async () => {
    daemon = await startMockDaemon()
    const client = new DaemonClient({ socketPath: daemon.socketPath, surface: 'test' })
    // createSession requires `target`.
    await expect(client.call('createSession', {})).rejects.toMatchObject({
      name: 'DaemonError',
      code: 'bad_request',
      actionable: true,
    })
    // Nothing should have reached the daemon.
    expect(daemon.calls.length).toBe(0)
  })

  it('surfaces a daemon error envelope as a DaemonError with code + hint', async () => {
    daemon = await startMockDaemon({
      handlers: {
        snapshot: () => ({ ok: false, status: 404, code: 'not_found', message: 'Session "x" not found', hint: 'List sessions first.' }),
      },
    })
    const client = new DaemonClient({ socketPath: daemon.socketPath, surface: 'test' })
    await expect(client.call('snapshot', { sessionId: 'x' })).rejects.toMatchObject({
      name: 'DaemonError',
      code: 'not_found',
      hint: 'List sessions first.',
    })
  })

  it('re-frames a raw CGS_REQUIRE_INIT error into an actionable hint', async () => {
    daemon = await startMockDaemon({
      handlers: {
        screenshot: () => ({ ok: false, status: 500, code: 'internal_error', message: 'capture failed: CGS_REQUIRE_INIT' }),
      },
    })
    const client = new DaemonClient({ socketPath: daemon.socketPath, surface: 'test' })
    try {
      await client.call('screenshot', { sessionId: 's1' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DaemonError)
      const de = err as DaemonError
      expect(de.code).toBe('daemon_unhealthy')
      expect(de.message).not.toContain('CGS_REQUIRE_INIT')
      expect(de.hint).toMatch(/menu-bar app/i)
    }
  })
})

describe('DaemonClient — fail-open ladder', () => {
  it('throws actionable daemon_down when the socket is unreachable and no bootstrap', async () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'spectra-down-')), 'nope.sock')
    const client = new DaemonClient({ socketPath: missing, surface: 'test', probeTimeoutMs: 300 })
    try {
      await client.call('health', {})
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DaemonError)
      const de = err as DaemonError
      expect(de.code).toBe('daemon_down')
      expect(de.retryable).toBe(true)
      expect(de.hint).toMatch(/menu-bar app|spectra daemon/i)
    }
  })

  it('invokes bootstrap once and succeeds after the daemon comes up', async () => {
    const socketPath = join(mkdtempSync(join(tmpdir(), 'spectra-boot-')), 'daemon.sock')
    let bootstrapCalls = 0
    const client = new DaemonClient({
      socketPath,
      surface: 'test',
      probeTimeoutMs: 500,
      bootstrap: async () => {
        bootstrapCalls += 1
        daemon = await startMockDaemon({ socketPath })
        return true
      },
    })
    const health = await client.call<HealthResult>('health', {})
    expect(health.apiVersion).toBe(2)
    expect(bootstrapCalls).toBe(1)
  })

  it('does not invoke bootstrap when the daemon is already up', async () => {
    daemon = await startMockDaemon()
    let bootstrapCalls = 0
    const client = new DaemonClient({
      socketPath: daemon.socketPath,
      surface: 'test',
      bootstrap: async () => { bootstrapCalls += 1; return true },
    })
    await client.call('health', {})
    expect(bootstrapCalls).toBe(0)
  })
})
