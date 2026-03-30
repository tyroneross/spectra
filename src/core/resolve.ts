import type { Element, ResolveOptions, ResolveResult } from './types.js'

export function resolve(options: ResolveOptions): ResolveResult {
  if (options.mode === 'algorithmic') {
    return resolveAlgorithmic(options)
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
      visionFallback: options.mode === 'claude',
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

  const result: ResolveResult = {
    element: best.element,
    confidence: best.score,
    candidates: candidates.length > 1 ? candidates : undefined,
  }

  // Vision fallback: when confidence < 0.3 in claude mode, signal screenshot needed
  if (best.score < 0.3 && options.mode === 'claude') {
    result.visionFallback = true
  }

  return result
}

// ─── Claude Mode Scoring (unchanged) ───────────────────────

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

// ─── Algorithmic Mode ──────────────────────────────────────

function resolveAlgorithmic(options: ResolveOptions): ResolveResult {
  const { intent, elements } = options

  if (elements.length === 0) {
    return { element: null as unknown as Element, confidence: 0, candidates: [] }
  }

  const intentLower = intent.toLowerCase()
  const hints = parseSpatialHints(intentLower)

  // Strip spatial hint words from intent for label matching
  const cleanedIntent = cleanIntent(intentLower)

  const scored: ScoredElement[] = []

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    let score = 0

    // ── Role filter (weight 0.3) ──
    const roleScore = scoreRole(cleanedIntent, el.role)

    // ── Label similarity (weight 0.5) ──
    // Suppress label noise when the cleaned intent is only a role word
    const intentIsOnlyRole = cleanedIntent.trim() === el.role.toLowerCase()
        || cleanedIntent.trim().split(/\s+/).every((w) => scoreRole(w, el.role) > 0)
    const labelScore = intentIsOnlyRole ? 0 : scoreLabelSimilarity(cleanedIntent, el.label)

    // ── Spatial hints (weight 0.2) ──
    const spatialScore = scoreSpatial(hints, el, i, elements)

    score = roleScore * 0.3 + labelScore * 0.5 + spatialScore * 0.2

    // Exact label match floor: if label similarity is perfect, ensure confidence >= 0.7
    if (labelScore >= 0.99) {
      score = Math.max(score, 0.75)
    }

    if (score > 0) {
      scored.push({ element: el, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    return { element: elements[0], confidence: 0, candidates: [] }
  }

  const best = scored[0]

  if (best.score >= 0.7) {
    return {
      element: best.element,
      confidence: best.score,
    }
  }

  // Below threshold: return candidates ranked by score
  return {
    element: best.element,
    confidence: best.score,
    candidates: scored.map((s) => s.element),
  }
}

function scoreRole(intent: string, role: string): number {
  const roleLower = role.toLowerCase()
  // Check if any word in the intent matches the role
  const intentWords = intent.split(/\s+/)
  for (const word of intentWords) {
    if (word === roleLower) return 1.0
    // Common synonyms
    if (word === 'btn' && roleLower === 'button') return 0.8
    if (word === 'input' && roleLower === 'textfield') return 0.8
    if (word === 'text' && roleLower === 'textfield') return 0.6
  }
  return 0
}

function scoreLabelSimilarity(intent: string, label: string): number {
  if (!label) return 0
  const labelLower = label.toLowerCase()

  // Exact containment: intent contains the full label
  if (intent.includes(labelLower)) return 1.0
  if (labelLower.includes(intent.trim())) return 0.9

  // Jaro-Winkler between intent and label
  // For multi-word labels, also try matching against individual intent words
  const jw = jaroWinkler(intent, labelLower)

  // Also try: best JW of label against each intent word (for short labels)
  const intentWords = intent.split(/\s+/).filter((w) => w.length > 2)
  let bestWordJw = 0
  for (const word of intentWords) {
    bestWordJw = Math.max(bestWordJw, jaroWinkler(word, labelLower))
  }

  // Also try: best JW of each label word against intent words
  const labelWords = labelLower.split(/\s+/).filter((w) => w.length > 2)
  let bestLabelWordJw = 0
  for (const lw of labelWords) {
    for (const iw of intentWords) {
      bestLabelWordJw = Math.max(bestLabelWordJw, jaroWinkler(iw, lw))
    }
  }

  return Math.max(jw, bestWordJw, bestLabelWordJw)
}

export interface SpatialHints {
  position?: 'first' | 'last' | 'top' | 'bottom'
  near?: string
  // Extended spatial fields (Phase 4)
  direction?: 'above' | 'below' | 'left' | 'right' | 'near'
  reference?: string   // e.g. "the header", "the form"
  ordinal?: number     // "first" = 1, "second" = 2, etc.
}

export function parseSpatialHints(intent: string): SpatialHints {
  const hints: SpatialHints = {}

  // ── Position (legacy compat) ──
  if (/\bfirst\b/.test(intent)) hints.position = 'first'
  else if (/\blast\b/.test(intent)) hints.position = 'last'
  else if (/\btop\b/.test(intent)) hints.position = 'top'
  else if (/\bbottom\b/.test(intent)) hints.position = 'bottom'

  const nearMatch = intent.match(/\b(?:next to|near|beside|by)\s+(.+?)(?:\s*$)/)
  if (nearMatch) hints.near = nearMatch[1].trim()

  // ── Ordinal (Phase 4) ──
  const ordinalMatch = intent.match(
    /\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\b/i,
  )
  if (ordinalMatch) {
    const ordinals: Record<string, number> = {
      first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3,
      fourth: 4, '4th': 4, fifth: 5, '5th': 5,
    }
    hints.ordinal = ordinals[ordinalMatch[1].toLowerCase()] ?? 1
  }

  // ── Directional reference (Phase 4) ──
  // "below the header", "above the form", "left of the nav", "right of the sidebar"
  const dirMatch = intent.match(
    /\b(above|below|under|left of|right of|near)\s+(?:the\s+)?(.+?)(?:\s*$)/i,
  )
  if (dirMatch) {
    const dirMap: Record<string, SpatialHints['direction']> = {
      above: 'above', below: 'below', under: 'below',
      'left of': 'left', 'right of': 'right', near: 'near',
    }
    hints.direction = dirMap[dirMatch[1].toLowerCase()]
    hints.reference = dirMatch[2].trim()
  }

  return hints
}

function scoreSpatial(
  hints: SpatialHints,
  el: Element,
  index: number,
  allElements: Element[],
): number {
  if (!hints.position && !hints.near) return 0

  let score = 0

  if (hints.position) {
    switch (hints.position) {
      case 'first':
      case 'top':
        // Earlier index = higher score. First element gets 1.0, linear decay.
        score = Math.max(0, 1.0 - index / Math.max(allElements.length - 1, 1))
        break
      case 'last':
      case 'bottom':
        // Later index = higher score
        score = index / Math.max(allElements.length - 1, 1)
        break
    }
  }

  if (hints.near) {
    // Find element with matching label near this one
    const nearLower = hints.near.toLowerCase()
    for (let i = 0; i < allElements.length; i++) {
      if (allElements[i].label.toLowerCase().includes(nearLower)) {
        // Proximity bonus: closer = higher score
        const distance = Math.abs(index - i)
        if (distance > 0 && distance <= 3) {
          score = Math.max(score, 1.0 - (distance - 1) * 0.3)
        }
        break
      }
    }
  }

  return score
}

function cleanIntent(intent: string): string {
  return intent
    .replace(/\b(first|last|top|bottom)\b/g, '')
    .replace(/\b(next to|near|beside|by)\s+\S+/g, '')
    .replace(/\b(click|tap|press|select|choose)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Jaro-Winkler ──────────────────────────────────────────

export function jaroWinkler(s1: string, s2: string, prefixScale = 0.1): number {
  if (s1 === s2) return 1.0
  if (s1.length === 0 || s2.length === 0) return 0.0

  const jaro = jaroDistance(s1, s2)
  if (jaro === 0) return 0

  // Winkler prefix bonus: common prefix up to 4 chars
  let prefixLen = 0
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length))
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefixLen++
    } else {
      break
    }
  }

  return jaro + prefixLen * prefixScale * (1 - jaro)
}

function jaroDistance(s1: string, s2: string): number {
  if (s1 === s2) return 1.0

  const len1 = s1.length
  const len2 = s2.length

  // Maximum matching distance
  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1)

  const s1Matches = new Array(len1).fill(false)
  const s2Matches = new Array(len2).fill(false)

  let matches = 0
  let transpositions = 0

  // Find matching characters
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow)
    const end = Math.min(i + matchWindow + 1, len2)

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue
      s1Matches[i] = true
      s2Matches[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0

  // Count transpositions
  let k = 0
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }

  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3
}
