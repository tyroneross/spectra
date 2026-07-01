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
import { describe, expect, it, vi } from 'vitest'
import { resolveFocalRect, toFocalRect, windowBoundsBinaryPath } from '../../src/pipeline/window-focus.js'

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
    const prior = process.env.SPECTRA_WINDOW_BOUNDS_BIN
    process.env.SPECTRA_WINDOW_BOUNDS_BIN = '/tmp/custom-window-bounds'
    try {
      expect(windowBoundsBinaryPath()).toBe('/tmp/custom-window-bounds')
    } finally {
      if (prior === undefined) delete process.env.SPECTRA_WINDOW_BOUNDS_BIN
      else process.env.SPECTRA_WINDOW_BOUNDS_BIN = prior
    }
  })

  it('falls back to the default ~/.spectra/bin path when unset', () => {
    const prior = process.env.SPECTRA_WINDOW_BOUNDS_BIN
    delete process.env.SPECTRA_WINDOW_BOUNDS_BIN
    try {
      expect(windowBoundsBinaryPath()).toMatch(/\.spectra\/bin\/spectra-window-bounds$/)
    } finally {
      if (prior !== undefined) process.env.SPECTRA_WINDOW_BOUNDS_BIN = prior
    }
  })
})
