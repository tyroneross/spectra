import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: childProcessMocks.execFile,
  spawn: childProcessMocks.spawn,
  spawnSync: childProcessMocks.spawnSync,
}))

const onMac = process.platform === 'darwin'
const macIt = onMac ? it : it.skip
const HELPER_ENV_KEYS = [
  'SPECTRA_HELPER_MODE',
  'SPECTRA_APP_BUNDLE_HELPERS_DIR',
  'SPECTRA_APP_BUNDLE_PATH',
  'SPECTRA_NATIVE_HELPER_PATH',
  'SPECTRA_CURSOR_SAMPLER_PATH',
  'SPECTRA_WINDOW_BOUNDS_BIN',
] as const

let priorEnv: Partial<Record<(typeof HELPER_ENV_KEYS)[number], string>>
let tempDirs: string[]

function tempDirectory(prefix: string): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  tempDirs.push(path)
  return path
}

function writeExecutable(path: string): void {
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
}

beforeEach(() => {
  priorEnv = {}
  tempDirs = []
  for (const key of HELPER_ENV_KEYS) {
    if (process.env[key] !== undefined) priorEnv[key] = process.env[key]
    delete process.env[key]
  }
  vi.resetModules()
})

afterEach(() => {
  vi.doUnmock('../../src/native/compiler.js')
  vi.restoreAllMocks()
  childProcessMocks.execFile.mockReset()
  childProcessMocks.spawn.mockReset()
  childProcessMocks.spawnSync.mockReset()
  vi.resetModules()
  for (const key of HELPER_ENV_KEYS) {
    const prior = priorEnv[key]
    if (prior === undefined) delete process.env[key]
    else process.env[key] = prior
  }
  for (const path of tempDirs) rmSync(path, { recursive: true, force: true })
})

describe('privacy helper process boundaries', () => {
  macIt('passes --no-request at both TypeScript status preflight boundaries', async () => {
    const execFileMock = childProcessMocks.execFile.mockImplementation((
      file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, output?: { stdout: string; stderr: string }) => void,
    ) => {
      if (file.includes('preflight')) callback(null, { stdout: '', stderr: '' })
      else callback(null, { stdout: 'true\n', stderr: '' })
    })
    const spawnSyncMock = childProcessMocks.spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '' })
    vi.doMock('../../src/native/compiler.js', () => ({
      ensureBinary: () => '/fake/bundle/spectra-native',
      ensureCompositeBinary: () => '/fake/bundle/spectra-composite-capture',
      ensureCursorSamplerBinary: () => '/fake/bundle/spectra-cursor-sampler',
      ensureScreenRecordingPreflightBinary: () => '/fake/bundle/spectra-screen-recording-preflight',
      ensureWindowBoundsBinary: () => '/fake/bundle/spectra-window-bounds',
      WINDOW_BOUNDS_BINARY_PATH: '/fake/bundle/spectra-window-bounds',
    }))

    const { createDaemonCore } = await import('../../src/daemon/core.js')
    const core = createDaemonCore({})
    try {
      await core.getPermissions({ permissions: ['screen-recording'] })
      expect(execFileMock).toHaveBeenCalledWith(
        '/fake/bundle/spectra-screen-recording-preflight',
        ['--no-request'],
        expect.objectContaining({ timeout: 2_000 }),
        expect.any(Function),
      )

      const { recordCompositeWithWorker } = await import('../../src/daemon/composite-worker.js')
      await recordCompositeWithWorker({
        appA: 'Safari',
        appB: 'Notes',
        outPath: '/tmp/privacy-routing-composite.mp4',
      })
      expect(spawnSyncMock).toHaveBeenCalledWith(
        '/fake/bundle/spectra-screen-recording-preflight',
        ['--no-request'],
        expect.objectContaining({ encoding: 'utf8' }),
      )
    } finally {
      await core.close()
    }
  })

  it('routes cursor and window-bounds through authoritative bundle paths', async () => {
    const helpersDir = tempDirectory('spectra-routing-helpers-')
    const cursorPath = join(helpersDir, 'spectra-cursor-sampler')
    const windowBoundsPath = join(helpersDir, 'spectra-window-bounds')
    writeExecutable(cursorPath)
    writeExecutable(windowBoundsPath)
    process.env.SPECTRA_HELPER_MODE = 'bundle'
    process.env.SPECTRA_APP_BUNDLE_HELPERS_DIR = helpersDir

    const { CoreApiImplementation } = await import('../../src/daemon/core-impl.js')
    class RoutingCore extends CoreApiImplementation {
      readonly cursorCalls: Array<{ binaryPath: string; args: string[] }> = []

      protected override spawnCursorSampler(binaryPath: string, args: string[]): ChildProcess {
        this.cursorCalls.push({ binaryPath, args })
        const child = new EventEmitter() as EventEmitter & Partial<ChildProcess>
        child.pid = 4242
        child.exitCode = 0
        child.signalCode = null
        child.kill = () => true
        return child as ChildProcess
      }

      startCursorForTest(sessionDir: string): void {
        this.startCursorSampler(
          this.ensureCursorSamplerBinary(),
          'recording-routing',
          sessionDir,
          30,
          300,
        )
      }
    }

    const core = new RoutingCore()
    core.startCursorForTest(helpersDir)
    expect(core.cursorCalls).toEqual([{
      binaryPath: cursorPath,
      args: [
        '--duration', '300',
        '--fps', '30',
        '--out', join(helpersDir, 'recording-routing.cursor.json'),
      ],
    }])

    const { resolveFocalRect } = await import('../../src/pipeline/window-focus.js')
    const runBinary = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ x: 0, y: 0, w: 1, h: 1, normalized: true }),
    }))
    await resolveFocalRect({ canvas: { w: 100, h: 100 }, runBinary })
    expect(runBinary).toHaveBeenCalledWith(windowBoundsPath, [])
  })

  it('selects explicit bootstrap modes without bypassing the dual-agent guard', async () => {
    const root = tempDirectory('spectra-bootstrap-routing-')
    const helpersDir = join(root, 'Spectra.app', 'Contents', 'Helpers')
    mkdirSync(helpersDir, { recursive: true })
    const daemonEntry = join(root, 'daemon-entry.js')
    writeFileSync(daemonEntry, 'process.exit(0)\n')
    process.env.SPECTRA_HELPER_MODE = 'development'
    process.env.SPECTRA_APP_BUNDLE_HELPERS_DIR = helpersDir

    const unref = vi.fn()
    const spawnMock = childProcessMocks.spawn.mockReturnValue({ unref })
    const { spawnDaemonBootstrap, resolveFlipTopologyPlistPath } = await import('../../src/client/bootstrap.js')
    const client = { isUp: async () => false } as Parameters<typeof spawnDaemonBootstrap>[0]
    const unguardedHome = join(root, 'unguarded-home')
    mkdirSync(unguardedHome, { recursive: true })

    await spawnDaemonBootstrap(client, {
      daemonEntry,
      readyTimeoutMs: 0,
      flipGuardHomeDir: unguardedHome,
    })()
    expect(spawnMock).toHaveBeenLastCalledWith(
      process.execPath,
      [daemonEntry],
      expect.objectContaining({
        env: expect.objectContaining({ SPECTRA_HELPER_MODE: 'development' }),
      }),
    )

    writeExecutable(join(helpersDir, 'spectra-daemon-launcher'))
    await spawnDaemonBootstrap(client, {
      daemonEntry,
      readyTimeoutMs: 0,
      flipGuardHomeDir: unguardedHome,
    })()
    expect(spawnMock).toHaveBeenLastCalledWith(
      process.execPath,
      [daemonEntry],
      expect.objectContaining({
        env: expect.objectContaining({ SPECTRA_HELPER_MODE: 'development' }),
      }),
    )

    delete process.env.SPECTRA_HELPER_MODE
    await spawnDaemonBootstrap(client, {
      daemonEntry,
      readyTimeoutMs: 0,
      flipGuardHomeDir: unguardedHome,
    })()
    expect(spawnMock).toHaveBeenLastCalledWith(
      join(helpersDir, 'spectra-daemon-launcher'),
      ['--node', process.execPath, '--script', daemonEntry],
      expect.objectContaining({
        env: expect.objectContaining({
          SPECTRA_HELPER_MODE: 'bundle',
          SPECTRA_APP_BUNDLE_HELPERS_DIR: helpersDir,
          SPECTRA_NATIVE_HELPER_PATH: join(helpersDir, 'spectra-native'),
          SPECTRA_CURSOR_SAMPLER_PATH: join(helpersDir, 'spectra-cursor-sampler'),
          SPECTRA_WINDOW_BOUNDS_BIN: join(helpersDir, 'spectra-window-bounds'),
        }),
      }),
    )

    const guardedHome = join(root, 'guarded-home')
    const plistPath = resolveFlipTopologyPlistPath(guardedHome)
    mkdirSync(join(guardedHome, 'Library', 'LaunchAgents'), { recursive: true })
    writeFileSync(plistPath, '<plist/>')
    spawnMock.mockClear()
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await spawnDaemonBootstrap(client, {
      daemonEntry,
      readyTimeoutMs: 0,
      flipGuardHomeDir: guardedHome,
    })()
    expect(spawnMock).not.toHaveBeenCalled()
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('refusing to self-spawn'))
  })
})
