// Tests for the getPermissions screen-recording probe (previously hard-returned
// 'unknown' for everything except accessibility). Mocks the child_process boundary
// and the native compiler so the preflight binary's exit code is controllable, and
// asserts screen-recording resolves to granted/denied — explicitly NOT 'unknown'
// (the regression we fixed) — while automation/developer-tools stay 'unknown' by
// design (no daemon-safe probe). macOS-only path; skipped off darwin.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const onMac = process.platform === 'darwin'
const macIt = onMac ? it : it.skip

describe('getPermissions — screen-recording probe', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules() })

  async function coreWith(preflightSucceeds: boolean) {
    vi.doMock('node:child_process', () => ({
      execFile: (file: string, args: unknown, opts: unknown, cb: unknown) => {
        const callback = (typeof opts === 'function' ? opts : cb) as (err: Error | null, out?: { stdout: string; stderr: string }) => void
        if (file.includes('osascript')) return callback(null, { stdout: 'true\n', stderr: '' })
        if (file.includes('preflight')) {
          return preflightSucceeds ? callback(null, { stdout: '', stderr: '' }) : callback(new Error('screen recording not granted'))
        }
        return callback(null, { stdout: '', stderr: '' })
      },
      spawn: () => { throw new Error('spawn not expected in permission probe test') },
      spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
    }))
    vi.doMock('../../src/native/compiler.js', () => ({
      ensureScreenRecordingPreflightBinary: () => '/fake/bin/spectra-screen-recording-preflight',
      ensureBinary: () => '/fake/bin/spectra-native',
      ensureCompositeBinary: () => '/fake/bin/spectra-composite-capture',
    }))
    const { createDaemonCore } = await import('../../src/daemon/core.js')
    return createDaemonCore({})
  }

  macIt('reports screen-recording GRANTED when the preflight binary exits 0 (not unknown)', async () => {
    const core = await coreWith(true)
    const { permissions } = await core.getPermissions({})
    const sr = permissions.find((p) => p.permission === 'screen-recording')!
    expect(sr.state).toBe('granted')
    expect(sr.state).not.toBe('unknown') // the regression this fix closed
  })

  macIt('reports screen-recording DENIED when the preflight binary fails', async () => {
    const core = await coreWith(false)
    const { permissions } = await core.getPermissions({})
    const sr = permissions.find((p) => p.permission === 'screen-recording')!
    expect(sr.state).toBe('denied')
  })

  macIt('keeps automation/developer-tools as unknown by design (no daemon-safe probe — not faked)', async () => {
    const core = await coreWith(true)
    const { permissions } = await core.getPermissions({})
    expect(permissions.find((p) => p.permission === 'automation')!.state).toBe('unknown')
    expect(permissions.find((p) => p.permission === 'developer-tools')!.state).toBe('unknown')
  })
})
