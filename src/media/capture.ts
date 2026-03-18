// src/media/capture.ts
import type { Driver, Platform } from '../core/types.js'
import { NativeBridge, getSharedBridge } from '../native/bridge.js'
import { readFile } from 'node:fs/promises'
import type { RecordHandle } from './recorder.js'
import { SimRecordHandle } from './recorder.js'

export interface ScreenshotOptions {
  format?: 'png' | 'jpeg'
}

export interface ScreenshotResult {
  buffer: Buffer
  path?: string
  format: string
}

export async function screenshot(
  driver: Driver,
  platform: Platform,
  options?: ScreenshotOptions,
): Promise<ScreenshotResult> {
  const buf = await driver.screenshot()
  return {
    buffer: buf,
    format: options?.format ?? 'png',
  }
}

export async function startRecording(
  platform: Platform,
  deviceId?: string,
): Promise<RecordHandle> {
  if (platform === 'ios' || platform === 'watchos') {
    if (!deviceId) throw new Error('deviceId required for simulator recording')
    const bridge = getSharedBridge()
    const result = await bridge.send<{ recordingId: string }>('simRecord', {
      deviceId,
      action: 'start',
    })
    return new SimRecordHandle(bridge, result.recordingId, deviceId)
  }

  throw new Error(`Video recording not yet supported for platform: ${platform}`)
}
