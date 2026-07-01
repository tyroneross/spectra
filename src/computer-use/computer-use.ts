// src/computer-use/computer-use.ts
//
// AX-first, vision-fallback computer-use orchestration, focused-window scoped.
//
// Design (per efficient-computer-use research, 2026):
//   • AX-first        — resolve actions against the semantic AX tree (role/label),
//                       never coordinate clicks. Cheap + label-free grounding.
//   • Focused scope   — every perceive/act call targets the focused window only.
//   • Snapshot cache  — reuse the last AX snapshot; re-read only on change. A
//                       verified set-value updates the cached node in place
//                       instead of forcing a full re-walk (ReVision idea).
//   • Vision fallback — gated on AX-node-count. If the tree is empty/thin AND a
//                       VisionFallback is wired + available, ground from pixels;
//                       otherwise return a needsVisionFallback SIGNAL, not a crash.
//   • Form-filling    — first-class: resolve {label→value} against editable AX
//                       nodes, set, and VERIFY each field via read-back.
//   • Failure modes   — permission errors surface as AxPermissionError; empty AX
//                       and unmatched labels degrade to the fallback signal.
//
// SPDX-License-Identifier: Apache-2.0

import { AxPermissionError, isPermissionMessage, type AxBridgePort } from './port.js'
import type { VisionFallback } from './vision-fallback.js'
import type {
  ActOutcome,
  AxNode,
  AxSnapshot,
  AxTarget,
  ComputerUseAction,
  FieldResult,
  FillFormResult,
} from './types.js'

export interface ComputerUseOptions {
  /** Optional pixel-grounding fallback. Omit to run AX-only (returns signals). */
  visionFallback?: VisionFallback
  /** Minimum AX node-count before the vision fallback is considered. Default 1
   * (i.e. an empty tree triggers the fallback). */
  visionFallbackThreshold?: number
  /** App/window to scope to. Omit to target the focused (frontmost) app. */
  target?: AxTarget
}

/** Editable AX roles for form-field resolution. */
const EDITABLE_ROLES = new Set(['AXTextField', 'AXTextArea', 'AXComboBox', 'AXSecureTextField'])

function normalize(text: string): string {
  return text.trim().toLowerCase()
}

function isEditable(node: AxNode): boolean {
  return node.actions.includes('setValue') || EDITABLE_ROLES.has(node.role)
}

export class ComputerUse {
  private readonly port: AxBridgePort
  private readonly opts: ComputerUseOptions
  private readonly threshold: number
  private cache: AxSnapshot | null = null

  constructor(port: AxBridgePort, opts: ComputerUseOptions = {}) {
    this.port = port
    this.opts = opts
    this.threshold = opts.visionFallbackThreshold ?? 1
  }

  /** Preflight the Accessibility permission without prompting. */
  async preflight(): Promise<{ trusted: boolean }> {
    return this.port.preflight()
  }

  /** Discard the cached snapshot so the next perceive re-reads the window. */
  invalidate(): void {
    this.cache = null
  }

  /**
   * Snapshot the focused window as a scoped AX tree. Cached: repeated calls
   * reuse the last snapshot until an action invalidates it or `refresh` is set.
   */
  async snapshotFocusedWindow(options: { refresh?: boolean } = {}): Promise<AxSnapshot> {
    if (this.cache && !options.refresh) return this.cache

    let raw
    try {
      raw = await this.port.snapshotFocused(this.opts.target)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof AxPermissionError || isPermissionMessage(message)) {
        throw new AxPermissionError(
          'Accessibility permission not granted. Grant it in System Settings → Privacy & Security → Accessibility, then retry.',
        )
      }
      throw err
    }

    let nodes = raw.elements
    let needsVisionFallback = raw.axStatus !== 'ok' || raw.nodeCount < this.threshold
    let fallbackReason: string | undefined
    if (needsVisionFallback) {
      fallbackReason =
        raw.axStatus === 'no-window' ? 'no-window'
        : raw.axStatus === 'empty' ? 'empty'
        : 'below-threshold'

      const vf = this.opts.visionFallback
      if (vf && vf.available()) {
        const grounded = await vf.ground(this.opts.target, { reason: fallbackReason, nodeCount: raw.nodeCount })
        if (grounded.length >= this.threshold) {
          nodes = grounded
          needsVisionFallback = false
          fallbackReason = 'vision-fallback-applied'
        }
      }
    }

    // A vision-grounded snapshot carries real nodes; keeping the original
    // 'empty'/'no-window' axStatus would misreport a usable snapshot as failed.
    const axStatus = fallbackReason === 'vision-fallback-applied' ? 'ok' : raw.axStatus

    const snapshot: AxSnapshot = {
      window: raw.window,
      nodes,
      nodeCount: nodes.length,
      axStatus,
      focusedWindowTitle: raw.focusedWindowTitle,
      needsVisionFallback,
      fallbackReason,
    }
    this.cache = snapshot
    return snapshot
  }

  /** Route a single action to the right primitive. AX-node resolution first;
   * fall back to a signal (never a crash) when the tree can't ground it. */
  async act(action: ComputerUseAction): Promise<ActOutcome> {
    switch (action.kind) {
      case 'click':
        return this.click(action)
      case 'set-value':
        return this.setValue(action.label, action.value, action)
      case 'key':
        return this.key(action)
    }
  }

  /**
   * Resolve a {label → value} map against the focused window's editable AX
   * nodes, set each via AX, and verify each by read-back. First-class
   * form-filling: one snapshot, per-field verification, no blind coordinate typing.
   */
  async fillForm(fields: Record<string, string>): Promise<FillFormResult> {
    const snapshot = await this.snapshotFocusedWindow()
    const results: FieldResult[] = []

    for (const [label, value] of Object.entries(fields)) {
      const node = this.resolveEditable(label)
      if (!node) {
        results.push({ label, expected: value, matched: false, set: false, verified: false })
        continue
      }
      const outcome = await this.setValue(label, value, { kind: 'set-value', label, value })
      results.push({
        label,
        expected: value,
        matched: true,
        set: outcome.success,
        verified: outcome.verified === true,
        actual: outcome.actualValue,
        error: outcome.error,
      })
    }

    const anyMatched = results.some((r) => r.matched)
    const allVerified = results.length > 0 && results.every((r) => r.verified)
    // If nothing could be matched and the tree was thin, that's a fallback case.
    const needsVisionFallback = snapshot.needsVisionFallback && !anyMatched
    return { fields: results, allVerified, needsVisionFallback }
  }

  // ─── Primitives ─────────────────────────────────────────

  private async click(action: { kind: 'click'; role?: string; label: string }): Promise<ActOutcome> {
    const node = this.resolveByLabel(action.label, {
      role: action.role,
      prefer: (n) => n.actions.includes('press'),
    })
    if (!node) return this.unresolved(action)

    const res = await this.port.act({ target: this.opts.target, elementPath: node.path, action: 'press' })
    this.invalidate() // a click may mutate the window arbitrarily
    return {
      action,
      success: res.success,
      matched: true,
      matchedNode: node,
      error: res.error,
    }
  }

  private async setValue(label: string, value: string, action: ComputerUseAction): Promise<ActOutcome> {
    const node = this.resolveEditable(label)
    if (!node) return this.unresolved(action)

    const res = await this.port.act({
      target: this.opts.target,
      elementPath: node.path,
      action: 'setValue',
      value,
    })
    const verified = res.success && normalize(res.value ?? '') === normalize(value)

    // Known change: patch the cached node value in place instead of re-walking
    // the whole window (efficiency — only re-read on unknown change).
    if (verified && this.cache) {
      const cached = this.cache.nodes.find((n) => n.path.join(',') === node.path.join(','))
      if (cached) cached.value = res.value ?? value
    }

    return {
      action,
      success: res.success,
      matched: true,
      verified,
      matchedNode: node,
      actualValue: res.value,
      error: res.error,
    }
  }

  private async key(action: { kind: 'key'; key: string }): Promise<ActOutcome> {
    const res = await this.port.key({ target: this.opts.target, key: action.key })
    this.invalidate()
    return { action, success: res.success, matched: true, error: res.error }
  }

  // ─── Resolution ─────────────────────────────────────────

  private resolveEditable(label: string): AxNode | undefined {
    return this.resolveByLabel(label, { prefer: isEditable, require: isEditable })
  }

  private resolveByLabel(
    label: string,
    opts: { role?: string; prefer?: (n: AxNode) => boolean; require?: (n: AxNode) => boolean } = {},
  ): AxNode | undefined {
    const nodes = this.cache?.nodes ?? []
    const target = normalize(label)

    // Match strength, strongest first. 'target-in-label' (the node's label
    // contains the full search term, e.g. searching "in" against "Sign In")
    // ranks above 'label-in-target' (the node's label is merely a substring OF
    // the search term, e.g. a node labeled "In" matching a search for "Sign
    // In") — the latter is the weaker, more accident-prone direction and must
    // never outrank a real match.
    type MatchKind = 'exact' | 'target-in-label' | 'label-in-target'
    const rank: Record<MatchKind, number> = { exact: 2, 'target-in-label': 1, 'label-in-target': 0 }

    const matched: Array<{ node: AxNode; kind: MatchKind }> = []
    for (const n of nodes) {
      if (opts.role && normalize(n.role) !== normalize(opts.role)) continue
      if (opts.require && !opts.require(n)) continue
      const nl = normalize(n.label)
      if (nl.length === 0) continue
      if (nl === target) matched.push({ node: n, kind: 'exact' })
      else if (nl.includes(target)) matched.push({ node: n, kind: 'target-in-label' })
      else if (target.includes(nl)) matched.push({ node: n, kind: 'label-in-target' })
    }
    if (matched.length === 0) return undefined

    // Exact-match-preferred: once an exact label match exists, no substring
    // candidate is eligible to shadow it — filter down before ranking.
    const hasExact = matched.some((m) => m.kind === 'exact')
    const eligible = hasExact ? matched.filter((m) => m.kind === 'exact') : matched

    // Rank: match strength, then preferred (interactive/editable), then
    // shortest label (most specific). Deterministic, no coordinates.
    eligible.sort((a, b) => {
      if (rank[a.kind] !== rank[b.kind]) return rank[b.kind] - rank[a.kind]
      if (opts.prefer) {
        const ap = opts.prefer(a.node) ? 1 : 0
        const bp = opts.prefer(b.node) ? 1 : 0
        if (ap !== bp) return bp - ap
      }
      return a.node.label.length - b.node.label.length
    })
    return eligible[0]?.node
  }

  /** Unresolved target: not a crash. Signals a vision fallback when the tree is thin. */
  private unresolved(action: ComputerUseAction): ActOutcome {
    const thin = this.cache?.needsVisionFallback ?? true
    const label = 'label' in action ? action.label : action.kind
    return {
      action,
      success: false,
      matched: false,
      needsVisionFallback: thin,
      error: `No AX node matched "${label}" in the focused window.${thin ? ' AX tree is empty/thin — vision fallback recommended.' : ''}`,
    }
  }
}
