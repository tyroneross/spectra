import { describe, it, expect } from 'vitest'
import { resolve } from '../../src/core/resolve.js'
import type { Element } from '../../src/core/types.js'

function makeEl(id: string, role: string, label: string, actions: string[] = ['press']): Element {
  return {
    id, role, label, value: null, enabled: true, focused: false,
    actions, bounds: [0, 0, 0, 0], parent: null,
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

describe('resolve', () => {
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

  it('throws for algorithmic mode in Phase 1', () => {
    expect(() =>
      resolve({ intent: 'click Log In', elements, mode: 'algorithmic' })
    ).toThrow('Algorithmic resolution not available in Phase 1')
  })
})
