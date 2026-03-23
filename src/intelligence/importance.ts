import type { Element } from '../core/types.js'
import type { ImportanceScore, ScoreFactor, RegionOfInterest, Viewport } from './types.js'
import { edgeDistance, regionLabel } from './spatial.js'

// ─── Role scores (UEyes CHI 2023) ────────────────────────────────────────────
const ROLE_SCORES: Record<string, number> = {
  heading:   1.0,
  button:    0.9,
  link:      0.8,
  image:     0.8,
  textbox:   0.7,
  tab:       0.7,
  menuitem:  0.6,
  text:      0.4,
  group:     0.1,
  separator: 0.0,
}
const ROLE_SCORE_UNKNOWN = 0.3

const WEIGHTS = {
  role:      0.30,
  position:  0.20,
  interact:  0.15,
  label:     0.15,
  density:   0.10,
  visual:    0.10,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0.0, hi = 1.0): number {
  return Math.max(lo, Math.min(hi, v))
}

function elementCenter(el: Element): [number, number] {
  const [x, y, w, h] = el.bounds
  return [x + w / 2, y + h / 2]
}

// ─── Six scoring signals ──────────────────────────────────────────────────────

function scoreRole(el: Element): ScoreFactor {
  const value = el.role in ROLE_SCORES ? ROLE_SCORES[el.role] : ROLE_SCORE_UNKNOWN
  return {
    name:   'role',
    weight: WEIGHTS.role,
    value,
    reason: `role "${el.role}" maps to ${value}`,
  }
}

function scorePosition(el: Element, viewport: Viewport): ScoreFactor {
  const [x, y] = el.bounds
  const vw = viewport.width  * viewport.devicePixelRatio
  const vh = viewport.height * viewport.devicePixelRatio

  const normY = clamp(y / vh)
  const normX = clamp(x / vw)
  let value = 1.0 - (normY * 0.7 + normX * 0.3)

  // Above-fold bonus
  if (y < viewport.height) {
    value = clamp(value + 0.2)
  }
  value = clamp(value)

  return {
    name:   'position',
    weight: WEIGHTS.position,
    value,
    reason: `normalizedY=${normY.toFixed(2)} normalizedX=${normX.toFixed(2)} aboveFold=${y < viewport.height}`,
  }
}

function scoreInteractivity(el: Element): ScoreFactor {
  const value = el.actions.length > 0 ? 1.0 : 0.0
  return {
    name:   'interactivity',
    weight: WEIGHTS.interact,
    value,
    reason: `${el.actions.length} action(s): [${el.actions.join(', ')}]`,
  }
}

function scoreLabelQuality(el: Element): ScoreFactor {
  const len = el.label.length
  let value: number
  let reason: string
  if (len === 0) {
    value = 0.0; reason = 'empty label'
  } else if (len === 1) {
    value = 0.2; reason = 'single-char label'
  } else if (len <= 20) {
    value = 1.0; reason = `short label (${len} chars)`
  } else if (len <= 50) {
    value = 1.0; reason = `medium label (${len} chars)`
  } else {
    value = 0.5; reason = `long label (${len} chars)`
  }
  return {
    name:   'label_quality',
    weight: WEIGHTS.label,
    value,
    reason,
  }
}

function scoreContentDensity(el: Element, all: Element[]): ScoreFactor {
  const [cx, cy] = elementCenter(el)
  let count = 0
  for (const other of all) {
    if (other.id === el.id) continue
    const [ox, oy] = elementCenter(other)
    const d = Math.sqrt((cx - ox) ** 2 + (cy - oy) ** 2)
    if (d <= 50) count++
  }
  const value = clamp(count / 10)
  return {
    name:   'content_density',
    weight: WEIGHTS.density,
    value,
    reason: `${count} element(s) within 50px radius`,
  }
}

function scoreVisualProminence(el: Element, viewport: Viewport): ScoreFactor {
  const [,, w, h] = el.bounds
  const viewportArea = viewport.width * viewport.height * viewport.devicePixelRatio * viewport.devicePixelRatio
  const area = w * h
  const normalized = viewportArea > 0 ? area / viewportArea : 0
  const value = clamp(normalized * 5)
  return {
    name:   'visual_prominence',
    weight: WEIGHTS.visual,
    value,
    reason: `area=${area} viewportArea=${viewportArea} normalizedArea=${normalized.toFixed(4)}`,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function scoreElements(elements: Element[], viewport: Viewport): ImportanceScore[] {
  if (elements.length === 0) return []

  const scores: ImportanceScore[] = elements.map(el => {
    const factors: ScoreFactor[] = [
      scoreRole(el),
      scorePosition(el, viewport),
      scoreInteractivity(el),
      scoreLabelQuality(el),
      scoreContentDensity(el, elements),
      scoreVisualProminence(el, viewport),
    ]

    const score = clamp(
      factors.reduce((sum, f) => sum + f.weight * f.value, 0)
    )

    return { elementId: el.id, score, factors }
  })

  return scores.sort((a, b) => b.score - a.score)
}

// ─── Region detection ─────────────────────────────────────────────────────────

export function findRegions(scores: ImportanceScore[], elements: Element[]): RegionOfInterest[] {
  // Filter to high-scoring elements
  const highIds = new Set(scores.filter(s => s.score >= 0.4).map(s => s.elementId))
  const elemMap = new Map(elements.map(e => [e.id, e]))
  const highEls = [...highIds].map(id => elemMap.get(id)).filter((e): e is Element => !!e)

  if (highEls.length === 0) return []

  // Union-Find
  const parent = new Map<string, string>()
  for (const el of highEls) parent.set(el.id, el.id)

  function find(id: string): string {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)!
    // Path compression
    let cur = id
    while (cur !== root) { const next = parent.get(cur)!; parent.set(cur, root); cur = next }
    return root
  }

  function union(a: string, b: string) {
    parent.set(find(a), find(b))
  }

  for (let i = 0; i < highEls.length; i++) {
    for (let j = i + 1; j < highEls.length; j++) {
      if (edgeDistance(highEls[i], highEls[j]) <= 30) {
        union(highEls[i].id, highEls[j].id)
      }
    }
  }

  // Group by root
  const groups = new Map<string, string[]>()
  for (const el of highEls) {
    const root = find(el.id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(el.id)
  }

  const scoreMap = new Map(scores.map(s => [s.elementId, s.score]))

  const regions: RegionOfInterest[] = []
  for (const [, memberIds] of groups) {
    const members = memberIds.map(id => elemMap.get(id)!).filter(Boolean)

    // Bounding box = union of all member bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const el of members) {
      const [x, y, w, h] = el.bounds
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + w)
      maxY = Math.max(maxY, y + h)
    }

    const avgScore = memberIds.reduce((s, id) => s + (scoreMap.get(id) ?? 0), 0) / memberIds.length

    regions.push({
      bounds: [minX, minY, maxX - minX, maxY - minY],
      score:  avgScore,
      elements: memberIds,
      label:  regionLabel(members),
    })
  }

  return regions.sort((a, b) => b.score - a.score)
}
