// src/mcp/tools/capture.ts
import type { ToolContext } from '../context.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getStoragePath } from '../../core/storage.js'
import { screenshot } from '../../media/capture.js'
import { scoreElements, findRegions } from '../../intelligence/importance.js'
import { frame } from '../../intelligence/framing.js'
import { prepareForCapture, restoreAfterCapture } from '../../media/clean.js'
import { recordings } from '../../media/recordings.js'
import type { VideoOptions } from '../../media/pipeline.js'
import type { Viewport } from '../../intelligence/types.js'

export interface CaptureParams {
  sessionId: string
  type: 'screenshot' | 'start_recording' | 'stop_recording'
  // Intelligence options
  mode?: 'full' | 'element' | 'region' | 'auto'
  elementId?: string       // for mode='element'
  region?: string          // region label for mode='region'
  aspectRatio?: string     // "16:9", "4:3", "1:1"
  clean?: boolean          // apply cleanup before capture (default: true)
  quality?: 'lossless' | 'high' | 'medium'
  // Recording options (DOE control point — wired in C7)
  fps?: 30 | 60
  codec?: 'h264' | 'hevc'
  bitrate?: '4M' | '8M'
  hardware?: boolean       // VideoToolbox if true, libx264/libx265 if false
}

export interface CaptureResult {
  path?: string
  format?: string
  crop?: [number, number, number, number]
  label?: string
  cleanApplied?: boolean
  error?: string
  // Recording result fields
  recordingId?: string
  durationMs?: number
  sizeBytes?: number
  codec?: string
  fps?: number
  droppedFrames?: number
  startedAt?: number
  alreadyStopped?: boolean
}

/** Parse an aspect ratio string like "16:9" or "4:3" into a numeric ratio (w/h). */
function parseAspectRatio(value: string): number | undefined {
  const parts = value.split(':')
  if (parts.length !== 2) return undefined
  const w = parseFloat(parts[0])
  const h = parseFloat(parts[1])
  if (!isFinite(w) || !isFinite(h) || h === 0) return undefined
  return w / h
}

const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 800, devicePixelRatio: 1 }

export async function handleCapture(params: CaptureParams, ctx: ToolContext): Promise<CaptureResult> {
  const driver = ctx.drivers.get(params.sessionId)
  if (!driver) throw new Error(`Session ${params.sessionId} not found`)

  const session = ctx.sessions.get(params.sessionId)
  const platform = session?.platform ?? 'web'

  if (params.type === 'screenshot') {
    const mode = params.mode ?? 'full'
    const cleanRequested = params.clean !== false   // default: true
    const aspectRatio = params.aspectRatio ? parseAspectRatio(params.aspectRatio) : undefined

    // Extract CDP connection if the driver exposes one
    const connection = driver.getConnection?.()
    const conn = (connection?.conn ?? null) as import('../../cdp/connection.js').CdpConnection | null
    const driverSessionId = connection?.sessionId ?? null

    // Apply cleanup before capture
    let cleanState = null
    if (cleanRequested) {
      cleanState = await prepareForCapture(conn, driverSessionId, platform)
    }
    const cleanApplied = cleanRequested && (cleanState?.applied.length ?? 0) > 0

    try {
      // Full screenshot (no intelligence)
      if (mode === 'full' || (!params.elementId && !params.region && mode !== 'auto')) {
        const result = await screenshot(driver, platform)
        const filename = `capture-${Date.now()}.${result.format}`
        const dir = join(getStoragePath(), 'sessions', params.sessionId)
        await mkdir(dir, { recursive: true })
        const path = join(dir, filename)
        await writeFile(path, result.buffer)
        return { path, format: result.format, cleanApplied }
      }

      // All intelligence modes need a snapshot + screenshot
      const snapshot = await driver.snapshot()
      const rawBuf = await driver.screenshot()
      const scores = scoreElements(snapshot.elements, DEFAULT_VIEWPORT)

      let frameResult: { buffer: Buffer; crop: [number, number, number, number]; label: string }

      if (mode === 'element' && params.elementId) {
        // Find the element and crop to its bounds
        const el = snapshot.elements.find(e => e.id === params.elementId)
        if (!el) {
          return { error: `Element ${params.elementId} not found in snapshot` }
        }
        frameResult = frame(rawBuf, scores, snapshot.elements, {
          target: 'element',
          elementId: params.elementId,
          aspectRatio,
        })

      } else if (mode === 'region' && params.region) {
        // Find regions, match by label
        const regions = findRegions(scores, snapshot.elements)
        const label = params.region.toLowerCase()
        const regionIndex = regions.findIndex(r => r.label.toLowerCase() === label)
        frameResult = frame(rawBuf, scores, snapshot.elements, {
          target: 'region',
          regionIndex: regionIndex >= 0 ? regionIndex : 0,
          aspectRatio,
        })

      } else {
        // Auto: score elements and auto-frame to the best region
        frameResult = frame(rawBuf, scores, snapshot.elements, {
          target: undefined,  // triggers auto path in frame()
          aspectRatio,
        })
      }

      const filename = `capture-${Date.now()}.png`
      const dir = join(getStoragePath(), 'sessions', params.sessionId)
      await mkdir(dir, { recursive: true })
      const path = join(dir, filename)
      await writeFile(path, frameResult.buffer)

      return {
        path,
        format: 'png',
        crop: frameResult.crop,
        label: frameResult.label,
        cleanApplied,
      }
    } finally {
      if (cleanState) {
        await restoreAfterCapture(cleanState)
      }
    }
  }

  if (params.type === 'start_recording') {
    const outputDir = join(getStoragePath(), 'sessions', params.sessionId)
    await mkdir(outputDir, { recursive: true })

    const videoOptions: Partial<VideoOptions> = {}
    if (params.fps) videoOptions.fps = params.fps
    if (params.quality) videoOptions.quality = params.quality
    if (params.hardware !== undefined) videoOptions.hardware = params.hardware

    try {
      const r = await recordings.start({
        sessionId: params.sessionId,
        platform,
        outputDir,
        options: videoOptions,
      })
      return {
        recordingId: r.recordingId,
        startedAt: r.startedAt,
        fps: r.options.fps,
        codec: r.options.hardware ? 'h264_videotoolbox' : 'libx264',
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }

  if (params.type === 'stop_recording') {
    const outputDir = join(getStoragePath(), 'sessions', params.sessionId)
    await mkdir(outputDir, { recursive: true })

    try {
      const r = await recordings.stop({
        sessionId: params.sessionId,
        outputDir,
      })
      return {
        recordingId: r.recordingId,
        path: r.path,
        format: 'mp4',
        durationMs: r.durationMs,
        sizeBytes: r.sizeBytes,
        codec: r.codec,
        fps: r.fps,
        droppedFrames: r.droppedFrames,
        alreadyStopped: r.alreadyStopped,
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }

  return { error: `Unknown capture type: ${params.type}` }
}
