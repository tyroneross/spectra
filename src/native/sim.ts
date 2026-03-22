// src/native/sim.ts
import type { Driver, DriverTarget, Snapshot, ActionType, ActResult, Element } from '../core/types.js'
import { NativeBridge, getSharedBridge } from './bridge.js'
import { readFile, unlink } from 'node:fs/promises'

interface SimDevice {
  udid: string
  name: string
  state: string
  runtime: string
}

export class SimDriver implements Driver {
  private bridge: NativeBridge
  private deviceId: string | null = null
  private platform: 'ios' | 'watchos' = 'ios'

  constructor(bridge?: NativeBridge) {
    this.bridge = bridge ?? getSharedBridge()
  }

  async connect(target: DriverTarget): Promise<void> {
    if (!target.deviceId) {
      throw new Error('SimDriver requires deviceId in target')
    }

    await this.bridge.start()

    // Look up the device
    const result = await this.bridge.send<{ devices: SimDevice[] }>('simDevices')
    const name = target.deviceId.toLowerCase()
    const booted = result.devices.filter(d => d.state === 'Booted')
    const device = booted.find(d => d.name.toLowerCase().includes(name))

    if (!device) {
      const available = booted.map(d => d.name).join(', ')
      throw new Error(
        `No booted simulator matching '${target.deviceId}'.`
        + (available ? ` Available: ${available}` : ' No simulators are booted.')
        + `\nRun: xcrun simctl boot "${target.deviceId}"`
      )
    }

    this.deviceId = device.udid
    this.platform = device.runtime.includes('watchOS') ? 'watchos' : 'ios'
  }

  async snapshot(): Promise<Snapshot> {
    // Simulators have limited AX access — return minimal snapshot
    // For iOS, we could walk the Simulator.app AX tree in the future
    return {
      platform: this.platform,
      elements: [],
      timestamp: Date.now(),
      metadata: {
        elementCount: 0,
        timedOut: false,
      },
    }
  }

  async act(elementId: string, action: ActionType, value?: string): Promise<ActResult> {
    // Coordinate-based tap only for simulators
    return {
      success: false,
      error: 'Simulator automation uses coordinate-based taps via spectra_capture. Element-based actions are limited.',
      snapshot: await this.snapshot(),
    }
  }

  async tap(x: number, y: number): Promise<{ success: boolean }> {
    if (!this.deviceId) {
      throw new Error('SimDriver not connected. Call connect() first.')
    }
    return this.bridge.send('simTap', { deviceId: this.deviceId, x, y })
  }

  async screenshot(): Promise<Buffer> {
    if (!this.deviceId) {
      throw new Error('SimDriver not connected. Call connect() first.')
    }
    const mask = this.platform === 'watchos' ? 'black' : undefined
    const params: Record<string, unknown> = { deviceId: this.deviceId }
    if (mask) params.mask = mask
    const result = await this.bridge.send<{ path: string }>('simScreenshot', params)
    const buf = await readFile(result.path)
    await unlink(result.path).catch(() => {})
    return buf
  }

  async close(): Promise<void> {
    this.deviceId = null
  }

  async disconnect(): Promise<void> {
    this.deviceId = null
    await this.bridge.close()
  }
}
