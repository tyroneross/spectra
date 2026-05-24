// tests/launcher/macos.test.ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { launchMacosApp } from '../../src/launcher/macos.js'
import { LauncherError, type DetectionResult } from '../../src/launcher/types.js'

interface FakeProc extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
}

function makeProc(): FakeProc {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  }) as FakeProc
}

const detection: DetectionResult = {
  kind: 'macos',
  xcodeTarget: '/tmp/MyApp.xcodeproj',
}

const FAKE_SETTINGS = `
Build settings for action build and target MyApp:
    ARCHS = arm64
    BUILT_PRODUCTS_DIR = /tmp/build/Debug
    EXECUTABLE_NAME = MyApp
    PRODUCT_NAME = MyApp
    WRAPPER_NAME = MyApp.app
    OBJROOT = /tmp/build
`

describe('launchMacosApp', () => {
  it('parses xcodebuild output and resolves to a .app path (dry run)', async () => {
    const proc = makeProc()
    const spawnFn = vi.fn(() => proc) as unknown as typeof import('node:child_process').spawn

    const p = launchMacosApp({ repoPath: '/tmp', detection, spawnFn, dryRun: true })
    setTimeout(() => {
      proc.stdout.emit('data', Buffer.from(FAKE_SETTINGS))
      proc.emit('exit', 0)
    }, 5)

    const handle = await p
    expect(handle.kind).toBe('macos')
    expect(handle.appName).toBe('MyApp')
    expect(handle.appPath).toBe('/tmp/build/Debug/MyApp.app')
    expect(handle.killOnDisconnect).toBe(false)
  })

  it('throws LauncherError if xcodebuild exits non-zero', async () => {
    const proc = makeProc()
    const spawnFn = vi.fn(() => proc) as unknown as typeof import('node:child_process').spawn

    const p = launchMacosApp({ repoPath: '/tmp', detection, spawnFn, dryRun: true })
    setTimeout(() => {
      proc.stderr.emit('data', Buffer.from('xcodebuild: error: invalid project'))
      proc.emit('exit', 65)
    }, 5)

    await expect(p).rejects.toThrow(LauncherError)
  })

  it('throws if BUILT_PRODUCTS_DIR is missing', async () => {
    const proc = makeProc()
    const spawnFn = vi.fn(() => proc) as unknown as typeof import('node:child_process').spawn

    const p = launchMacosApp({ repoPath: '/tmp', detection, spawnFn, dryRun: true })
    setTimeout(() => {
      proc.stdout.emit('data', Buffer.from('ARCHS = arm64\n'))
      proc.emit('exit', 0)
    }, 5)

    await expect(p).rejects.toThrow(/BUILT_PRODUCTS_DIR/)
  })

  it('handles .xcworkspace target', async () => {
    const wsDetection: DetectionResult = { kind: 'macos', xcodeTarget: '/tmp/Foo.xcworkspace' }
    let capturedArgs: string[] | null = null
    const proc = makeProc()
    const spawnFn = ((cmd: string, args: string[]) => {
      capturedArgs = args
      return proc
    }) as unknown as typeof import('node:child_process').spawn

    const p = launchMacosApp({ repoPath: '/tmp', detection: wsDetection, spawnFn, dryRun: true })
    setTimeout(() => {
      proc.stdout.emit('data', Buffer.from(FAKE_SETTINGS))
      proc.emit('exit', 0)
    }, 5)
    await p

    expect(capturedArgs).toEqual(['-workspace', '/tmp/Foo.xcworkspace', '-showBuildSettings'])
  })

  it('throws if detection lacks xcodeTarget', async () => {
    await expect(launchMacosApp({
      repoPath: '/tmp',
      detection: { kind: 'macos' },
      dryRun: true,
    })).rejects.toThrow(/xcodeTarget/)
  })
})
