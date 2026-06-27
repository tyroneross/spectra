// tests/media/composite-layout.test.ts
import { describe, it, expect } from 'vitest'
import { computeSplitLayout } from '../../src/media/composite-layout.js'
import type { CompositeLayout } from '../../src/media/pipeline.js'

describe('computeSplitLayout', () => {
  it('splits an even-width display into two equal halves', () => {
    const layout = computeSplitLayout(2560, 1440)
    expect(layout.left).toEqual({ x: 0, y: 0, width: 1280, height: 1440 })
    expect(layout.right).toEqual({ x: 1280, y: 0, width: 1280, height: 1440 })
  })

  it('keeps sum-width == display width with no overlap on odd widths', () => {
    const layout = computeSplitLayout(2561, 1440)
    expect(layout.left.width + layout.right.width).toBe(2561) // exact sum invariant
    expect(layout.right.x).toBe(layout.left.x + layout.left.width) // no gap, no overlap
    expect(layout.left.height).toBe(layout.right.height) // hstack-safe equal heights
  })

  it('floors fractional dimensions to integer pixels', () => {
    const layout = computeSplitLayout(1920.6, 1080.9)
    expect(layout.left.height).toBe(1080)
    expect(layout.left.width + layout.right.width).toBe(1920)
    expect(Number.isInteger(layout.left.width)).toBe(true)
    expect(Number.isInteger(layout.right.width)).toBe(true)
  })

  it('returns operator override rects verbatim', () => {
    const override: CompositeLayout = {
      left: { x: 10, y: 20, width: 800, height: 600 },
      right: { x: 900, y: 40, width: 850, height: 600 },
    }
    expect(computeSplitLayout(2560, 1440, override)).toBe(override)
  })

  it('rejects degenerate display dimensions', () => {
    expect(() => computeSplitLayout(1, 1080)).toThrow()
    expect(() => computeSplitLayout(Number.NaN, 1080)).toThrow()
    expect(() => computeSplitLayout(1920, 0)).toThrow()
  })
})
