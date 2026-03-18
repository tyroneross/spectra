import type { Element, ResolveOptions, ResolveResult } from './types.js'

export function resolve(options: ResolveOptions): ResolveResult {
  if (options.mode === 'algorithmic') {
    throw new Error('Algorithmic resolution not available in Phase 1. Use mode: "claude".')
  }

  const { intent, elements } = options

  if (elements.length === 0) {
    return { element: null as unknown as Element, confidence: 0, candidates: [] }
  }

  const intentLower = intent.toLowerCase()
  const scored = scoreElements(elements, intentLower)

  if (scored.length === 0) {
    return {
      element: elements[0],
      confidence: 0,
      candidates: elements.filter((e) => e.actions.length > 0),
    }
  }

  const best = scored[0]

  // High confidence: single clear winner
  if (best.score >= 1.0 || (scored.length === 1 && best.score >= 0.5)) {
    return {
      element: best.element,
      confidence: best.score,
    }
  }

  // Multiple close candidates
  const threshold = best.score * 0.8
  const candidates = scored.filter((s) => s.score >= threshold).map((s) => s.element)

  return {
    element: best.element,
    confidence: best.score,
    candidates: candidates.length > 1 ? candidates : undefined,
  }
}

interface ScoredElement {
  element: Element
  score: number
}

function scoreElements(elements: Element[], intentLower: string): ScoredElement[] {
  const scored: ScoredElement[] = []

  for (const el of elements) {
    const labelLower = el.label.toLowerCase()
    let score = 0

    if (labelLower.length === 0) continue

    // Exact match: intent contains the full label as a substring
    // Use word boundary regex to ensure it's not a substring of another word
    const escapedLabel = escapeRegex(labelLower)
    const labelRegex = new RegExp(`\\b${escapedLabel}\\b`, 'i')

    if (labelRegex.test(intentLower)) {
      // Check if label is multi-word or single word
      const labelWords = labelLower.trim().split(/\s+/)

      // Multi-word labels matching are strong exact matches
      if (labelWords.length > 1) {
        score = 1.0
      } else {
        // Single-word label: could be ambiguous if there are similar matches
        // Check if the word appears standalone or is part of context
        const intentWords = intentLower.split(/\s+/)
        const exactWordMatch = intentWords.includes(labelLower)

        if (exactWordMatch && labelWords[0].length > 1) {
          // Single word that appears exactly, but might be ambiguous
          // We'll score it as 0.5 to indicate it needs disambiguation
          score = 0.5
        }
      }
    } else {
      // Partial match: some intent words appear in label
      const intentWords = intentLower.split(/\s+/)
      const matchedWords = intentWords.filter(
        (w) => w.length > 2 && labelLower.includes(w),
      )
      if (matchedWords.length > 0) {
        score = 0.5
      }
    }

    // Role match bonus
    if (intentLower.includes(el.role)) {
      score = Math.min(score + 0.2, 1.0)
    }

    // Interactive elements get priority
    if (el.actions.length === 0 && score > 0) {
      score *= 0.5 // Penalize non-interactive
    }

    if (score > 0) {
      scored.push({ element: el, score })
    }
  }

  return scored.sort((a, b) => b.score - a.score)
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
