// src/mcp/tools/capture.ts
import type { ToolContext } from '../context.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { getStoragePath } from '../../core/storage.js'
import { screenshot } from '../../media/capture.js'
import { scoreElements, findRegions } from '../../intelligence/importance.js'
import { frame } from '../../intelligence/framing.js'
import { prepareForCapture, restoreAfterCapture } from '../../media/clean.js'
import { recordings } from '../../media/recordings.js'
import {
  getCapturePresetDefinition,
  resolveRecordingCaptureOptions,
  resolveScreenshotCaptureOptions,
} from '../../media/presets.js'
import type { VideoOptions } from '../../media/pipeline.js'
import type { Viewport } from '../../intelligence/types.js'
import type { CaptureMode, CapturePreset } from '../../core/types.js'

/**
 * Resolve the per-session storage directory. Prefers the SessionManager's
 * record (which honors a `repoPath` passed at connect time) so launchd-spawned
 * daemons write artifacts into the user's repo and not $HOME (C2.6). Falls
 * back to process-CWD-derived path for legacy contexts and narrow test mocks.
 */
function sessionStorageDir(ctx: ToolContext, sessionId: string): string {
  const sdir = (ctx.sessions as { sessionDir?: (id: string) => string }).sessionDir
  if (typeof sdir === 'function') {
    const dir = sdir.call(ctx.sessions, sessionId)
    if (dir) return dir
  }
  return join(getStoragePath(), 'sessions', sessionId)
}

export interface CaptureParams {
  sessionId: string
  type: 'screenshot' | 'start_recording' | 'stop_recording'
  preset?: CapturePreset
  // Intelligence options
  mode?: CaptureMode
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
  preset?: CapturePreset
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
  width?: number
  height?: number
  bitrate?: string
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

function buildMetadata(values: Record<string, unknown>): Record<string, unknown> | undefined {
  const metadata = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  )
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function hasVideoArtifact(ctx: ToolContext, sessionId: string, recordingId: string, artifactPath: string): boolean {
  const run = ctx.sessions.getRun(sessionId)
  return Boolean(run?.artifacts.some((artifact) => (
    artifact.type === 'video'
    && (
      artifact.path === artifactPath
      || artifact.metadata?.recordingId === recordingId
    )
  )))
}

export async function handleCapture(params: CaptureParams, ctx: ToolContext): Promise<CaptureResult> {
  const driver = ctx.drivers.get(params.sessionId)
  if (!driver) throw new Error(`Session ${params.sessionId} not found`)

  const session = ctx.sessions.get(params.sessionId)
  const platform = session?.platform ?? 'web'

  if (params.type === 'screenshot') {
    const screenshotOptions = resolveScreenshotCaptureOptions(params)
    const mode = screenshotOptions.mode
    const cleanRequested = screenshotOptions.clean
    const aspectRatio = screenshotOptions.aspectRatio
      ? parseAspectRatio(screenshotOptions.aspectRatio)
      : undefined

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
        const dir = sessionStorageDir(ctx, params.sessionId)
        await mkdir(dir, { recursive: true })
        const path = join(dir, filename)
        await writeFile(path, result.buffer)
        await ctx.sessions.addArtifact(params.sessionId, {
          type: 'screenshot',
          path: filename,
          format: result.format,
          label: 'Full screen',
          metadata: buildMetadata({
            mode,
            preset: screenshotOptions.preset,
            aspectRatio: screenshotOptions.aspectRatio,
            quality: screenshotOptions.quality,
            productionReady: screenshotOptions.productionReady,
          }),
        })
        return { path, format: result.format, cleanApplied, preset: screenshotOptions.preset }
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
      const dir = sessionStorageDir(ctx, params.sessionId)
      await mkdir(dir, { recursive: true })
      const path = join(dir, filename)
      await writeFile(path, frameResult.buffer)
      await ctx.sessions.addArtifact(params.sessionId, {
        type: 'screenshot',
        path: filename,
        format: 'png',
        label: frameResult.label,
        metadata: {
          crop: frameResult.crop,
          mode,
          preset: screenshotOptions.preset,
          aspectRatio: screenshotOptions.aspectRatio,
          quality: screenshotOptions.quality,
          productionReady: screenshotOptions.productionReady,
        },
      })

      return {
        path,
        format: 'png',
        crop: frameResult.crop,
        label: frameResult.label,
        cleanApplied,
        preset: screenshotOptions.preset,
      }
    } finally {
      if (cleanState) {
        await restoreAfterCapture(cleanState)
      }
    }
  }

  if (params.type === 'start_recording') {
    const outputDir = sessionStorageDir(ctx, params.sessionId)
    await mkdir(outputDir, { recursive: true })

    const videoOptions: Partial<VideoOptions> = resolveRecordingCaptureOptions(params)

    await ctx.sessions.setRecordingStatus(params.sessionId, {
      state: 'arming',
      preset: params.preset,
      source: platform === 'ios' || platform === 'watchos'
        ? 'xcrun simctl recordVideo'
        : 'ffmpeg avfoundation default input',
      sourceVerified: platform === 'ios' || platform === 'watchos',
    })

    try {
      const r = await recordings.start({
        sessionId: params.sessionId,
        platform,
        outputDir,
        options: videoOptions,
      })
      await ctx.sessions.setRecordingStatus(params.sessionId, {
        state: 'recording',
        recordingId: r.recordingId,
        preset: params.preset,
        startedAt: r.startedAt,
        fps: r.options.fps,
        codec: resolveCodecName(r.options),
        bitrate: r.options.bitrate,
      })
      return {
        recordingId: r.recordingId,
        preset: params.preset,
        startedAt: r.startedAt,
        fps: r.options.fps,
        codec: resolveCodecName(r.options),
        bitrate: r.options.bitrate,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await ctx.sessions.setRecordingStatus(params.sessionId, {
        state: 'failed',
        error: message,
      }).catch(() => {})
      return { error: message }
    }
  }

  if (params.type === 'stop_recording') {
    const outputDir = sessionStorageDir(ctx, params.sessionId)
    await mkdir(outputDir, { recursive: true })
    const recordingPreset = params.preset ?? ctx.sessions.getRun(params.sessionId)?.recording.preset
    const presetDefinition = getCapturePresetDefinition(recordingPreset)

    try {
      await ctx.sessions.setRecordingStatus(params.sessionId, {
        state: 'encoding',
        preset: recordingPreset,
      })
      const r = await recordings.stop({
        sessionId: params.sessionId,
        outputDir,
      })
      const artifactPath = relative(outputDir, r.path) || basename(r.path)
      await ctx.sessions.setRecordingStatus(params.sessionId, {
        state: 'saved',
        recordingId: r.recordingId,
        preset: recordingPreset,
        stoppedAt: Date.now(),
        path: artifactPath,
        durationMs: r.durationMs,
        sizeBytes: r.sizeBytes,
        codec: r.codec,
        fps: r.fps,
        width: r.width,
        height: r.height,
        droppedFrames: r.droppedFrames,
      })
      if (!hasVideoArtifact(ctx, params.sessionId, r.recordingId, artifactPath)) {
        await ctx.sessions.addArtifact(params.sessionId, {
          type: 'video',
          path: artifactPath,
          format: 'mp4',
          sizeBytes: r.sizeBytes,
          metadata: {
            recordingId: r.recordingId,
            preset: recordingPreset,
            productionReady: presetDefinition?.productionReady,
            durationMs: r.durationMs,
            codec: r.codec,
            fps: r.fps,
            width: r.width,
            height: r.height,
            droppedFrames: r.droppedFrames,
            alreadyStopped: r.alreadyStopped,
          },
        })
      }
      return {
        recordingId: r.recordingId,
        preset: recordingPreset,
        path: r.path,
        format: 'mp4',
        durationMs: r.durationMs,
        sizeBytes: r.sizeBytes,
        codec: r.codec,
        fps: r.fps,
        width: r.width,
        height: r.height,
        droppedFrames: r.droppedFrames,
        alreadyStopped: r.alreadyStopped,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await ctx.sessions.setRecordingStatus(params.sessionId, {
        state: 'failed',
        error: message,
      }).catch(() => {})
      return { error: message }
    }
  }

  return { error: `Unknown capture type: ${params.type}` }
}

function resolveCodecName(options: VideoOptions): string {
  if (options.hardware && options.quality !== 'lossless') {
    return options.codec === 'hevc' ? 'hevc_videotoolbox' : 'h264_videotoolbox'
  }
  return options.codec === 'hevc' ? 'libx265' : 'libx264'
}
