// tests/launcher/web.test.ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { launchWebDevServer } from '../../src/launcher/web.js'
import { LauncherError, type DetectionResult } from '../../src/launcher/types.js'

interface FakeProc extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  killed: boolean
  exitCode: number | null
  pid: number
  kill(signal?: string): boolean
}

function makeFakeProc(): FakeProc {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    killed: false,
    exitCode: null as number | null,
    pid: 12345,
    kill(_signal?: string) { this.killed = true; this.exitCode = 0; this.emit('exit', 0, null); return true },
  }) as FakeProc
  return proc
}

const nextDetection: DetectionResult = {
  kind: 'web-next',
  startCommand: ['npm', 'run', 'dev'],
}

describe('launchWebDevServer', () => {
  it('resolves the URL printed on stdout', async () => {
    const proc = makeFakeProc()
    const spawnFn = vi.fn(() => proc) as unknown as typeof import('node:child_process').spawn

    const promise = launchWebDevServer({ repoPath: '/tmp/x', detection: nextDetection, spawnFn })
    // Emit a Next.js-style line
    setTimeout(() => {
      proc.stdout.emit('data', Buffer.from('  - Local:        http://localhost:3000\n'))
    }, 5)

    const handle = await promise
    expect(handle.url).toBe('http://localhost:3000')
    expect(handle.kind).toBe('web-next')
    expect(handle.pid).toBe(12345)
    expect(handle.killOnDisconnect).toBe(true)

    // Cleanup
    await handle.kill()
    expect(proc.killed).toBe(true)
  })

  it('handles URL printed via stderr', async () => {
    const proc = makeFakeProc()
    const spawnFn = vi.fn(() => proc) as unknown as typeof import('node:child_process').spawn

    const promise = launchWebDevServer({ repoPath: '/tmp/x', detection: nextDetection, spawnFn })
    setTimeout(() => proc.stderr.emit('data', Buffer.from('listening on http://localhost:5173\n')), 5)

    const handle = await promise
    expect(handle.url).toBe('http://localhost:5173')
  })

  it('times out if no URL appears', async () => {
    const proc = makeFakeProc()
    const spawnFn = vi.fn(() => proc) as unknown as typeof import('node:child_process').spawn

    const p = launchWebDevServer({
      repoPath: '/tmp/x',
      detection: nextDetection,
      spawnFn,
      timeoutMs: 50,
    })
    setTimeout(() => proc.stdout.emit('data', Buffer.from('compiling...\n')), 5)

    await expect(p).rejects.toThrow(LauncherError)
    expect(proc.killed).toBe(true)
  })

  it('rejects if the dev server exits before binding', async () => {
    const proc = makeFakeProc()
    const spawnFn = vi.fn(() => proc) as unknown as typeof import('node:child_process').spawn

    const p = launchWebDevServer({ repoPath: '/tmp/x', detection: nextDetection, spawnFn })
    setTimeout(() => proc.emit('exit', 1, null), 5)

    await expect(p).rejects.toThrow(/exited before binding/)
  })

  it('rejects if spawn errors', async () => {
    const proc = makeFakeProc()
    const spawnFn = vi.fn(() => proc) as unknown as typeof import('node:child_process').spawn

    const p = launchWebDevServer({ repoPath: '/tmp/x', detection: nextDetection, spawnFn })
    setTimeout(() => proc.emit('error', new Error('ENOENT')), 5)

    await expect(p).rejects.toThrow(/ENOENT/)
  })

  it('throws on missing startCommand', async () => {
    await expect(launchWebDevServer({
      repoPath: '/tmp/x',
      detection: { kind: 'web-next', startCommand: [] },
    })).rejects.toThrow(LauncherError)
  })
})
