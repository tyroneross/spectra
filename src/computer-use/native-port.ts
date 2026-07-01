// src/computer-use/native-port.ts
//
// The real AxBridgePort: forwards to the spectra-native Swift helper over the
// existing JSON-RPC NativeBridge (cuSnapshot / cuAct / cuKey / cuPreflight —
// see native/swift/AXComputerUse.swift). Kept separate from ./computer-use.ts
// so the orchestrator stays free of child-process concerns and unit tests never
// spawn a binary. This is the daemon's injection point (src/daemon/core-impl.ts).
//
// SPDX-License-Identifier: Apache-2.0

import { NativeBridge, getSharedBridge } from '../native/bridge.js'
import { AxPermissionError, isPermissionMessage, type AxBridgePort, type RawAxSnapshot, type RawActRequest, type RawActResult, type RawKeyRequest } from './port.js'
import type { AxNode, AxStatus, AxTarget } from './types.js'

interface NativeFocusedSnapshot {
  window: { id: number; title: string; bounds: [number, number, number, number] } | null
  elements: AxNode[]
  nodeCount: number
  axStatus: AxStatus
  focusedWindowTitle: string
}

interface NativeActResult {
  success: boolean
  value?: string | null
  error?: string
}

function targetParams(target?: AxTarget): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  if (target?.pid !== undefined) params.pid = target.pid
  else if (target?.app !== undefined) params.app = target.app
  return params
}

export class NativeAxBridgePort implements AxBridgePort {
  private readonly bridge: NativeBridge

  constructor(bridge: NativeBridge = getSharedBridge()) {
    this.bridge = bridge
  }

  async snapshotFocused(target?: AxTarget): Promise<RawAxSnapshot> {
    let res: NativeFocusedSnapshot
    try {
      res = await this.bridge.send<NativeFocusedSnapshot>('cuSnapshot', targetParams(target))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isPermissionMessage(message)) throw new AxPermissionError(message)
      throw err
    }
    return {
      window: res.window ? { title: res.window.title, bounds: res.window.bounds } : null,
      elements: Array.isArray(res.elements) ? res.elements : [],
      nodeCount: res.nodeCount ?? 0,
      axStatus: res.axStatus ?? 'empty',
      focusedWindowTitle: res.focusedWindowTitle ?? '',
    }
  }

  async act(req: RawActRequest): Promise<RawActResult> {
    const res = await this.bridge.send<NativeActResult>('cuAct', {
      ...targetParams(req.target),
      elementPath: req.elementPath,
      action: req.action,
      value: req.value,
    })
    return { success: res.success, value: res.value ?? null, error: res.error }
  }

  async key(req: RawKeyRequest): Promise<{ success: boolean; error?: string }> {
    return this.bridge.send<{ success: boolean; error?: string }>('cuKey', {
      ...targetParams(req.target),
      key: req.key,
    })
  }

  async preflight(): Promise<{ trusted: boolean }> {
    return this.bridge.send<{ trusted: boolean }>('cuPreflight')
  }
}
