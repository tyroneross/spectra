import { describe, it, expect } from 'vitest'
import { serializeSnapshot, serializeElement } from '../../src/core/serialize.js'
import type { Element, Snapshot } from '../../src/core/types.js'

function makeElement(overrides: Partial<Element> & { id: string; role: string; label: string }): Element {
  return { value: null, enabled: true, focused: false, actions: [], bounds: [0, 0, 0, 0], parent: null, ...overrides }
}

describe('serializeElement', () => {
  it('serializes a button (enabled)', () => {
    const el = makeElement({ id: 'e4', role: 'button', label: 'Log In', actions: ['press'] })
    expect(serializeElement(el)).toBe('[e4] button "Log In" enabled, actions:[press], bounds:[0,0,0,0]')
  })
  it('serializes a disabled button', () => {
    const el = makeElement({ id: 'e5', role: 'button', label: 'Submit', enabled: false })
    expect(serializeElement(el)).toBe('[e5] button "Submit" disabled, bounds:[0,0,0,0]')
  })
  it('serializes an empty focused textfield', () => {
    const el = makeElement({ id: 'e2', role: 'textfield', label: 'Email', value: '', focused: true, actions: ['setValue'] })
    expect(serializeElement(el)).toBe('[e2] textfield "Email" empty, focused, actions:[setValue], bounds:[0,0,0,0]')
  })
  it('serializes a textfield with value', () => {
    const el = makeElement({ id: 'e3', role: 'textfield', label: 'Name', value: 'Alice', actions: ['setValue'] })
    expect(serializeElement(el)).toBe('[e3] textfield "Name" value="Alice", actions:[setValue], bounds:[0,0,0,0]')
  })
  it('serializes a textfield with null value as empty', () => {
    const el = makeElement({ id: 'e3', role: 'textfield', label: 'Password', actions: ['setValue'] })
    expect(serializeElement(el)).toBe('[e3] textfield "Password" empty, actions:[setValue], bounds:[0,0,0,0]')
  })
  it('serializes a link', () => {
    const el = makeElement({ id: 'e6', role: 'link', label: 'Forgot password?', actions: ['press'] })
    expect(serializeElement(el)).toBe('[e6] link "Forgot password?" actions:[press], bounds:[0,0,0,0]')
  })
  it('serializes a heading', () => {
    const el = makeElement({ id: 'e1', role: 'heading', label: 'Welcome Back' })
    expect(serializeElement(el)).toBe('[e1] heading "Welcome Back" bounds:[0,0,0,0]')
  })
  it('serializes a checkbox with value', () => {
    const el = makeElement({ id: 'e7', role: 'checkbox', label: 'Remember me', value: 'true', actions: ['press'] })
    expect(serializeElement(el)).toBe('[e7] checkbox "Remember me" value="true", actions:[press], bounds:[0,0,0,0]')
  })
  it('serializes a switch', () => {
    const el = makeElement({ id: 'e8', role: 'switch', label: 'Dark mode', value: 'off', actions: ['press'] })
    expect(serializeElement(el)).toBe('[e8] switch "Dark mode" value="off", actions:[press], bounds:[0,0,0,0]')
  })
  it('includes bounds when non-zero', () => {
    const el = makeElement({ id: 'e9', role: 'button', label: 'Buy', bounds: [200, 300, 120, 40] })
    expect(serializeElement(el)).toContain('bounds:[200,300,120,40]')
  })
  it('includes parent when set', () => {
    const el = makeElement({ id: 'e10', role: 'button', label: 'OK', parent: 'e2' })
    expect(serializeElement(el)).toContain('parent:e2')
  })
  it('omits parent when null', () => {
    const el = makeElement({ id: 'e11', role: 'button', label: 'Cancel', parent: null })
    expect(serializeElement(el)).not.toContain('parent:')
  })
  it('omits actions when empty', () => {
    const el = makeElement({ id: 'e12', role: 'text', label: 'Info', actions: [] })
    expect(serializeElement(el)).not.toContain('actions:')
  })
  it('rounds fractional bounds to integers', () => {
    const el = makeElement({ id: 'e13', role: 'text', label: 'Hi', bounds: [10.6, 20.3, 100.9, 30.1] })
    expect(serializeElement(el)).toContain('bounds:[11,20,101,30]')
  })
  it('serializes multiple actions', () => {
    const el = makeElement({ id: 'e14', role: 'textfield', label: 'Search', actions: ['click', 'type', 'focus'] })
    expect(serializeElement(el)).toContain('actions:[click,type,focus]')
  })
})

describe('serializeSnapshot', () => {
  it('serializes a full login page snapshot', () => {
    const snapshot: Snapshot = {
      url: 'http://localhost:3000/login', platform: 'web',
      elements: [
        makeElement({ id: 'e1', role: 'heading', label: 'Welcome Back' }),
        makeElement({ id: 'e2', role: 'textfield', label: 'Email address', value: '', focused: true, actions: ['setValue'] }),
        makeElement({ id: 'e3', role: 'textfield', label: 'Password', actions: ['setValue'] }),
        makeElement({ id: 'e4', role: 'button', label: 'Log In', actions: ['press'] }),
        makeElement({ id: 'e5', role: 'link', label: 'Forgot your password?', actions: ['press'] }),
      ],
      timestamp: 1710000000000,
    }
    const result = serializeSnapshot(snapshot)
    const lines = result.split('\n')
    expect(lines[0]).toBe('# Page: http://localhost:3000/login')
    expect(lines[1]).toBe('# Platform: web | Elements: 5 | Timestamp: 1710000000000')
    expect(lines[2]).toBe('')
    expect(lines[3]).toBe('[e1] heading "Welcome Back" bounds:[0,0,0,0]')
    expect(lines[4]).toBe('[e2] textfield "Email address" empty, focused, actions:[setValue], bounds:[0,0,0,0]')
    expect(lines[5]).toBe('[e3] textfield "Password" empty, actions:[setValue], bounds:[0,0,0,0]')
    expect(lines[6]).toBe('[e4] button "Log In" enabled, actions:[press], bounds:[0,0,0,0]')
    expect(lines[7]).toBe('[e5] link "Forgot your password?" actions:[press], bounds:[0,0,0,0]')
  })
  it('serializes a macOS app snapshot', () => {
    const snapshot: Snapshot = {
      appName: 'Safari', platform: 'macos',
      elements: [makeElement({ id: 'e1', role: 'textfield', label: 'Address and Search', value: 'google.com', actions: ['setValue'] })],
      timestamp: 1710000000000,
    }
    const result = serializeSnapshot(snapshot)
    expect(result).toContain('# Page: Safari')
    expect(result).toContain('# Platform: macos | Elements: 1 | Timestamp: 1710000000000')
    expect(result).toContain('[e1] textfield "Address and Search" value="google.com", actions:[setValue], bounds:[0,0,0,0]')
  })
  it('handles empty snapshot', () => {
    const snapshot: Snapshot = { url: 'about:blank', platform: 'web', elements: [], timestamp: 1710000000000 }
    const result = serializeSnapshot(snapshot)
    expect(result).toContain('Elements: 0')
    expect(result).toContain('Timestamp: 1710000000000')
  })
})
