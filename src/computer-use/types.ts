// src/computer-use/types.ts
//
// Public types for the AX-first computer-use capability slice. AX-first means we
// perceive and act through the macOS Accessibility tree (semantic role/label),
// scoped to the FOCUSED window, and only fall back to vision grounding when the
// AX tree is empty/thin. See ./computer-use.ts for the orchestration.
//
// SPDX-License-Identifier: Apache-2.0

/** A single Accessibility node, scoped to the focused window. `path` is a
 * child-index path RELATIVE to that window — the act() navigation key. */
export interface AxNode {
  role: string
  label: string
  value: string | null
  enabled: boolean
  focused: boolean
  actions: string[]
  bounds: [number, number, number, number]
  path: number[]
}

export interface AxWindow {
  title: string
  bounds: [number, number, number, number]
}

/** Native AX health for the focused window. `empty` (a window with no semantic
 * subtree — the kAXErrorCannotComplete class: Electron/Qt/canvas) and
 * `no-window` are the vision-fallback triggers, not crashes. */
export type AxStatus = 'ok' | 'empty' | 'no-window'

export interface AxSnapshot {
  window: AxWindow | null
  nodes: AxNode[]
  nodeCount: number
  axStatus: AxStatus
  focusedWindowTitle: string
  /** True when node-count is below the vision-fallback threshold. Callers should
   * route to a VisionFallback (if wired) rather than treat the tree as final. */
  needsVisionFallback: boolean
  fallbackReason?: string
}

/** Which app/window to scope to. Omit both fields to target the FOCUSED
 * (frontmost) app — the "focus the key window" default. */
export interface AxTarget {
  app?: string
  pid?: number
}

export type ComputerUseAction =
  | { kind: 'click'; role?: string; label: string }
  | { kind: 'set-value'; label: string; value: string }
  | { kind: 'key'; key: string }

export interface ActOutcome {
  action: ComputerUseAction
  success: boolean
  /** Whether a target AX node was resolved (distinct from whether the OS act
   * succeeded). matched:false + needsVisionFallback:true = route to vision. */
  matched: boolean
  /** set-value only: read-back value equals the requested value. */
  verified?: boolean
  matchedNode?: AxNode
  actualValue?: string | null
  error?: string
  needsVisionFallback?: boolean
}

export interface FieldResult {
  label: string
  expected: string
  matched: boolean
  set: boolean
  verified: boolean
  actual?: string | null
  error?: string
}

export interface FillFormResult {
  fields: FieldResult[]
  allVerified: boolean
  needsVisionFallback: boolean
}
