import { describe, it, expect } from 'vitest'
import { scoreElements, findRegions } from '../../src/intelligence/importance.js'
import type { Element } from '../../src/core/types.js'
import type { Viewport } from '../../src/intelligence/types.js'

// ─── Helper ───────────────────────────────────────────────────────────────────

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
    bounds:  [0, 0, 100, 40],
    parent:  null,
    ...overrides,
  }
}

const VP: Viewport = { width: 1280, height: 800, devicePixelRatio: 1 }

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('scoreElements', () => {
  it('returns empty array for empty input', () => {
    expect(scoreElements([], VP)).toEqual([])
  })

  it('role scoring: heading > button > group', () => {
    const heading   = makeElement({ role: 'heading',   bounds: [0, 0, 200, 40] })
    const button    = makeElement({ role: 'button',    bounds: [0, 0, 200, 40] })
    const group     = makeElement({ role: 'group',     bounds: [0, 0, 200, 40] })

    // Score each independently so other signals are identical
    const [sh] = scoreElements([heading], VP)
    const [sb] = scoreElements([button],  VP)
    const [sg] = scoreElements([group],   VP)

    expect(sh.score).toBeGreaterThan(sb.score)
    expect(sb.score).toBeGreaterThan(sg.score)
  })

  it('position bias: top-left scores higher than bottom-right', () => {
    const topLeft     = makeElement({ bounds: [0,    0,    50, 20] })
    const bottomRight = makeElement({ bounds: [1000, 1000, 50, 20] })

    const [sTL] = scoreElements([topLeft],     VP)
    const [sBR] = scoreElements([bottomRight], VP)

    expect(sTL.score).toBeGreaterThan(sBR.score)
  })

  it('above-fold bonus: y=100 scores higher than y=900 (viewport h=800)', () => {
    const aboveFold = makeElement({ bounds: [0, 100, 100, 40] })
    const belowFold = makeElement({ bounds: [0, 900, 100, 40] })

    const [sAF] = scoreElements([aboveFold], VP)
    const [sBF] = scoreElements([belowFold], VP)

    expect(sAF.score).toBeGreaterThan(sBF.score)
  })

  it('interactivity: element with actions scores higher than actionless', () => {
    const interactive = makeElement({ actions: ['press'] })
    const passive     = makeElement({ actions: [] })

    // Use identical position / role / label / bounds
    const [sI] = scoreElements([interactive], VP)
    const [sP] = scoreElements([passive],     VP)

    expect(sI.score).toBeGreaterThan(sP.score)
  })

  it('label quality: "Submit" > "" > "a"', () => {
    const good  = makeElement({ label: 'Submit' })
    const empty = makeElement({ label: '' })
    const single = makeElement({ label: 'a' })

    const [sG]  = scoreElements([good],   VP)
    const [sE]  = scoreElements([empty],  VP)
    const [sSi] = scoreElements([single], VP)

    expect(sG.score).toBeGreaterThan(sE.score)
    expect(sG.score).toBeGreaterThan(sSi.score)
    expect(sSi.score).toBeGreaterThan(sE.score)
  })

  it('content density: surrounded element scores higher than isolated', () => {
    // 8 neighbours within 50px radius of center element
    const center = makeElement({ bounds: [200, 200, 10, 10] })
    const neighbours = Array.from({ length: 8 }, (_, i) => {
      const angle = (i / 8) * 2 * Math.PI
      const nx = Math.round(200 + 30 * Math.cos(angle))
      const ny = Math.round(200 + 30 * Math.sin(angle))
      return makeElement({ bounds: [nx, ny, 10, 10] })
    })
    const isolated = makeElement({ bounds: [900, 900, 10, 10] })

    const allWithNeighbours = [center, ...neighbours]
    const densityScores = scoreElements(allWithNeighbours, VP)
    const centerScore = densityScores.find(s => s.elementId === center.id)!
    const centerDensityFactor = centerScore.factors.find(f => f.name === 'content_density')!

    const [isoScore] = scoreElements([isolated], VP)
    const isoDensityFactor = isoScore.factors.find(f => f.name === 'content_density')!

    expect(centerDensityFactor.value).toBeGreaterThan(isoDensityFactor.value)
  })

  it('visual prominence: large element scores higher than tiny', () => {
    const large = makeElement({ bounds: [0, 0, 400, 300] })
    const tiny  = makeElement({ bounds: [0, 0,  10,  10] })

    const [sL] = scoreElements([large], VP)
    const [sT] = scoreElements([tiny],  VP)

    expect(sL.score).toBeGreaterThan(sT.score)
  })

  it('returns scores sorted descending', () => {
    const els = [
      makeElement({ role: 'separator', bounds: [0, 900, 10, 2] }),
      makeElement({ role: 'heading',   bounds: [0,   0, 400, 60], actions: ['press'], label: 'Main Heading' }),
      makeElement({ role: 'text',      bounds: [0, 400, 100, 20] }),
    ]
    const result = scoreElements(els, VP)
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score)
    }
  })

  it('factors array has all 6 signals with correct names', () => {
    const el = makeElement()
    const [score] = scoreElements([el], VP)
    const names = score.factors.map(f => f.name)
    expect(names).toContain('role')
    expect(names).toContain('position')
    expect(names).toContain('interactivity')
    expect(names).toContain('label_quality')
    expect(names).toContain('content_density')
    expect(names).toContain('visual_prominence')
    expect(names).toHaveLength(6)
  })
})

describe('findRegions', () => {
  it('clusters 3 close buttons into one region, isolated button into another', () => {
    // Cluster: 3 buttons within 20px of each other (edge-to-edge)
    const b1 = makeElement({ role: 'button', bounds: [0,  0, 80, 30], actions: ['press'], label: 'Save' })
    const b2 = makeElement({ role: 'button', bounds: [85, 0, 80, 30], actions: ['press'], label: 'Cancel' })
    const b3 = makeElement({ role: 'button', bounds: [170,0, 80, 30], actions: ['press'], label: 'Delete' })

    // Isolated: far away and must still score >= 0.4
    const b4 = makeElement({ role: 'button', bounds: [900, 600, 80, 30], actions: ['press'], label: 'Alone' })

    const elements = [b1, b2, b3, b4]
    const scores = scoreElements(elements, VP)
    const regions = findRegions(scores, elements)

    // Should produce 2 regions
    expect(regions.length).toBe(2)

    const clusterRegion = regions.find(r => r.elements.length === 3)
    const soloRegion    = regions.find(r => r.elements.length === 1)

    expect(clusterRegion).toBeDefined()
    expect(soloRegion).toBeDefined()

    const clusterIds = new Set(clusterRegion!.elements)
    expect(clusterIds.has(b1.id)).toBe(true)
    expect(clusterIds.has(b2.id)).toBe(true)
    expect(clusterIds.has(b3.id)).toBe(true)
    expect(soloRegion!.elements[0]).toBe(b4.id)
  })

  it('region with links gets "Navigation" label', () => {
    const link1 = makeElement({ role: 'link', bounds: [0,  0, 80, 30], actions: ['press'], label: 'Home' })
    const link2 = makeElement({ role: 'link', bounds: [85, 0, 80, 30], actions: ['press'], label: 'About' })

    const elements = [link1, link2]
    const scores   = scoreElements(elements, VP)
    const regions  = findRegions(scores, elements)

    expect(regions.length).toBeGreaterThan(0)
    expect(regions[0].label).toBe('Navigation')
  })

  it('region with textbox gets "Form" label', () => {
    const input = makeElement({ role: 'textbox', bounds: [0, 0, 200, 40], actions: ['type'], label: 'Email' })
    const btn   = makeElement({ role: 'button',  bounds: [0, 45, 200, 40], actions: ['press'], label: 'Submit' })

    const elements = [input, btn]
    const scores   = scoreElements(elements, VP)
    const regions  = findRegions(scores, elements)

    expect(regions.length).toBeGreaterThan(0)
    const formRegion = regions.find(r => r.label === 'Form')
    expect(formRegion).toBeDefined()
  })

  it('returns empty array when no elements score >= 0.4', () => {
    // separator at bottom-right, no label, no actions, tiny → very low score
    const sep = makeElement({ role: 'separator', bounds: [1200, 900, 5, 2], label: '' })
    const scores = scoreElements([sep], VP)
    const regions = findRegions(scores, [sep])
    expect(regions).toEqual([])
  })

  it('regions are sorted by score descending', () => {
    const highEl = makeElement({ role: 'heading', bounds: [0, 0, 400, 60], actions: ['press'], label: 'Top Heading' })
    const lowEl  = makeElement({ role: 'button',  bounds: [900, 700, 60, 30], actions: ['press'], label: 'Far Away' })

    const elements = [highEl, lowEl]
    const scores   = scoreElements(elements, VP)
    const regions  = findRegions(scores, elements)

    for (let i = 1; i < regions.length; i++) {
      expect(regions[i - 1].score).toBeGreaterThanOrEqual(regions[i].score)
    }
  })
})
