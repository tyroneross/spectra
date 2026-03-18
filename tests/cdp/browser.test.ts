import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BrowserManager, findChrome, CHROME_PATHS } from '../../src/cdp/browser.js'

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    stderr: { on: vi.fn() },
    stdout: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}))

// Mock fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn((path: string) => false),
}))

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
}))

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

describe('findChrome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(existsSync).mockReturnValue(false)
  })

  it('returns first existing Chrome path', () => {
    vi.mocked(existsSync).mockImplementation((p: string) =>
      p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    )
    expect(findChrome()).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  })

  it('returns null when no Chrome found', () => {
    expect(findChrome()).toBeNull()
  })

  it('checks all known paths', () => {
    findChrome()
    expect(existsSync).toHaveBeenCalledTimes(CHROME_PATHS.length)
  })
})

describe('BrowserManager', () => {
  let manager: BrowserManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new BrowserManager()
  })

  describe('launch', () => {
    it('throws if Chrome not found', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      await expect(manager.launch()).rejects.toThrow('Chrome not found')
    })

    it('spawns Chrome with correct args when headless', async () => {
      vi.mocked(existsSync).mockReturnValue(true)

      // Mock fetch for waitForDebugger
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error('not ready'))
        .mockResolvedValueOnce({
          json: () => Promise.resolve({
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc',
          }),
        })
      vi.stubGlobal('fetch', mockFetch)

      const wsUrl = await manager.launch({ headless: true, port: 9222 })

      expect(spawn).toHaveBeenCalledOnce()
      const args = vi.mocked(spawn).mock.calls[0][1] as string[]
      expect(args).toContain('--remote-debugging-port=9222')
      expect(args).toContain('--headless=new')
      expect(args).toContain('--no-first-run')
      expect(wsUrl).toBe('ws://127.0.0.1:9222/devtools/browser/abc')
    })

    it('uses random ephemeral port when none specified', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          webSocketDebuggerUrl: 'ws://127.0.0.1:54321/devtools/browser/abc',
        }),
      }))

      await manager.launch()

      const args = vi.mocked(spawn).mock.calls[0][1] as string[]
      const portArg = args.find((a: string) => a.startsWith('--remote-debugging-port='))!
      const port = parseInt(portArg.split('=')[1])
      expect(port).toBeGreaterThanOrEqual(49152)
      expect(port).toBeLessThanOrEqual(65535)
    })

    it('spawns Chrome without --headless when headless=false', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc',
        }),
      }))

      await manager.launch({ headless: false, port: 9222 })

      const args = vi.mocked(spawn).mock.calls[0][1] as string[]
      expect(args).not.toContain('--headless=new')
    })
  })

  describe('close', () => {
    it('kills the Chrome process', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc',
        }),
      }))

      await manager.launch({ port: 9222 })
      await manager.close()

      const mockProcess = vi.mocked(spawn).mock.results[0].value
      expect(mockProcess.kill).toHaveBeenCalled()
    })
  })
})
