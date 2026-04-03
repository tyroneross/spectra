// src/native/driver.ts
import type { Driver, DriverTarget, Snapshot, ActionType, ActResult, Element } from '../core/types.js'
import { normalizeRole } from '../core/normalize.js'
import { NativeBridge, getSharedBridge } from './bridge.js'
import { readFile, unlink } from 'node:fs/promises'

interface NativeElement {
  role: string
  label: string
  value: string | null
  enabled: boolean
  focused: boolean
  actions: string[]
  bounds: [number, number, number, number]
  path: number[]
}

interface WindowInfo {
  id: number
  title: string
  bounds: [number, number, number, number]
}

interface SnapshotResponse {
  elements: NativeElement[]
  window: WindowInfo
}

export class NativeDriver implements Driver {
  private bridge: NativeBridge
  private appName: string | null = null
  private appPid: number | null = null
  private windowId: number | null = null
  private idToPath = new Map<string, number[]>()

  constructor(bridge?: NativeBridge) {
    this.bridge = bridge ?? getSharedBridge()
  }

  async connect(target: DriverTarget): Promise<void> {
    if (!target.appName) {
      throw new Error('NativeDriver requires appName in target')
    }
    this.appName = target.appName

    // Verify the app is accessible by taking a snapshot
    await this.bridge.start()
    const result = await this.bridge.send<SnapshotResponse>('snapshot', { app: this.appName })
    this.windowId = result.window.id
  }

  async snapshot(): Promise<Snapshot> {
    const params: Record<string, unknown> = {}
    if (this.appPid) params.pid = this.appPid
    else if (this.appName) params.app = this.appName

    const result = await this.bridge.send<SnapshotResponse>('snapshot', params)

    // Map NativeElement[] to Element[] with sequential IDs
    this.idToPath.clear()
    const elements: Element[] = result.elements.map((nel, i) => {
      const id = `e${i + 1}`
      this.idToPath.set(id, nel.path)
      return {
        id,
        role: normalizeRole(nel.role, 'macos'),
        label: nel.label,
        value: nel.value,
        enabled: nel.enabled,
        focused: nel.focused,
        actions: nel.actions,
        bounds: nel.bounds as [number, number, number, number],
        parent: null,
      }
    })

    return {
      appName: this.appName ?? undefined,
      platform: 'macos',
      elements,
      timestamp: Date.now(),
      metadata: {
        elementCount: elements.length,
      },
    }
  }

  async act(elementId: string, action: ActionType, value?: string): Promise<ActResult> {
    const path = this.idToPath.get(elementId)
    if (!path) {
      return {
        success: false,
        error: `Element '${elementId}' not found. Take a new snapshot — the UI may have changed.`,
        snapshot: await this.snapshot(),
      }
    }

    // Map ActionType to native action names
    const nativeAction = action === 'click' ? 'press'
      : action === 'type' ? 'setValue'
      : action === 'clear' ? 'setValue'
      : action

    const params: Record<string, unknown> = {
      app: this.appName,
      elementPath: path,
      action: nativeAction,
    }
    if (action === 'type' && value) params.value = value
    if (action === 'clear') params.value = ''

    try {
      const result = await this.bridge.send<{ success: boolean; error?: string }>('act', params)
      // Brief delay for native UI to update after action (SwiftUI view refresh)
      await new Promise(r => setTimeout(r, 200))
      const snapshot = await this.snapshot()

      if (!result.success) {
        return { success: false, error: result.error, snapshot }
      }
      return { success: true, snapshot }
    } catch (err) {
      const snapshot = await this.snapshot()
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        snapshot,
      }
    }
  }

  async screenshot(): Promise<Buffer> {
    const result = await this.bridge.send<{ path: string }>('screenshot', { app: this.appName })
    const buf = await readFile(result.path)
    await unlink(result.path).catch(() => {})
    return buf
  }

  async close(): Promise<void> {
    this.appName = null
    this.appPid = null
    this.windowId = null
    this.idToPath.clear()
    // Don't close bridge — shared across sessions
  }

  async disconnect(): Promise<void> {
    this.appName = null
    this.appPid = null
    this.windowId = null
    this.idToPath.clear()
    await this.bridge.close()
  }
}
