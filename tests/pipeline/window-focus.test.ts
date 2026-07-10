// tests/pipeline/window-focus.test.ts
//
// Unit tests for the auto-focal-window helper (window-focus.ts). Uses the
// injectable `runBinary` hook rather than spawning the real
// spectra-window-bounds native binary -- deterministic, no GUI session or
// compiled Swift artifact required. Covers: successful resolution (both
// normalized and absolute-pixel binary output, rescaled to the capture
// canvas), the app/title CLI arg passthrough, and graceful `undefined`
// fallback for a missing binary, a non-zero exit (no matching window), and
// unparseable output.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveFocalRect, toFocalRect, windowBoundsBinaryPath } from '../../src/pipeline/window-focus.js'

const HELPER_ENV_KEYS = [
  'SPECTRA_HELPER_MODE',
  'SPECTRA_APP_BUNDLE_HELPERS_DIR',
  'SPECTRA_APP_BUNDLE_PATH',
  'SPECTRA_WINDOW_BOUNDS_BIN',
] as const

let priorEnv: Partial<Record<(typeof HELPER_ENV_KEYS)[number], string>>
let tempDirs: string[]

function tempDirectory(prefix: string): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  tempDirs.push(path)
  return path
}

beforeEach(() => {
  priorEnv = {}
  tempDirs = []
  for (const key of HELPER_ENV_KEYS) {
    if (process.env[key] !== undefined) priorEnv[key] = process.env[key]
    delete process.env[key]
  }
  process.env.SPECTRA_HELPER_MODE = 'development'
})

afterEach(() => {
  for (const key of HELPER_ENV_KEYS) {
    const prior = priorEnv[key]
    if (prior === undefined) delete process.env[key]
    else process.env[key] = prior
  }
  for (const path of tempDirs) rmSync(path, { recursive: true, force: true })
})

describe('resolveFocalRect', () => {
  it('converts normalized (0..1) binary output into a pixel FocalRect scaled to the canvas', async () => {
    const runBinary = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ x: 0.25, y: 0.5, w: 0.5, h: 0.25, normalized: true }),
    }))

    const focal = await resolveFocalRect({ canvas: { w: 1000, h: 800 }, runBinary })

    expect(focal).toEqual({ x: 250, y: 400, w: 500, h: 200 })
  })

  it('rescales absolute-pixel binary output from its source screen size to the capture canvas', async () => {
    const runBinary = vi.fn(() => ({
      status: 0,
      // Source screen is 1512x982 (a typical MacBook Pro logical size);
      // capture canvas is a 1920x1080 recording -- bounds must rescale.
      stdout: JSON.stringify({ x: 756, y: 491, w: 756, h: 491, screenW: 1512, screenH: 982, normalized: false }),
    }))

    const focal = await resolveFocalRect({ canvas: { w: 1920, h: 1080 }, runBinary })

    expect(focal).toEqual({ x: 960, y: 540, w: 960, h: 540 })
  })

  it('passes --app and --title through to the binary invocation', async () => {
    const runBinary = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ x: 0, y: 0, w: 100, h: 100, screenW: 100, screenH: 100 }),
    }))

    await resolveFocalRect({ app: 'Safari', title: 'GitHub', canvas: { w: 100, h: 100 }, runBinary })

    expect(runBinary).toHaveBeenCalledWith(expect.any(String), ['--app', 'Safari', '--title', 'GitHub'])
  })

  it('omits --app/--title when no filters are given (frontmost-window auto-detect)', async () => {
    const runBinary = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ x: 0, y: 0, w: 100, h: 100, screenW: 100, screenH: 100 }),
    }))

    await resolveFocalRect({ canvas: { w: 100, h: 100 }, runBinary })

    expect(runBinary).toHaveBeenCalledWith(expect.any(String), [])
  })

  it('returns undefined when the binary is missing / throws (graceful fallback)', async () => {
    const runBinary = vi.fn(() => {
      throw new Error('ENOENT: spawn spectra-window-bounds')
    })

    const focal = await resolveFocalRect({ canvas: { w: 100, h: 100 }, runBinary })

    expect(focal).toBeUndefined()
  })

  it('propagates strict bundle-resolution failures before invoking the runner', async () => {
    const helpersDir = tempDirectory('spectra-window-helper-')
    process.env.SPECTRA_HELPER_MODE = 'bundle'
    process.env.SPECTRA_APP_BUNDLE_HELPERS_DIR = helpersDir
    const runBinary = vi.fn(() => ({ status: 0, stdout: '{}' }))

    await expect(resolveFocalRect({ canvas: { w: 100, h: 100 }, runBinary }))
      .rejects.toThrow('spectra-window-bounds')
    expect(runBinary).not.toHaveBeenCalled()
  })

  it('returns undefined when the binary exits non-zero (e.g. no matching window found)', async () => {
    const runBinary = vi.fn(() => ({ status: 65, stdout: '' }))

    const focal = await resolveFocalRect({ canvas: { w: 100, h: 100 }, runBinary })

    expect(focal).toBeUndefined()
  })

  it('returns undefined when the binary emits unparseable output', async () => {
    const runBinary = vi.fn(() => ({ status: 0, stdout: 'not json' }))

    const focal = await resolveFocalRect({ canvas: { w: 100, h: 100 }, runBinary })

    expect(focal).toBeUndefined()
  })

  it('returns undefined when stdout is empty even on a zero exit status', async () => {
    const runBinary = vi.fn(() => ({ status: 0, stdout: '   ' }))

    const focal = await resolveFocalRect({ canvas: { w: 100, h: 100 }, runBinary })

    expect(focal).toBeUndefined()
  })
})

describe('toFocalRect', () => {
  it('clamps a rect that would overflow the canvas', () => {
    const focal = toFocalRect(
      { x: 0.9, y: 0.9, w: 0.5, h: 0.5, normalized: true },
      { w: 200, h: 100 },
    )
    expect(focal).toBeDefined()
    expect(focal!.x + focal!.w).toBeLessThanOrEqual(200)
    expect(focal!.y + focal!.h).toBeLessThanOrEqual(100)
  })

  it('returns undefined for non-finite or non-positive dimensions', () => {
    expect(toFocalRect({ x: 0, y: 0, w: Number.NaN, h: 10 }, { w: 100, h: 100 })).toBeUndefined()
    expect(toFocalRect({ x: 0, y: 0, w: 0, h: 10 }, { w: 100, h: 100 })).toBeUndefined()
    expect(toFocalRect({ x: 0, y: 0, w: -5, h: 10 }, { w: 100, h: 100 })).toBeUndefined()
  })
})

describe('windowBoundsBinaryPath', () => {
  it('honors the SPECTRA_WINDOW_BOUNDS_BIN env override', () => {
    process.env.SPECTRA_WINDOW_BOUNDS_BIN = process.execPath
    expect(windowBoundsBinaryPath()).toBe(process.execPath)
  })

  it('falls back to the default ~/.spectra/bin path when unset', () => {
    expect(windowBoundsBinaryPath()).toMatch(/\.spectra\/bin\/spectra-window-bounds$/)
  })

  it('resolves the exact executable from an authoritative bundle', () => {
    const helpersDir = tempDirectory('spectra-window-helper-')
    const helper = join(helpersDir, 'spectra-window-bounds')
    writeFileSync(helper, '#!/bin/sh\nexit 0\n')
    chmodSync(helper, 0o755)
    process.env.SPECTRA_HELPER_MODE = 'bundle'
    process.env.SPECTRA_APP_BUNDLE_HELPERS_DIR = helpersDir

    expect(windowBoundsBinaryPath()).toBe(helper)
  })

  it('fails closed when the configured bundle helper is not executable', () => {
    const helpersDir = tempDirectory('spectra-window-helper-')
    writeFileSync(join(helpersDir, 'spectra-window-bounds'), 'not executable')
    process.env.SPECTRA_HELPER_MODE = 'bundle'
    process.env.SPECTRA_APP_BUNDLE_HELPERS_DIR = helpersDir

    expect(() => windowBoundsBinaryPath()).toThrow('spectra-window-bounds')
  })
})
