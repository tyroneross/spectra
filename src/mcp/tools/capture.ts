// src/mcp/tools/capture.ts
import type { ToolContext } from '../context.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getStoragePath } from '../../core/storage.js'
import { screenshot } from '../../media/capture.js'

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

  const session = ctx.sessions.get(params.sessionId)
  const platform = session?.platform ?? 'web'

  if (params.type === 'screenshot') {
    const result = await screenshot(driver, platform)
    const filename = `capture-${Date.now()}.${result.format}`
    const dir = join(getStoragePath(), 'sessions', params.sessionId)
    await mkdir(dir, { recursive: true })
    const path = join(dir, filename)
    await writeFile(path, result.buffer)

    return { path, format: result.format }
  }

  if (params.type === 'start_recording' || params.type === 'stop_recording') {
    return { error: 'Video recording available in Phase 3a for web. Use sim: targets for simulator recording.' }
  }

  return { error: `Unknown capture type: ${params.type}` }
}
