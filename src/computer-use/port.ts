// src/computer-use/port.ts
//
// The injectable seam between the computer-use orchestration and the native AX
// bridge. ComputerUse depends ONLY on AxBridgePort, never on the child-process
// bridge directly — so unit tests inject a fake AX snapshot (no GUI session
// needed) and the daemon injects the real NativeAxBridgePort (./native-port.ts).
//
// SPDX-License-Identifier: Apache-2.0

import type { AxNode, AxStatus, AxTarget } from './types.js'

export interface RawAxSnapshot {
  window: { title: string; bounds: [number, number, number, number] } | null
  elements: AxNode[]
  nodeCount: number
  axStatus: AxStatus
  focusedWindowTitle: string
}

export interface RawActRequest {
  target?: AxTarget
  elementPath: number[]
  /** Native verb — the orchestrator maps click→press, set-value→setValue. */
  action: 'press' | 'setValue'
  value?: string
}

export interface RawActResult {
  success: boolean
  /** setValue: post-set read-back of the field value (verification). */
  value?: string | null
  error?: string
}

export interface RawKeyRequest {
  target?: AxTarget
  key: string
}

export interface AxBridgePort {
  /** Snapshot the focused window of the target (or frontmost app). */
  snapshotFocused(target?: AxTarget): Promise<RawAxSnapshot>
  act(req: RawActRequest): Promise<RawActResult>
  key(req: RawKeyRequest): Promise<{ success: boolean; error?: string }>
  preflight(): Promise<{ trusted: boolean }>
}

/** Thrown when the OS denies Accessibility access — surfaced as a clear,
 * actionable error rather than an opaque bridge failure or a crash. */
export class AxPermissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AxPermissionError'
  }
}

/** Heuristic: does a native bridge error indicate missing AX permission? */
export function isPermissionMessage(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes('accessibility permission') || m.includes('apidisabled') || m.includes('api disabled')
}
