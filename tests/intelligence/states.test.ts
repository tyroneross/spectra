import { describe, it, expect, beforeEach } from 'vitest'
import { detectState, createStateTriggers } from '../../src/intelligence/states.js'
import type { Element, Snapshot } from '../../src/core/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

let idCounter = 0
function makeElement(overrides: Partial<Element>): Element {
  idCounter++
  return {
    id: `e${idCounter}`,
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

function makeSnapshot(elements: Element[]): Snapshot {
  return {
    platform: 'web',
    elements,
    timestamp: Date.now(),
    metadata: { elementCount: elements.length },
  }
}

// Reset counter before each test so IDs are predictable per-test
beforeEach(() => { idCounter = 0 })

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('detectState', () => {
  it('detects loading state from progressbar role', () => {
    const snapshot = makeSnapshot([
      makeElement({ role: 'progressbar', label: 'Loading' }),
    ])
    const result = detectState(snapshot)
    expect(result.state).toBe('loading')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('detects loading state from label', () => {
    const snapshot = makeSnapshot([
      makeElement({ role: 'text', label: 'Loading...' }),
    ])
    const result = detectState(snapshot)
    expect(result.state).toBe('loading')
  })

  it('detects error state from alert role', () => {
    const snapshot = makeSnapshot([
      makeElement({ role: 'alert', label: 'Something went wrong' }),
    ])
    const result = detectState(snapshot)
    expect(result.state).toBe('error')
  })

  it('detects error state from label', () => {
    const snapshot = makeSnapshot([
      makeElement({ role: 'text', label: 'Error: connection failed' }),
    ])
    const result = detectState(snapshot)
    expect(result.state).toBe('error')
  })

  it('detects empty state from label', () => {
    const snapshot = makeSnapshot([
      makeElement({ role: 'heading', label: 'Inbox' }),
      makeElement({ role: 'text', label: 'No items found' }),
      makeElement({ role: 'button', label: 'Compose' }),
    ])
    const result = detectState(snapshot)
    expect(result.state).toBe('empty')
  })

  it('contributes to empty score when fewer than 5 non-structural elements', () => {
    // Only 3 non-structural elements — empty gets +2 from count
    const snapshot = makeSnapshot([
      makeElement({ role: 'button', label: 'Add' }),
      makeElement({ role: 'text', label: 'Welcome' }),
      makeElement({ role: 'link', label: 'Learn more' }),
    ])
    const result = detectState(snapshot)
    // empty score ≥ 2 from count; should win or at least have empty score contribution
    expect(result.state).toBe('empty')
  })

  it('detects populated state from many diverse elements', () => {
    const elements = [
      makeElement({ role: 'heading', label: 'Dashboard' }),
      makeElement({ role: 'paragraph', label: 'Welcome back' }),
      makeElement({ role: 'button', label: 'New' }),
      makeElement({ role: 'link', label: 'Settings' }),
      makeElement({ role: 'listitem', label: 'Item 1' }),
      makeElement({ role: 'listitem', label: 'Item 2' }),
      makeElement({ role: 'listitem', label: 'Item 3' }),
      makeElement({ role: 'listitem', label: 'Item 4' }),
      makeElement({ role: 'listitem', label: 'Item 5' }),
      makeElement({ role: 'listitem', label: 'Item 6' }),
      makeElement({ role: 'textbox', label: 'Search' }),
      makeElement({ role: 'button', label: 'Filter' }),
      makeElement({ role: 'tab', label: 'Overview' }),
      makeElement({ role: 'tab', label: 'Details' }),
      makeElement({ role: 'img', label: 'Chart' }),
    ]
    const snapshot = makeSnapshot(elements)
    const result = detectState(snapshot)
    expect(result.state).toBe('populated')
  })

  it('detects focused state when populated snapshot has a focused textbox', () => {
    const elements = [
      makeElement({ role: 'heading', label: 'Search' }),
      makeElement({ role: 'paragraph', label: 'Find anything' }),
      makeElement({ role: 'textbox', label: 'Search box', focused: true }),
      makeElement({ role: 'button', label: 'Go' }),
      makeElement({ role: 'listitem', label: 'Result 1' }),
      makeElement({ role: 'listitem', label: 'Result 2' }),
      makeElement({ role: 'listitem', label: 'Result 3' }),
      makeElement({ role: 'listitem', label: 'Result 4' }),
      makeElement({ role: 'listitem', label: 'Result 5' }),
      makeElement({ role: 'listitem', label: 'Result 6' }),
      makeElement({ role: 'link', label: 'More' }),
      makeElement({ role: 'tab', label: 'All' }),
    ]
    const snapshot = makeSnapshot(elements)
    const result = detectState(snapshot)
    expect(result.state).toBe('focused')
  })

  it('returns unknown for empty element array', () => {
    const snapshot = makeSnapshot([])
    const result = detectState(snapshot)
    expect(result.state).toBe('unknown')
    expect(result.confidence).toBe(0)
    expect(result.indicators).toHaveLength(0)
  })

  it('loading beats empty when loading indicators are present', () => {
    // A few elements (empty +2 from count) but also a progressbar (loading +3)
    const snapshot = makeSnapshot([
      makeElement({ role: 'progressbar', label: 'Loading data' }),
      makeElement({ role: 'text', label: 'Please wait' }),
      makeElement({ role: 'button', label: 'Cancel' }),
    ])
    const result = detectState(snapshot)
    // loading: +3 (progressbar) +2 (label "Please wait") = 5
    // empty: +2 (few elements)
    expect(result.state).toBe('loading')
  })

  it('tracks element IDs that contributed to the winning state', () => {
    const el = makeElement({ role: 'progressbar', label: 'Syncing' })
    const snapshot = makeSnapshot([el])
    const result = detectState(snapshot)
    expect(result.indicators).toContain(el.id)
  })

  it('createStateTriggers returns empty array', () => {
    // Driver stub — not called
    const driver = {} as Parameters<typeof createStateTriggers>[0]
    const triggers = createStateTriggers(driver, 'web')
    expect(triggers).toEqual([])
  })
})
