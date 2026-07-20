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
      ensureCursorSamplerBinary: () => '/fake/bin/spectra-cursor-sampler',
      SCREEN_RECORDING_PREFLIGHT_PATH: '/fake/bin/spectra-screen-recording-preflight',
      DAEMON_LAUNCHER_PATH: '/fake/bin/spectra-daemon-launcher',
    }))
    vi.doMock('../../src/native/signing.js', () => ({
      recordGrant: () => {},
      assessGrantStaleness: () => ({ stale: false }),
      clearRegrantMarker: () => {},
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

// Staleness diagnosis: a DENIED screen-recording probe whose helper cdhash
// changed since the grant is reported as `grant_stale_rebuild` (with an
// actionable message), not a bare `denied`. The signing module is mocked so the
// path is deterministic and needs no real TCC access or codesign.
describe('getPermissions — grant_stale_rebuild diagnosis', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules() })

  async function coreWith(opts: { preflightSucceeds: boolean; stale: boolean }) {
    vi.doMock('node:child_process', () => ({
      execFile: (file: string, args: unknown, o: unknown, cb: unknown) => {
        const callback = (typeof o === 'function' ? o : cb) as (err: Error | null, out?: { stdout: string; stderr: string }) => void
        if (file.includes('osascript')) return callback(null, { stdout: 'true\n', stderr: '' })
        if (file.includes('preflight')) {
          return opts.preflightSucceeds ? callback(null, { stdout: '', stderr: '' }) : callback(new Error('denied'))
        }
        return callback(null, { stdout: '', stderr: '' })
      },
      spawn: () => { throw new Error('spawn not expected') },
      spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
    }))
    vi.doMock('../../src/native/compiler.js', () => ({
      ensureScreenRecordingPreflightBinary: () => '/fake/bin/spectra-screen-recording-preflight',
      ensureBinary: () => '/fake/bin/spectra-native',
      ensureCompositeBinary: () => '/fake/bin/spectra-composite-capture',
      ensureCursorSamplerBinary: () => '/fake/bin/spectra-cursor-sampler',
      SCREEN_RECORDING_PREFLIGHT_PATH: '/fake/bin/spectra-screen-recording-preflight',
      DAEMON_LAUNCHER_PATH: '/fake/bin/spectra-daemon-launcher',
    }))
    const recordGrant = vi.fn()
    const clearRegrantMarker = vi.fn()
    vi.doMock('../../src/native/signing.js', () => ({
      recordGrant,
      clearRegrantMarker,
      assessGrantStaleness: () => (opts.stale
        ? { stale: true, grantedCdhash: 'aaa', currentCdhash: 'bbb' }
        : { stale: false }),
    }))
    const { createDaemonCore } = await import('../../src/daemon/core.js')
    return { core: createDaemonCore({}), recordGrant, clearRegrantMarker }
  }

  const onMac = process.platform === 'darwin'
  const macIt = onMac ? it : it.skip

  macIt('denied + rebuilt-since-grant → staleness grant_stale_rebuild with a message', async () => {
    const { core } = await coreWith({ preflightSucceeds: false, stale: true })
    const { permissions } = await core.getPermissions({})
    const sr = permissions.find((p) => p.permission === 'screen-recording')!
    expect(sr.state).toBe('denied')
    expect(sr.staleness).toBe('grant_stale_rebuild')
    expect(sr.message).toMatch(/rebuilt/i)
  })

  macIt('denied but no prior grant → plain denied, no staleness', async () => {
    const { core } = await coreWith({ preflightSucceeds: false, stale: false })
    const { permissions } = await core.getPermissions({})
    const sr = permissions.find((p) => p.permission === 'screen-recording')!
    expect(sr.state).toBe('denied')
    expect(sr.staleness).toBeUndefined()
    expect(sr.message).toBeUndefined()
  })

  macIt('granted → records the grant, clears the re-grant marker, no staleness', async () => {
    const { core, recordGrant, clearRegrantMarker } = await coreWith({ preflightSucceeds: true, stale: false })
    const { permissions } = await core.getPermissions({})
    const sr = permissions.find((p) => p.permission === 'screen-recording')!
    expect(sr.state).toBe('granted')
    expect(sr.staleness).toBeUndefined()
    expect(recordGrant).toHaveBeenCalledWith('screen-recording', '/fake/bin/spectra-screen-recording-preflight')
    expect(clearRegrantMarker).toHaveBeenCalled()
  })
})
