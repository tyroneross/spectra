import { describe, it, expect, vi } from 'vitest'
import { waitForStableTree, buildFingerprint } from '../../src/cdp/wait.js'
import type { Element } from '../../src/core/types.js'

function makeEl(role: string, label: string, enabled = true, actions = ['press']): Element {
  return {
    id: 'e1', role, label, value: null, enabled, focused: false,
    actions, bounds: [0, 0, 0, 0], parent: null,
  }
}

describe('buildFingerprint', () => {
  it('builds fingerprint from interactive elements only', () => {
    const elements: Element[] = [
      makeEl('heading', 'Title', true, []),        // non-interactive, excluded
      makeEl('button', 'Submit'),                    // interactive
      makeEl('textfield', 'Email', true, ['setValue']),
    ]
    const fp = buildFingerprint(elements)
    expect(fp).toContain('button:Submit:true')
    expect(fp).toContain('textfield:Email:true')
    expect(fp).not.toContain('heading')
  })

  it('produces different fingerprint when enabled changes', () => {
    const a = [makeEl('button', 'Go', true)]
    const b = [makeEl('button', 'Go', false)]
    expect(buildFingerprint(a)).not.toBe(buildFingerprint(b))
  })

  it('is stable regardless of element order', () => {
    const a = [makeEl('button', 'A'), makeEl('button', 'B')]
    const b = [makeEl('button', 'B'), makeEl('button', 'A')]
    expect(buildFingerprint(a)).toBe(buildFingerprint(b))
  })
})

describe('waitForStableTree', () => {
  it('resolves immediately if tree is already stable', async () => {
    const stableElements = [makeEl('button', 'OK')]
    const getSnapshot = vi.fn().mockResolvedValue(stableElements)

    const result = await waitForStableTree(getSnapshot, {
      interval: 10, stableTime: 30, timeout: 2000,
    })

    expect(result.timedOut).toBe(false)
    expect(result.elements).toEqual(stableElements)
  })

  it('waits for tree to stabilize after changes', async () => {
    let callCount = 0
    const getSnapshot = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount <= 2) {
        // First 2 calls: changing tree (different label each time)
        return [makeEl('button', `Loading ${callCount}`)]
      }
      // After that: stable tree
      return [makeEl('button', 'Done')]
    })

    const result = await waitForStableTree(getSnapshot, {
      interval: 10, stableTime: 30, timeout: 2000,
    })

    expect(result.timedOut).toBe(false)
    expect(result.elements[0].label).toBe('Done')
    expect(getSnapshot.mock.calls.length).toBeGreaterThan(3)
  })

  it('returns timedOut when tree never stabilizes', async () => {
    let counter = 0
    const getSnapshot = vi.fn().mockImplementation(async () => {
      return [makeEl('button', `changing-${counter++}`)]
    })

    const result = await waitForStableTree(getSnapshot, {
      interval: 10, stableTime: 50, timeout: 200,
    })

    expect(result.timedOut).toBe(true)
    expect(result.elements).toHaveLength(1)
  })

  it('resets stability timer when fingerprint changes', async () => {
    let callCount = 0
    const getSnapshot = vi.fn().mockImplementation(async () => {
      callCount++
      // Stable for a bit, then change, then stable again
      if (callCount === 3) return [makeEl('button', 'Changed')]
      return [makeEl('button', 'Stable')]
    })

    const result = await waitForStableTree(getSnapshot, {
      interval: 10, stableTime: 30, timeout: 2000,
    })

    expect(result.timedOut).toBe(false)
  })
})
