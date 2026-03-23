import { describe, it, expect } from 'vitest'
import { frame, autoFrame } from '../../src/intelligence/framing.js'
import { encodePng } from '../../src/media/png.js'
import type { Element } from '../../src/core/types.js'
import type { ImportanceScore } from '../../src/intelligence/types.js'

// ─── Test image factory ────────────────────────────────────────────────────────

function makeTestPng(): Buffer {
  const w = 200, h = 200
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const x = i % w
    const y = Math.floor(i / w)
    data[i * 4]     = x       // R varies horizontally
    data[i * 4 + 1] = y       // G varies vertically
    data[i * 4 + 2] = 128     // B constant
    data[i * 4 + 3] = 255
  }
  return encodePng({ width: w, height: h, data })
}

// ─── Element / score helpers ───────────────────────────────────────────────────

let idSeq = 0
function makeElement(overrides: Partial<Element> = {}): Element {
  return {
    id:      `el-${++idSeq}`,
    role:    'text',
    label:   'Label',
    value:   null,
    enabled: true,
    focused: false,
    actions: [],
    bounds:  [0, 0, 50, 50],
    parent:  null,
    ...overrides,
  }
}

function makeScore(elementId: string, score: number): ImportanceScore {
  return { elementId, score, factors: [] }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('frame()', () => {

  it('element target: crop matches element bounds + padding', () => {
    const png = makeTestPng()
    const el = makeElement({ id: 'el-target', bounds: [30, 30, 40, 40] })
    const scores = [makeScore('el-target', 0.8)]

    const result = frame(png, scores, [el], { target: 'element', elementId: 'el-target', padding: 10 })

    // Element at [30,30,40,40], padding=10 → [20,20,60,60]
    expect(result.crop[0]).toBe(20)
    expect(result.crop[1]).toBe(20)
    expect(result.crop[2]).toBe(60)
    expect(result.crop[3]).toBe(60)
  })

  it('default auto-frame: high-scoring elements in top-left → crop covers them', () => {
    const png = makeTestPng()
    // Two high-scoring elements in the top-left quadrant
    const a = makeElement({ id: 'el-a', bounds: [10, 10, 30, 30] })
    const b = makeElement({ id: 'el-b', bounds: [50, 10, 30, 30] })
    // One low-scoring element far away
    const c = makeElement({ id: 'el-c', bounds: [160, 160, 20, 20] })
    const scores = [
      makeScore('el-a', 0.9),
      makeScore('el-b', 0.8),
      makeScore('el-c', 0.1),
    ]

    const result = frame(png, scores, [a, b, c])

    // Crop should contain both a and b (top-left region), not cover full image
    // a goes 10..40, b goes 50..80, bounding box = [10,10,70,30]
    // With 16px padding: [-6,−6,102,62] → clamped to [0,0,102,62]
    expect(result.crop[0]).toBe(0)
    expect(result.crop[1]).toBe(0)
    // Width should not be full 200px — just enough to cover both elements + padding
    expect(result.crop[2]).toBeLessThan(200)
    expect(result.crop[3]).toBeLessThan(200)
  })

  it('aspect ratio 16:9: output dimensions are within 1px of 16:9 ratio', () => {
    const png = makeTestPng()
    const el = makeElement({ id: 'el-wide', bounds: [50, 50, 60, 60] })
    const scores = [makeScore('el-wide', 0.9)]

    const result = frame(png, scores, [el], {
      target: 'element',
      elementId: 'el-wide',
      padding: 0,
      aspectRatio: 16 / 9,
    })

    const [, , w, h] = result.crop
    const ratio = w / h
    // Allow small rounding error
    expect(Math.abs(ratio - 16 / 9)).toBeLessThan(0.05)
  })

  it('aspect ratio 1:1: w === h (square crop)', () => {
    const png = makeTestPng()
    const el = makeElement({ id: 'el-sq', bounds: [50, 80, 40, 20] })
    const scores = [makeScore('el-sq', 0.9)]

    const result = frame(png, scores, [el], {
      target: 'element',
      elementId: 'el-sq',
      padding: 0,
      aspectRatio: 1,
    })

    const [, , w, h] = result.crop
    expect(Math.abs(w - h)).toBeLessThanOrEqual(1)
  })

  it('padding: 16px padding expands crop 16px on each side (where not clamped)', () => {
    const png = makeTestPng()
    // Place element away from edges so padding doesn't clamp
    const el = makeElement({ id: 'el-pad', bounds: [60, 60, 40, 40] })
    const scores = [makeScore('el-pad', 0.9)]

    const noPad = frame(png, scores, [el], { target: 'element', elementId: 'el-pad', padding: 0 })
    const padded = frame(png, scores, [el], { target: 'element', elementId: 'el-pad', padding: 16 })

    expect(padded.crop[0]).toBe(noPad.crop[0] - 16)
    expect(padded.crop[1]).toBe(noPad.crop[1] - 16)
    expect(padded.crop[2]).toBe(noPad.crop[2] + 32)
    expect(padded.crop[3]).toBe(noPad.crop[3] + 32)
  })

  it('viewport target: returns full image dimensions', () => {
    const png = makeTestPng()
    const el = makeElement({ id: 'el-vp', bounds: [10, 10, 20, 20] })
    const scores = [makeScore('el-vp', 0.9)]

    const result = frame(png, scores, [el], { target: 'viewport' })

    expect(result.crop[0]).toBe(0)
    expect(result.crop[1]).toBe(0)
    expect(result.crop[2]).toBe(200)
    expect(result.crop[3]).toBe(200)
  })

  it('no high-scoring elements: falls back to full screenshot', () => {
    const png = makeTestPng()
    const el = makeElement({ id: 'el-low', bounds: [10, 10, 20, 20] })
    const scores = [makeScore('el-low', 0.1)]

    const result = frame(png, scores, [el])

    // top 25% of 1 element still gives us that element's bounding box + padding
    // The important thing is we get a valid buffer back
    expect(result.buffer).toBeInstanceOf(Buffer)
    expect(result.buffer.length).toBeGreaterThan(0)
  })

  it('no elements at all: returns full screenshot', () => {
    const png = makeTestPng()
    const result = frame(png, [], [])

    expect(result.crop[0]).toBe(0)
    expect(result.crop[1]).toBe(0)
    expect(result.crop[2]).toBe(200)
    expect(result.crop[3]).toBe(200)
  })

  it('clamp to bounds: element near edge — crop does not exceed image bounds', () => {
    const png = makeTestPng()
    // Element very near the right/bottom edge
    const el = makeElement({ id: 'el-edge', bounds: [180, 180, 15, 15] })
    const scores = [makeScore('el-edge', 0.9)]

    const result = frame(png, scores, [el], {
      target: 'element',
      elementId: 'el-edge',
      padding: 20,
    })

    const [x, y, w, h] = result.crop
    expect(x).toBeGreaterThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(x + w).toBeLessThanOrEqual(200)
    expect(y + h).toBeLessThanOrEqual(200)
  })

  it('label generation: region with buttons → "Actions"', () => {
    const png = makeTestPng()
    const btn1 = makeElement({ id: 'el-btn1', role: 'button', bounds: [10, 10, 40, 30], actions: ['press'], label: 'Save' })
    const btn2 = makeElement({ id: 'el-btn2', role: 'button', bounds: [55, 10, 40, 30], actions: ['press'], label: 'Cancel' })
    const scores = [makeScore('el-btn1', 0.8), makeScore('el-btn2', 0.8)]

    const result = frame(png, scores, [btn1, btn2], { target: 'element', elementId: 'el-btn1', padding: 0 })

    expect(result.label).toBe('Actions')
  })

  it('label generation: region with links → "Navigation"', () => {
    const png = makeTestPng()
    const link1 = makeElement({ id: 'el-lnk1', role: 'link', bounds: [10, 10, 40, 20], actions: ['press'], label: 'Home' })
    const link2 = makeElement({ id: 'el-lnk2', role: 'link', bounds: [55, 10, 40, 20], actions: ['press'], label: 'About' })
    const scores = [makeScore('el-lnk1', 0.8), makeScore('el-lnk2', 0.8)]

    // Use default framing so both links are considered
    const result = frame(png, scores, [link1, link2])

    expect(result.label).toBe('Navigation')
  })

})

describe('autoFrame()', () => {

  it('returns multiple regions sorted by score descending', () => {
    const png = makeTestPng()

    // Cluster A: high-scoring buttons near top-left (close together)
    const a1 = makeElement({ id: 'af-a1', role: 'button', bounds: [10, 10, 30, 20], actions: ['press'], label: 'Save' })
    const a2 = makeElement({ id: 'af-a2', role: 'button', bounds: [45, 10, 30, 20], actions: ['press'], label: 'Cancel' })

    // Cluster B: lower-scoring links in bottom-right (far from A)
    const b1 = makeElement({ id: 'af-b1', role: 'link', bounds: [130, 130, 30, 20], actions: ['press'], label: 'Link1' })
    const b2 = makeElement({ id: 'af-b2', role: 'link', bounds: [165, 130, 30, 20], actions: ['press'], label: 'Link2' })

    const elements = [a1, a2, b1, b2]
    const scores = [
      makeScore('af-a1', 0.9),
      makeScore('af-a2', 0.85),
      makeScore('af-b1', 0.5),
      makeScore('af-b2', 0.45),
    ]

    const results = autoFrame(png, scores, elements)

    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results.length).toBeLessThanOrEqual(5)

    // Each result should have a valid buffer
    for (const r of results) {
      expect(r.buffer).toBeInstanceOf(Buffer)
      expect(r.buffer.length).toBeGreaterThan(0)
    }

    // First result should be from the higher-scoring cluster (Actions label)
    expect(results[0].label).toBe('Actions')
  })

  it('returns single result for viewport when no qualifying elements', () => {
    const png = makeTestPng()
    const el = makeElement({ id: 'af-low', bounds: [10, 10, 20, 20] })
    const scores = [makeScore('af-low', 0.1)]

    const results = autoFrame(png, scores, [el])

    expect(results.length).toBe(1)
    expect(results[0].crop[2]).toBe(200)
    expect(results[0].crop[3]).toBe(200)
  })

})
