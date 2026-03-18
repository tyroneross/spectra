import type { ToolContext } from '../context.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getStoragePath } from '../../core/storage.js'

export interface CaptureParams {
  sessionId: string
  type: 'screenshot' | 'start_recording' | 'stop_recording'
}

export interface CaptureResult {
  path?: string
  format?: string
  error?: string
}

export async function handleCapture(params: CaptureParams, ctx: ToolContext): Promise<CaptureResult> {
  const driver = ctx.drivers.get(params.sessionId)
  if (!driver) throw new Error(`Session ${params.sessionId} not found`)

  if (params.type === 'screenshot') {
    const buf = await driver.screenshot()
    const filename = `capture-${Date.now()}.png`
    const dir = join(getStoragePath(), 'sessions', params.sessionId)
    await mkdir(dir, { recursive: true })
    const path = join(dir, filename)
    await writeFile(path, buf)

    return { path, format: 'png' }
  }

  if (params.type === 'start_recording' || params.type === 'stop_recording') {
    return { error: 'Video recording available in Phase 3a' }
  }

  return { error: `Unknown capture type: ${params.type}` }
}
