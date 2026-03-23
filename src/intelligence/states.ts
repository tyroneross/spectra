import type { Snapshot, Driver, Platform } from '../core/types.js'
import type { UIState, StateDetection } from './types.js'

// ─── Structural roles excluded from element counts ───────────────────────────
const STRUCTURAL_ROLES = new Set(['group', 'generic', 'none', 'presentation', 'separator'])

// ─── Interactive roles for focused detection ──────────────────────────────────
const INTERACTIVE_ROLES = new Set(['button', 'textbox', 'link', 'tab', 'combobox', 'listbox', 'checkbox', 'radio', 'menuitem', 'option', 'searchbox', 'spinbutton', 'slider'])

function nonStructural(elements: Snapshot['elements']): Snapshot['elements'] {
  return elements.filter(el => !STRUCTURAL_ROLES.has(el.role))
}

interface ScoreAccum {
  score: number
  ids: string[]
}

export function detectState(snapshot: Snapshot): StateDetection {
  const { elements } = snapshot
  const nonStruct = nonStructural(elements)

  const loading: ScoreAccum = { score: 0, ids: [] }
  const error: ScoreAccum = { score: 0, ids: [] }
  const empty: ScoreAccum = { score: 0, ids: [] }
  const populated: ScoreAccum = { score: 0, ids: [] }

  let focusedInteractiveId: string | null = null

  for (const el of elements) {
    const role = el.role.toLowerCase()
    const label = el.label

    // ── Loading indicators ──────────────────────────────────────
    if (role === 'progressbar') {
      loading.score += 3
      loading.ids.push(el.id)
    }
    if (role.includes('busy')) {
      loading.score += 2
      loading.ids.push(el.id)
    }
    if (/loading|spinner|please wait/i.test(label)) {
      loading.score += 2
      loading.ids.push(el.id)
    }
    if (/fetching|retrieving/i.test(label)) {
      loading.score += 1
      loading.ids.push(el.id)
    }

    // ── Error indicators ────────────────────────────────────────
    if (role === 'alert') {
      error.score += 3
      error.ids.push(el.id)
    }
    if (/error|failed|failure|exception/i.test(label)) {
      error.score += 3
      error.ids.push(el.id)
    }
    if (/something went wrong|try again|oops/i.test(label)) {
      error.score += 2
      error.ids.push(el.id)
    }
    if (role === 'status' && /error|fail/i.test(label)) {
      error.score += 2
      error.ids.push(el.id)
    }

    // ── Empty indicators ────────────────────────────────────────
    if (/no items|no results|nothing here|empty|get started/i.test(label)) {
      empty.score += 3
      empty.ids.push(el.id)
    }
    if (/no data|nothing to show|add your first/i.test(label)) {
      empty.score += 2
      empty.ids.push(el.id)
    }

    // ── Focused indicator ───────────────────────────────────────
    if (el.focused && INTERACTIVE_ROLES.has(role)) {
      focusedInteractiveId = el.id
    }
  }

  // ── Empty: few but non-zero elements ───────────────────────────
  // Only score "few elements" when the snapshot has some content (avoids
  // misidentifying a completely empty snapshot as empty rather than unknown).
  if (nonStruct.length > 0 && nonStruct.length < 5) {
    empty.score += 2
    empty.ids.push(...nonStruct.slice(0, 1).map(e => e.id))
  }

  // ── Populated indicators ────────────────────────────────────────
  if (nonStruct.length > 10) {
    populated.score += 2
    populated.ids.push(...nonStruct.slice(0, 3).map(e => e.id))
  }

  const distinctRoles = new Set(nonStruct.map(e => e.role))
  if (distinctRoles.size >= 3) {
    populated.score += 1
    // credit first element of each of the first 3 distinct roles
    const seen = new Set<string>()
    for (const el of nonStruct) {
      if (!seen.has(el.role)) {
        seen.add(el.role)
        populated.ids.push(el.id)
        if (seen.size >= 3) break
      }
    }
  }

  const hasHeading = elements.some(e => /heading/i.test(e.role))
  const hasContent = elements.some(e => /paragraph|text|listitem|article/i.test(e.role))
  if (hasHeading && hasContent) {
    populated.score += 1
    const heading = elements.find(e => /heading/i.test(e.role))
    const content = elements.find(e => /paragraph|text|listitem|article/i.test(e.role))
    if (heading) populated.ids.push(heading.id)
    if (content) populated.ids.push(content.id)
  }

  const hasLoadingOrErrorOrEmpty =
    loading.score > 0 || error.score > 0 || empty.score > 0
  if (!hasLoadingOrErrorOrEmpty && nonStruct.length > 0) {
    populated.score += 1
  }

  // ── Determine winner ────────────────────────────────────────────
  const scores: { state: UIState; accum: ScoreAccum }[] = [
    { state: 'loading', accum: loading },
    { state: 'error', accum: error },
    { state: 'empty', accum: empty },
    { state: 'populated', accum: populated },
  ]

  const sorted = [...scores].sort((a, b) => b.accum.score - a.accum.score)
  const winner = sorted[0]
  const runnerUp = sorted[1]

  if (winner.accum.score === 0) {
    return { state: 'unknown', confidence: 0, indicators: [] }
  }

  // Focused overrides populated when populated wins
  if (focusedInteractiveId !== null && winner.state === 'populated') {
    const confidence =
      winner.accum.score / (winner.accum.score + runnerUp.accum.score + 1)
    const indicators = dedupe([...winner.accum.ids, focusedInteractiveId])
    return { state: 'focused', confidence, indicators }
  }

  const confidence =
    winner.accum.score / (winner.accum.score + runnerUp.accum.score + 1)
  const indicators = dedupe(winner.accum.ids)

  return { state: winner.state, confidence, indicators }
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)]
}

// ─── State Triggers ───────────────────────────────────────────────────────────

export interface StateTrigger {
  state: UIState
  platform: Platform
  trigger: () => Promise<void>
  restore: () => Promise<void>
}

export function createStateTriggers(_driver: Driver, _platform: Platform): StateTrigger[] {
  // TODO: Implement CDP network interception triggers in Chunk 3
  return []
}
