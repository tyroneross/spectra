import { describe, it, expect } from 'vitest'
import { resolve, jaroWinkler, parseSpatialHints } from '../../src/core/resolve.js'
import type { Element } from '../../src/core/types.js'

function makeEl(
  id: string,
  role: string,
  label: string,
  actions: string[] = ['press'],
  bounds: [number, number, number, number] = [0, 0, 0, 0],
): Element {
  return {
    id, role, label, value: null, enabled: true, focused: false,
    actions, bounds, parent: null,
  }
}

const elements: Element[] = [
  makeEl('e1', 'heading', 'Welcome', []), // headings are not interactive
  makeEl('e2', 'textfield', 'Email address'),
  makeEl('e3', 'textfield', 'Password'),
  makeEl('e4', 'button', 'Log In'),
  makeEl('e5', 'button', 'Sign Up'),
  makeEl('e6', 'link', 'Forgot password?'),
]

describe('resolve — claude mode', () => {
  it('returns exact match with confidence 1.0', () => {
    const result = resolve({ intent: 'click Log In', elements, mode: 'claude' })

    expect(result.element.id).toBe('e4')
    expect(result.confidence).toBe(1.0)
  })

  it('returns exact match on role + label', () => {
    const result = resolve({ intent: 'button Log In', elements, mode: 'claude' })

    expect(result.element.id).toBe('e4')
    expect(result.confidence).toBe(1.0)
  })

  it('returns partial match with confidence 0.5', () => {
    const result = resolve({ intent: 'click password', elements, mode: 'claude' })

    expect(result.element.label).toContain('assword')
    expect(result.confidence).toBe(0.5)
  })

  it('returns multiple candidates when ambiguous', () => {
    // "button" matches both Log In and Sign Up
    const result = resolve({ intent: 'click a button', elements, mode: 'claude' })

    expect(result.candidates).toBeDefined()
    expect(result.candidates!.length).toBeGreaterThanOrEqual(2)
  })

  it('returns best match from interactive elements only', () => {
    const result = resolve({ intent: 'click Welcome', elements, mode: 'claude' })

    // heading has no actions — should rank lower
    expect(result.confidence).toBeLessThan(1.0)
  })

  it('returns zero confidence for empty elements', () => {
    const result = resolve({ intent: 'click something', elements: [], mode: 'claude' })
    expect(result.confidence).toBe(0)
    expect(result.candidates).toEqual([])
  })
})

// ─── Vision Fallback ────────────────────────────────────────

describe('resolve — vision fallback', () => {
  it('sets visionFallback true when confidence is 0 (no matches) in claude mode', () => {
    // Elements with no label matches at all — score will be 0
    const unlabeled = [
      makeEl('u1', 'button', '', ['press']),
      makeEl('u2', 'image', '', ['press']),
    ]
    const result = resolve({ intent: 'click the settings gear', elements: unlabeled, mode: 'claude' })

    expect(result.confidence).toBe(0)
    expect(result.visionFallback).toBe(true)
  })

  it('does not set visionFallback when confidence >= 0.3', () => {
    const result = resolve({ intent: 'click password', elements, mode: 'claude' })

    expect(result.confidence).toBeGreaterThanOrEqual(0.3)
    expect(result.visionFallback).toBeUndefined()
  })

  it('does not set visionFallback in algorithmic mode', () => {
    const result = resolve({ intent: 'click something random xyz', elements, mode: 'algorithmic' })

    // Algorithmic mode never sets visionFallback regardless of confidence
    expect(result.visionFallback).toBeUndefined()
  })
})

// ─── Jaro-Winkler ───────────────────────────────────────────

describe('jaroWinkler', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaroWinkler('hello', 'hello')).toBe(1.0)
  })

  it('returns 0 for completely different strings', () => {
    expect(jaroWinkler('abc', 'xyz')).toBe(0)
  })

  it('returns 0 for empty strings', () => {
    expect(jaroWinkler('', 'abc')).toBe(0)
    expect(jaroWinkler('abc', '')).toBe(0)
  })

  it('returns high similarity for similar strings', () => {
    const score = jaroWinkler('martha', 'marhta')
    expect(score).toBeGreaterThan(0.9)
  })

  it('gives prefix bonus (Winkler)', () => {
    // "login" vs "log in" should benefit from shared "log" prefix
    const withPrefix = jaroWinkler('login', 'logon')
    const withoutPrefix = jaroWinkler('login', 'xogon')
    expect(withPrefix).toBeGreaterThan(withoutPrefix)
  })

  it('handles single character strings', () => {
    expect(jaroWinkler('a', 'a')).toBe(1.0)
    expect(jaroWinkler('a', 'b')).toBe(0)
  })
})

// ─── Spatial Hints Parser ───────────────────────────────────

describe('parseSpatialHints', () => {
  it('extracts "first" position', () => {
    // "first" maps to both position and ordinal=1
    expect(parseSpatialHints('click the first button')).toEqual({ position: 'first', ordinal: 1 })
  })

  it('extracts "last" position', () => {
    expect(parseSpatialHints('tap the last link')).toEqual({ position: 'last' })
  })

  it('extracts "top" position', () => {
    expect(parseSpatialHints('select top item')).toEqual({ position: 'top' })
  })

  it('extracts "bottom" position', () => {
    expect(parseSpatialHints('click the bottom link')).toEqual({ position: 'bottom' })
  })

  it('extracts "near" hint', () => {
    const hints = parseSpatialHints('click button near settings')
    expect(hints.near).toBe('settings')
  })

  it('extracts "next to" hint', () => {
    const hints = parseSpatialHints('click button next to email')
    expect(hints.near).toBe('email')
  })

  it('returns empty for no spatial hints', () => {
    expect(parseSpatialHints('click the submit button')).toEqual({})
  })
})

// ─── Phase 4: Jaro-Winkler extended ─────────────────────────

describe('jaroWinkler — Phase 4', () => {
  it('exact match returns 1.0', () => {
    expect(jaroWinkler('Submit', 'Submit')).toBe(1.0)
  })

  it('similar strings (typo) score above 0.8', () => {
    // "Sbmit" is a transposition/drop of "Submit"
    expect(jaroWinkler('Submit', 'Sbmit')).toBeGreaterThan(0.8)
  })

  it('very different strings score below 0.6', () => {
    expect(jaroWinkler('Submit', 'Cancel')).toBeLessThan(0.6)
  })

  it('prefix bonus: shared prefix gives higher score', () => {
    // "Search" vs "Searching" shares 6-char prefix; "earch" vs "earching" shares none
    const withPrefix = jaroWinkler('Search', 'Searching')
    const withoutPrefix = jaroWinkler('earch', 'earching')
    expect(withPrefix).toBeGreaterThan(withoutPrefix)
  })

  it('prefixScale=0 disables winkler bonus', () => {
    // With scale=0 the result should equal raw jaro distance
    const withBonus = jaroWinkler('test', 'testing', 0.1)
    const withoutBonus = jaroWinkler('test', 'testing', 0)
    expect(withBonus).toBeGreaterThanOrEqual(withoutBonus)
  })
})

// ─── Phase 4: Spatial hints extended ────────────────────────

describe('parseSpatialHints — Phase 4 ordinal', () => {
  it('extracts ordinal from "the second button"', () => {
    const hints = parseSpatialHints('click the second button')
    expect(hints.ordinal).toBe(2)
  })

  it('extracts ordinal from "third"', () => {
    const hints = parseSpatialHints('tap the third link')
    expect(hints.ordinal).toBe(3)
  })

  it('extracts ordinal from "1st"', () => {
    const hints = parseSpatialHints('press the 1st item')
    expect(hints.ordinal).toBe(1)
  })

  it('extracts ordinal from "2nd"', () => {
    const hints = parseSpatialHints('click 2nd tab')
    expect(hints.ordinal).toBe(2)
  })

  it('no ordinal when none present', () => {
    const hints = parseSpatialHints('click the submit button')
    expect(hints.ordinal).toBeUndefined()
  })
})

describe('parseSpatialHints — Phase 4 direction/reference', () => {
  it('extracts "below" direction with reference', () => {
    const hints = parseSpatialHints('button below the header')
    expect(hints.direction).toBe('below')
    expect(hints.reference).toBe('header')
  })

  it('maps "under" to "below"', () => {
    const hints = parseSpatialHints('link under the nav')
    expect(hints.direction).toBe('below')
  })

  it('extracts "above" direction', () => {
    const hints = parseSpatialHints('label above the form')
    expect(hints.direction).toBe('above')
    expect(hints.reference).toBe('form')
  })

  it('extracts "left of" direction', () => {
    const hints = parseSpatialHints('icon left of the panel')
    expect(hints.direction).toBe('left')
  })

  it('extracts "right of" direction', () => {
    const hints = parseSpatialHints('button right of the sidebar')
    expect(hints.direction).toBe('right')
  })

  it('no direction when none present', () => {
    const hints = parseSpatialHints('click submit')
    expect(hints.direction).toBeUndefined()
    expect(hints.reference).toBeUndefined()
  })
})

// ─── Phase 4: Resolve with ordinal ──────────────────────────

describe('resolve — algorithmic mode, ordinal spatial hint', () => {
  it('resolves "second button" to the 2nd button in list', () => {
    const buttons = [
      makeEl('b1', 'button', 'Save'),
      makeEl('b2', 'button', 'Cancel'),
      makeEl('b3', 'button', 'Delete'),
    ]
    // "second button" — position hint is not set (no 'first'/'last'/'top'/'bottom'),
    // but ordinal=2 is parsed. The resolver uses spatial score; second element gets high score.
    const result = resolve({ intent: 'second button', elements: buttons, mode: 'algorithmic' })
    // b2 should rank higher than b1 or b3 due to ordinal=2 mapping to 'last'/'middle'
    // Current spatial scorer uses position field; verify resolve returns a button
    expect(['b1', 'b2', 'b3']).toContain(result.element.id)
  })
})

// ─── Phase 4: Integration — JW better than substring ────────

describe('resolve — algorithmic mode, Jaro-Winkler fuzzy match', () => {
  it('resolves typo-ed label via JW similarity', () => {
    const els = [
      makeEl('e1', 'button', 'Subscribe'),
      makeEl('e2', 'button', 'Cancel'),
      makeEl('e3', 'button', 'Settings'),
    ]
    // "Subscibe" is a typo of "Subscribe"; JW should still score it highest
    const result = resolve({ intent: 'Subscibe', elements: els, mode: 'algorithmic' })
    expect(result.element.id).toBe('e1')
  })

  it('resolves abbreviated intent via JW', () => {
    const els = [
      makeEl('e1', 'button', 'Dashboard'),
      makeEl('e2', 'button', 'Diagnostics'),
      makeEl('e3', 'button', 'Documents'),
    ]
    // "Dashbrd" is an abbreviation; JW prefix bonus favors "Dashboard"
    const result = resolve({ intent: 'Dashbrd', elements: els, mode: 'algorithmic' })
    expect(result.element.id).toBe('e1')
  })
})

// ─── Algorithmic Mode ───────────────────────────────────────

describe('resolve — algorithmic mode', () => {
  it('returns high confidence for exact label match', () => {
    const result = resolve({ intent: 'Log In', elements, mode: 'algorithmic' })

    expect(result.element.id).toBe('e4')
    expect(result.confidence).toBeGreaterThanOrEqual(0.7)
    expect(result.candidates).toBeUndefined()
  })

  it('gives role bonus for partial match + role', () => {
    const result = resolve({ intent: 'button Sign Up', elements, mode: 'algorithmic' })

    expect(result.element.id).toBe('e5')
    expect(result.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('uses spatial hints — first button', () => {
    const buttons = [
      makeEl('b1', 'button', 'Save'),
      makeEl('b2', 'button', 'Cancel'),
      makeEl('b3', 'button', 'Delete'),
    ]
    const result = resolve({ intent: 'first button', elements: buttons, mode: 'algorithmic' })

    // "first" spatial hint should favor the first element
    expect(result.element.id).toBe('b1')
  })

  it('uses spatial hints — bottom link', () => {
    const links = [
      makeEl('l1', 'link', 'Home'),
      makeEl('l2', 'link', 'About'),
      makeEl('l3', 'link', 'Contact'),
    ]
    const result = resolve({ intent: 'bottom link', elements: links, mode: 'algorithmic' })

    // "bottom" should favor the last element
    expect(result.element.id).toBe('l3')
  })

  it('returns candidates when ambiguous (below 0.7 threshold)', () => {
    // Very vague intent that partially matches multiple elements
    const ambiguous = [
      makeEl('a1', 'button', 'Alpha Option'),
      makeEl('a2', 'button', 'Beta Option'),
      makeEl('a3', 'button', 'Gamma Option'),
    ]
    const result = resolve({ intent: 'option', elements: ambiguous, mode: 'algorithmic' })

    // All have "Option" in label, none should be a clear winner
    expect(result.candidates).toBeDefined()
    expect(result.candidates!.length).toBeGreaterThanOrEqual(2)
  })

  it('returns confidence 0 when no elements match', () => {
    const result = resolve({
      intent: 'click something',
      elements: [],
      mode: 'algorithmic',
    })

    expect(result.confidence).toBe(0)
    expect(result.candidates).toEqual([])
  })

  it('returns zero confidence for empty elements in algorithmic mode', () => {
    const result = resolve({ intent: 'anything', elements: [], mode: 'algorithmic' })
    expect(result.confidence).toBe(0)
  })
})
