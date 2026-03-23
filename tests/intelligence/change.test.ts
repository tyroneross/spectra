import { describe, it, expect } from 'vitest'
import { perceptualHash, hashDistance, diffSnapshots, detectChange } from '../../src/intelligence/change.js'
import { encodePng } from '../../src/media/png.js'
import type { RawImage } from '../../src/media/png.js'
import type { Snapshot, Element } from '../../src/core/types.js'

// ─── Helpers ─────────────────────────────────────────────────

function makeTestPng(width: number, height: number, r: number, g: number, b: number): Buffer {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return encodePng({ width, height, data })
}

// Gradient image: pixel brightness increases left-to-right, producing non-trivial dHash bits.
// Two gradients with opposite directions will have maximally different hashes.
function makeGradientPng(width: number, height: number, leftToRight: boolean): Buffer {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = leftToRight ? x / (width - 1) : 1 - x / (width - 1)
      const v = Math.round(t * 255)
      const i = (y * width + x) * 4
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return encodePng({ width, height, data })
}

function makeElement(overrides: Partial<Element> & { role: string; label: string }): Element {
  return {
    id: overrides.id ?? `el-${Math.random().toString(36).slice(2)}`,
    role: overrides.role,
    label: overrides.label,
    value: overrides.value ?? null,
    enabled: overrides.enabled ?? true,
    focused: overrides.focused ?? false,
    actions: overrides.actions ?? [],
    bounds: overrides.bounds ?? [0, 0, 100, 40],
    parent: overrides.parent ?? null,
  }
}

function makeSnapshot(elements: Element[]): Snapshot {
  return {
    platform: 'web',
    elements,
    timestamp: Date.now(),
  }
}

// ─── Tests ───────────────────────────────────────────────────

describe('perceptualHash', () => {
  it('identical images produce the same hash', () => {
    const buf = makeTestPng(100, 100, 128, 64, 32)
    const h1 = perceptualHash(buf)
    const h2 = perceptualHash(buf)
    expect(h1).toBe(h2)
  })

  it('returns a BigInt', () => {
    const buf = makeTestPng(50, 50, 200, 100, 50)
    expect(typeof perceptualHash(buf)).toBe('bigint')
  })
})

describe('hashDistance', () => {
  it('identical images: distance = 0', () => {
    const buf = makeTestPng(100, 100, 200, 200, 200)
    const h = perceptualHash(buf)
    expect(hashDistance(h, h)).toBe(0)
  })

  it('different images: left-to-right vs right-to-left gradient → distance > 10', () => {
    // Uniform solid images produce identical dHash (no internal gradient).
    // Use opposing gradients so adjacent-pixel comparisons flip, maximizing distance.
    const ltr = makeGradientPng(100, 100, true)
    const rtl = makeGradientPng(100, 100, false)
    const hLtr = perceptualHash(ltr)
    const hRtl = perceptualHash(rtl)
    expect(hashDistance(hLtr, hRtl)).toBeGreaterThan(10)
  })

  it('similar images: slight color variation → distance < 5', () => {
    // Two nearly-identical gray images differ by 1 luminance unit
    const img1 = makeTestPng(100, 100, 128, 128, 128)
    const img2 = makeTestPng(100, 100, 129, 129, 129)
    const h1 = perceptualHash(img1)
    const h2 = perceptualHash(img2)
    expect(hashDistance(h1, h2)).toBeLessThan(5)
  })
})

describe('diffSnapshots', () => {
  it('identical element arrays → score 0, type none', () => {
    const el = makeElement({ role: 'button', label: 'Submit' })
    const snap = makeSnapshot([el])
    const result = diffSnapshots(snap, snap)
    expect(result.score).toBe(0)
    expect(result.type).toBe('none')
    expect(result.changed).toBe(false)
    expect(result.details).toHaveLength(0)
  })

  it('added element → detail with kind "added"', () => {
    const el1 = makeElement({ role: 'button', label: 'Submit' })
    const el2 = makeElement({ role: 'link', label: 'Home' })
    const before = makeSnapshot([el1])
    const after = makeSnapshot([el1, el2])
    const result = diffSnapshots(before, after)
    expect(result.details.some(d => d.kind === 'added')).toBe(true)
    expect(result.changed).toBe(true)
  })

  it('removed element → detail with kind "removed"', () => {
    const el1 = makeElement({ role: 'button', label: 'Submit' })
    const el2 = makeElement({ role: 'link', label: 'Home' })
    const before = makeSnapshot([el1, el2])
    const after = makeSnapshot([el1])
    const result = diffSnapshots(before, after)
    expect(result.details.some(d => d.kind === 'removed')).toBe(true)
    expect(result.changed).toBe(true)
  })

  it('bounds shift > 5px → detail with kind "moved"', () => {
    const el1 = makeElement({ role: 'button', label: 'Submit', bounds: [0, 0, 100, 40] })
    const el2 = makeElement({ role: 'button', label: 'Submit', bounds: [50, 50, 100, 40] })
    const before = makeSnapshot([el1])
    const after = makeSnapshot([el2])
    const result = diffSnapshots(before, after)
    expect(result.details.some(d => d.kind === 'moved')).toBe(true)
  })

  it('bounds shift 2px → no change details (below threshold)', () => {
    const el1 = makeElement({ role: 'button', label: 'Submit', bounds: [0, 0, 100, 40] })
    const el2 = makeElement({ role: 'button', label: 'Submit', bounds: [2, 2, 100, 40] })
    const before = makeSnapshot([el1])
    const after = makeSnapshot([el2])
    const result = diffSnapshots(before, after)
    expect(result.details.filter(d => d.kind === 'moved')).toHaveLength(0)
    expect(result.score).toBe(0)
    expect(result.type).toBe('none')
  })
})

describe('detectChange', () => {
  it('identical buffers → short-circuit to no change', () => {
    const buf = makeTestPng(100, 100, 100, 100, 100)
    const snap = makeSnapshot([makeElement({ role: 'button', label: 'OK' })])
    const result = detectChange(buf, buf, snap, snap)
    expect(result.changed).toBe(false)
    expect(result.score).toBe(0)
    expect(result.type).toBe('none')
  })

  it('different buffers + different snapshots → significant change', () => {
    // Use opposing gradients so dHash distance > 5 (no short-circuit)
    const buf1 = makeGradientPng(100, 100, true)
    const buf2 = makeGradientPng(100, 100, false)

    // Build enough elements to push score >= 0.5 for navigation type
    const sharedEl = makeElement({ role: 'text', label: 'Title' })
    const before = makeSnapshot([sharedEl])

    // After has completely different elements
    const newEls = Array.from({ length: 5 }, (_, i) =>
      makeElement({ role: 'button', label: `Button ${i}` })
    )
    const after = makeSnapshot(newEls)

    const result = detectChange(buf1, buf2, before, after)
    expect(result.changed).toBe(true)
    expect(result.score).toBeGreaterThan(0)
  })

  it('empty snapshots → no change', () => {
    const buf1 = makeTestPng(100, 100, 255, 0, 0)
    const buf2 = makeTestPng(100, 100, 0, 0, 255)
    const emptySnap = makeSnapshot([])
    const result = detectChange(buf1, buf2, emptySnap, emptySnap)
    // Hash distance will be high (red vs blue), but diffSnapshots on empty gives score 0
    // score 0 < threshold 0.05 → changed = false
    expect(result.changed).toBe(false)
    expect(result.score).toBe(0)
  })
})
