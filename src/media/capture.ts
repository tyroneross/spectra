// src/media/capture.ts
import type { Driver, Platform, Element } from '../core/types.js'
import { NativeBridge, getSharedBridge } from '../native/bridge.js'
import { readFile } from 'node:fs/promises'
import type { RecordHandle } from './recorder.js'
import { SimRecordHandle } from './recorder.js'
import { decodePng, encodePng, cropImage } from './png.js'

export interface ScreenshotOptions {
  format?: 'png' | 'jpeg'
  quality?: number
  // Element-level capture — crops to the element's bounds
  element?: Element
  // Region capture — [x, y, width, height]
  region?: [number, number, number, number]
  devicePixelRatio?: number  // default: 1
}

export interface ScreenshotResult {
  buffer: Buffer
  path?: string
  format: string
  bounds?: [number, number, number, number]  // the actual capture bounds
}

export async function screenshot(
  driver: Driver,
  platform: Platform,
  options?: ScreenshotOptions,
): Promise<ScreenshotResult> {
  // If element or region specified, crop from a full screenshot
  if (options?.element || options?.region) {
    const bounds: [number, number, number, number] =
      options.element?.bounds ?? options.region!

    const fullBuf = await driver.screenshot()
    const raw = decodePng(fullBuf)
    const cropped = cropImage(raw, bounds[0], bounds[1], bounds[2], bounds[3])
    const buf = encodePng(cropped)

    return {
      buffer: buf,
      format: options?.format ?? 'png',
      bounds,
    }
  }

  // Default: full screenshot
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
