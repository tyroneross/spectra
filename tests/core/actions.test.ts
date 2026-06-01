import { describe, it, expect } from 'vitest'
import { selectActionForElement } from '../../src/core/actions.js'
import type { Element } from '../../src/core/types.js'

function makeEl(overrides: Partial<Element> = {}): Element {
  return {
    id: 'e1',
    role: 'button',
    label: 'Open',
    value: null,
    enabled: true,
    focused: false,
    actions: ['press'],
    bounds: [0, 0, 100, 40],
    parent: null,
    ...overrides,
  }
}

describe('selectActionForElement', () => {
  it('maps AX press-style controls to click', () => {
    const result = selectActionForElement(makeEl(), { intent: 'click Open' })
    expect(result?.action).toBe('click')
  })

  it('chooses type with a parsed value for text input intents', () => {
    const result = selectActionForElement(
      makeEl({ role: 'textbox', label: 'Email', actions: ['setValue'] }),
      { intent: 'type "me@example.com" into Email' },
    )
    expect(result?.action).toBe('type')
    expect(result?.value).toBe('me@example.com')
  })

  it('skips unsafe submit-like controls during navigation by default', () => {
    const result = selectActionForElement(
      makeEl({ role: 'button', label: 'Delete account' }),
      { purpose: 'navigation' },
    )
    expect(result).toBeNull()
  })

  it('allows submit-like controls during navigation when explicitly enabled', () => {
    const result = selectActionForElement(
      makeEl({ role: 'button', label: 'Sign in' }),
      { purpose: 'navigation', allowFormSubmit: true },
    )
    expect(result?.action).toBe('click')
  })

  it('chooses select for selection controls', () => {
    const result = selectActionForElement(
      makeEl({ role: 'combobox', label: 'Country', actions: ['showMenu'] }),
      { intent: 'select Country' },
    )
    expect(result?.action).toBe('select')
  })
})
