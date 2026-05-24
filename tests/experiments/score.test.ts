// tests/experiments/score.test.ts
//
// Unit tests for the DOE scoring + design utilities.

import { describe, it, expect } from 'vitest'
import {
  combineTurnLatencies,
  evaluatePredicate,
  evaluatePredicateFromSnapshot,
  fractionalFactorial16,
  mainEffects,
  shouldRetryStepFailure,
} from '../../.build-loop/experiments/lib/score.js'

describe('evaluatePredicate', () => {
  it('matches ax_text_contains case-insensitively', () => {
    expect(evaluatePredicate({ ax_text_contains: 'Camp' }, 'heading Camp Group')).toBe(true)
    expect(evaluatePredicate({ ax_text_contains: 'camp' }, 'heading CAMP Group')).toBe(true)
    expect(evaluatePredicate({ ax_text_contains: 'beach' }, 'heading Camp')).toBe(false)
  })

  it('matches url_matches as regex', () => {
    expect(evaluatePredicate({ url_matches: '.*/trips$' }, 'snap', 'http://localhost:3000/trips')).toBe(true)
    expect(evaluatePredicate({ url_matches: '.*/trips$' }, 'snap', 'http://localhost:3000/trips/123')).toBe(false)
  })

  it('matches url_matches from snapshot tool response metadata', () => {
    expect(evaluatePredicateFromSnapshot(
      { url_matches: '.*/trips$' },
      { snapshot: 'heading Trips', url: 'https://example.test/trips' },
    )).toBe(true)
  })

  it('handles element_visible role+label', () => {
    const snapshot = `[e1] button "Submit"\n[e7] heading "Camp Group"`
    expect(evaluatePredicate({ element_visible: { role: 'heading', label_contains: 'camp' } }, snapshot)).toBe(true)
    expect(evaluatePredicate({ element_visible: { role: 'textbox' } }, snapshot)).toBe(false)
  })
})

describe('walkthrough runner measurement helpers', () => {
  it('allows exactly one step-failure retry for retrying policies', () => {
    expect(shouldRetryStepFailure('oneRetryResnapshot', false)).toBe(true)
    expect(shouldRetryStepFailure('oneRetryResnapshot', true)).toBe(false)
    expect(shouldRetryStepFailure('none', false)).toBe(false)
  })

  it('combines split LLM and executor turn latency arrays', () => {
    expect(combineTurnLatencies([100, 200], [30, 40])).toEqual([130, 240])
    expect(combineTurnLatencies([100], [30, 40])).toEqual([130, 40])
  })
})

describe('fractionalFactorial16', () => {
  it('emits exactly 16 cells', () => {
    const cells = fractionalFactorial16(['F1', 'F2', 'F3', 'F4', 'F5'])
    expect(cells).toHaveLength(16)
  })

  it('F5 = F1 ⊕ F2 ⊕ F3 ⊕ F4 (resolution V generator)', () => {
    const cells = fractionalFactorial16(['F1', 'F2', 'F3', 'F4', 'F5'])
    for (const row of cells) {
      const want = ((row.F1 as number) ^ (row.F2 as number) ^ (row.F3 as number) ^ (row.F4 as number)) & 1
      expect(row.F5).toBe(want)
    }
  })

  it('each factor is balanced (8 zeros + 8 ones)', () => {
    const cells = fractionalFactorial16(['F1', 'F2', 'F3', 'F4', 'F5'])
    for (const f of ['F1', 'F2', 'F3', 'F4', 'F5']) {
      const zeros = cells.filter((c) => c[f] === 0).length
      expect(zeros).toBe(8)
    }
  })
})

describe('mainEffects', () => {
  it('computes effect = high - low per factor', () => {
    const rows = [
      { F1: 1 as const, success: 1 },
      { F1: 1 as const, success: 1 },
      { F1: 0 as const, success: 0 },
      { F1: 0 as const, success: 0 },
    ]
    const e = mainEffects(rows, ['F1'], 'success')
    expect(e.F1.effect).toBe(1)
    expect(e.F1.absEffect).toBe(1)
    expect(e.F1.lowMean).toBe(0)
    expect(e.F1.highMean).toBe(1)
  })

  it('reports zero N for empty cells without throwing', () => {
    const rows: Array<{ F1: 0 | 1; success: number }> = []
    const e = mainEffects(rows, ['F1'], 'success')
    expect(e.F1.lowN).toBe(0)
    expect(e.F1.highN).toBe(0)
    expect(e.F1.effect).toBe(0)
  })
})
