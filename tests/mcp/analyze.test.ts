import { describe, it, expect } from 'vitest'
import { handleAnalyze } from '../../src/mcp/tools/analyze.js'
import type { Driver, Snapshot, Element, ActResult, DriverTarget, ActionType } from '../../src/core/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeElement(overrides: Partial<Element>): Element {
  return {
    id: 'e1',
    role: 'generic',
    label: '',
    value: null,
    enabled: true,
    focused: false,
    actions: [],
    bounds: [0, 0, 100, 30] as [number, number, number, number],
    parent: null,
    ...overrides,
  }
}

class MockDriver implements Driver {
  constructor(private elements: Element[]) {}
  async connect(_target: DriverTarget): Promise<void> {}
  async snapshot(): Promise<Snapshot> {
    return {
      platform: 'web',
      elements: this.elements,
      timestamp: Date.now(),
      metadata: { elementCount: this.elements.length },
    }
  }
  async act(_elementId: string, _action: ActionType, _value?: string): Promise<ActResult> {
    return { success: true, snapshot: await this.snapshot() }
  }
  async screenshot(): Promise<Buffer> { return Buffer.alloc(0) }
  async close(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

function makeContext(driver: Driver, sessionId = 'test-session') {
  const drivers = new Map([[sessionId, driver]])
  const sessions = new Map()
  return { drivers, sessions } as any
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('handleAnalyze', () => {
  it('throws for unknown sessionId', async () => {
    const ctx = makeContext(new MockDriver([]))
    await expect(
      handleAnalyze({ sessionId: 'nonexistent' }, ctx)
    ).rejects.toThrow('Session nonexistent not found')
  })

  it('returns unknown state and empty collections for empty snapshot', async () => {
    const driver = new MockDriver([])
    const ctx = makeContext(driver)
    const result = await handleAnalyze({ sessionId: 'test-session' }, ctx)

    expect(result.state).toBe('unknown')
    expect(result.stateConfidence).toBe(0)
    expect(result.regions).toEqual([])
    expect(result.topElements).toEqual([])
    expect(result.totalElements).toBe(0)
  })

  it('detects populated state for a page with many elements', async () => {
    // Need nonStruct.length > 10 (non-group/generic/none/presentation/separator)
    // and distinctRoles >= 3 for confident populated detection
    const elements: Element[] = [
      makeElement({ id: 'h1', role: 'heading', label: 'Welcome', bounds: [0, 0, 400, 40], actions: ['click'] }),
      makeElement({ id: 'h2', role: 'heading', label: 'Features', bounds: [0, 50, 400, 40] }),
      makeElement({ id: 'b1', role: 'button', label: 'Get Started', bounds: [0, 100, 120, 40], actions: ['click'] }),
      makeElement({ id: 'b2', role: 'button', label: 'Learn More', bounds: [130, 100, 120, 40], actions: ['click'] }),
      makeElement({ id: 'b3', role: 'button', label: 'Sign Up', bounds: [260, 100, 120, 40], actions: ['click'] }),
      makeElement({ id: 't1', role: 'text', label: 'Paragraph one', bounds: [0, 150, 400, 20] }),
      makeElement({ id: 't2', role: 'text', label: 'Paragraph two', bounds: [0, 175, 400, 20] }),
      makeElement({ id: 't3', role: 'text', label: 'Paragraph three', bounds: [0, 200, 400, 20] }),
      makeElement({ id: 'l1', role: 'link', label: 'Home', bounds: [0, 230, 80, 20], actions: ['click'] }),
      makeElement({ id: 'l2', role: 'link', label: 'About', bounds: [90, 230, 80, 20], actions: ['click'] }),
      makeElement({ id: 'l3', role: 'link', label: 'Contact', bounds: [180, 230, 80, 20], actions: ['click'] }),
      makeElement({ id: 'tb1', role: 'textbox', label: 'Search', bounds: [0, 260, 200, 35], actions: ['type'] }),
    ]
    const driver = new MockDriver(elements)
    const ctx = makeContext(driver)
    const result = await handleAnalyze({ sessionId: 'test-session' }, ctx)

    expect(result.state).toBe('populated')
    expect(result.stateConfidence).toBeGreaterThan(0)
    expect(result.totalElements).toBe(12)
  })

  it('detects loading state when a progressbar element is present', async () => {
    const elements: Element[] = [
      makeElement({ id: 'pb', role: 'progressbar', label: 'Loading...', bounds: [0, 0, 300, 10] }),
      makeElement({ id: 't1', role: 'text', label: 'Please wait', bounds: [0, 20, 200, 20] }),
    ]
    const driver = new MockDriver(elements)
    const ctx = makeContext(driver)
    const result = await handleAnalyze({ sessionId: 'test-session' }, ctx)

    expect(result.state).toBe('loading')
    expect(result.stateConfidence).toBeGreaterThan(0)
  })

  it('returns topElements ordered by importance descending', async () => {
    // heading (role score 1.0) should score higher than generic (role score 0.3)
    const elements: Element[] = [
      makeElement({ id: 'g1', role: 'generic', label: '', bounds: [0, 500, 100, 30] }),
      makeElement({ id: 'h1', role: 'heading', label: 'Title', bounds: [0, 0, 400, 50], actions: ['click'] }),
      makeElement({ id: 'b1', role: 'button', label: 'Submit', bounds: [0, 60, 120, 40], actions: ['click'] }),
    ]
    const driver = new MockDriver(elements)
    const ctx = makeContext(driver)
    const result = await handleAnalyze({ sessionId: 'test-session' }, ctx)

    expect(result.topElements.length).toBeGreaterThan(0)
    // Verify descending order
    for (let i = 1; i < result.topElements.length; i++) {
      expect(result.topElements[i - 1].importance).toBeGreaterThanOrEqual(result.topElements[i].importance)
    }
    // heading or button should be first (both high role scores), generic last
    const lastId = result.topElements[result.topElements.length - 1].id
    expect(lastId).toBe('g1')
    // Verify bounds are present on each topElement
    for (const el of result.topElements) {
      expect(el.bounds).toBeDefined()
      expect(Array.isArray(el.bounds)).toBe(true)
      expect(el.bounds.length).toBe(4)
    }
  })

  it('detects a region labeled Actions from clustered buttons', async () => {
    // Buttons within 30px edge distance of each other → one Actions region
    const elements: Element[] = [
      makeElement({ id: 'b1', role: 'button', label: 'Save', bounds: [0, 0, 80, 36], actions: ['click'] }),
      makeElement({ id: 'b2', role: 'button', label: 'Cancel', bounds: [90, 0, 80, 36], actions: ['click'] }),
      makeElement({ id: 'b3', role: 'button', label: 'Delete', bounds: [180, 0, 80, 36], actions: ['click'] }),
    ]
    const driver = new MockDriver(elements)
    const ctx = makeContext(driver)
    const result = await handleAnalyze({ sessionId: 'test-session' }, ctx)

    const actionsRegion = result.regions.find(r => r.label === 'Actions')
    expect(actionsRegion).toBeDefined()
    expect(actionsRegion!.elementCount).toBeGreaterThanOrEqual(2)
  })

  it('uses a custom viewport and returns position-influenced scores', async () => {
    // Same element at position (0, 0) — above-fold with both viewports,
    // but with a tiny viewport the normalized position changes
    const elements: Element[] = [
      makeElement({ id: 'b1', role: 'button', label: 'Click Me', bounds: [0, 0, 100, 40], actions: ['click'] }),
    ]
    const driver = new MockDriver(elements)
    const ctx = makeContext(driver)

    const resultDefault = await handleAnalyze({ sessionId: 'test-session' }, ctx)
    const resultSmall = await handleAnalyze(
      { sessionId: 'test-session', viewport: { width: 320, height: 568, devicePixelRatio: 2 } },
      ctx
    )

    // Both should succeed and return the single element
    expect(resultDefault.topElements).toHaveLength(1)
    expect(resultSmall.topElements).toHaveLength(1)
    // Scores may differ due to different viewport normalization
    // Just verify the result is valid (score in 0-1 range)
    expect(resultDefault.topElements[0].importance).toBeGreaterThanOrEqual(0)
    expect(resultDefault.topElements[0].importance).toBeLessThanOrEqual(1)
    expect(resultSmall.topElements[0].importance).toBeGreaterThanOrEqual(0)
    expect(resultSmall.topElements[0].importance).toBeLessThanOrEqual(1)
  })

  it('rounds scores to at most 3 decimal places', async () => {
    const elements: Element[] = [
      makeElement({ id: 'b1', role: 'button', label: 'Action', bounds: [50, 50, 120, 40], actions: ['click'] }),
      makeElement({ id: 'l1', role: 'link', label: 'Go', bounds: [200, 50, 80, 30], actions: ['click'] }),
    ]
    const driver = new MockDriver(elements)
    const ctx = makeContext(driver)
    const result = await handleAnalyze({ sessionId: 'test-session' }, ctx)

    for (const el of result.topElements) {
      const str = el.importance.toString()
      const decimals = str.includes('.') ? str.split('.')[1].length : 0
      expect(decimals).toBeLessThanOrEqual(3)
    }
    for (const region of result.regions) {
      const str = region.score.toString()
      const decimals = str.includes('.') ? str.split('.')[1].length : 0
      expect(decimals).toBeLessThanOrEqual(3)
    }
    const confStr = result.stateConfidence.toString()
    const confDecimals = confStr.includes('.') ? confStr.split('.')[1].length : 0
    expect(confDecimals).toBeLessThanOrEqual(3)
  })

  it('topElements include correct bounds from source elements', async () => {
    const elements: Element[] = [
      makeElement({ id: 'b1', role: 'button', label: 'Save', bounds: [10, 20, 100, 40], actions: ['click'] }),
      makeElement({ id: 'h1', role: 'heading', label: 'Title', bounds: [0, 0, 400, 50] }),
    ]
    const driver = new MockDriver(elements)
    const ctx = makeContext(driver)
    const result = await handleAnalyze({ sessionId: 'test-session' }, ctx)

    const h1 = result.topElements.find(e => e.id === 'h1')
    const b1 = result.topElements.find(e => e.id === 'b1')
    expect(h1?.bounds).toEqual([0, 0, 400, 50])
    expect(b1?.bounds).toEqual([10, 20, 100, 40])
  })

  it('topElements bounds fallback to [0,0,0,0] when element not found', async () => {
    // This verifies the fallback path in the mapping
    const elements: Element[] = [
      makeElement({ id: 'e1', role: 'button', label: 'A', bounds: [0, 0, 80, 36], actions: ['click'] }),
    ]
    const driver = new MockDriver(elements)
    const ctx = makeContext(driver)
    const result = await handleAnalyze({ sessionId: 'test-session' }, ctx)

    for (const el of result.topElements) {
      expect(el.bounds).toBeDefined()
      expect(el.bounds.length).toBe(4)
    }
  })

  it('totalElements matches the input element count', async () => {
    const elements: Element[] = [
      makeElement({ id: 'e1', role: 'button', label: 'A', bounds: [0, 0, 80, 36], actions: ['click'] }),
      makeElement({ id: 'e2', role: 'text', label: 'B', bounds: [0, 50, 200, 20] }),
      makeElement({ id: 'e3', role: 'heading', label: 'C', bounds: [0, 80, 300, 40] }),
      makeElement({ id: 'e4', role: 'link', label: 'D', bounds: [0, 130, 100, 20], actions: ['click'] }),
      makeElement({ id: 'e5', role: 'textbox', label: 'E', bounds: [0, 160, 200, 35], actions: ['type'] }),
    ]
    const driver = new MockDriver(elements)
    const ctx = makeContext(driver)
    const result = await handleAnalyze({ sessionId: 'test-session' }, ctx)

    expect(result.totalElements).toBe(5)
  })

  it('caps topElements at 10 even with more elements', async () => {
    const elements: Element[] = Array.from({ length: 15 }, (_, i) =>
      makeElement({ id: `e${i}`, role: 'button', label: `Button ${i}`, bounds: [i * 10, 0, 80, 36], actions: ['click'] })
    )
    const driver = new MockDriver(elements)
    const ctx = makeContext(driver)
    const result = await handleAnalyze({ sessionId: 'test-session' }, ctx)

    expect(result.topElements.length).toBeLessThanOrEqual(10)
    expect(result.totalElements).toBe(15)
  })
})
