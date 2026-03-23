// src/media/pipeline.ts
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Platform } from '../core/types.js'

export interface VideoOptions {
  fps: 30 | 60
  quality: 'lossless' | 'high' | 'medium'
  hardware: boolean       // use VideoToolbox on macOS
  maxDuration?: number    // seconds, safety limit (default: 300)
}

export interface VideoResult {
  path: string
  duration: number
  size: number
  codec: string
  fps: number
}

export interface RecordingHandle {
  stop(): Promise<string>   // returns path to raw recording
  platform: Platform
}

// ─── Process Runner ──────────────────────────────────────────

export type ProcessRunner = (cmd: string, args: string[]) => {
  kill: () => void
  waitForExit: () => Promise<number>
}

function defaultRunner(cmd: string, args: string[]): ReturnType<ProcessRunner> {
  const proc = spawn(cmd, args, { stdio: 'pipe' })

  return {
    kill: () => proc.kill(),
    waitForExit: () =>
      new Promise((resolve, reject) => {
        proc.on('close', (code) => resolve(code ?? 0))
        proc.on('error', reject)
      }),
  }
}

let runner: ProcessRunner = defaultRunner

export function setProcessRunner(r: ProcessRunner): void {
  runner = r
}

export function resetProcessRunner(): void {
  runner = defaultRunner
}

// ─── Argument Builders ───────────────────────────────────────

const DEFAULT_OPTIONS: VideoOptions = {
  fps: 30,
  quality: 'high',
  hardware: true,
  maxDuration: 300,
}

/**
 * Build FFmpeg (or xcrun simctl) arguments for the capture phase.
 * Returns args without the leading command name.
 */
export function buildCaptureArgs(
  platform: Platform,
  outputPath: string,
  options: VideoOptions,
): string[] {
  if (platform === 'ios' || platform === 'watchos') {
    // simctl path — not ffmpeg
    return [
      'simctl', 'io', 'booted', 'recordVideo',
      '--codec', 'h264',
      '--force',
      outputPath,
    ]
  }

  // web / macos → avfoundation screen capture
  return [
    '-f', 'avfoundation',
    '-framerate', String(options.fps),
    '-i', '1:none',
    '-c:v', 'libx264rgb',
    '-crf', '0',
    '-preset', 'ultrafast',
    outputPath,
  ]
}

/**
 * Build FFmpeg arguments for the encode/distribution phase.
 * Returns args without the leading 'ffmpeg'.
 */
export function buildEncodeArgs(
  inputPath: string,
  outputPath: string,
  options: VideoOptions,
): string[] {
  const useHardware = options.hardware && options.quality !== 'lossless'

  if (useHardware) {
    const bitrate = options.quality === 'high' ? '5M' : '2M'
    return [
      '-i', inputPath,
      '-c:v', 'h264_videotoolbox',
      '-b:v', bitrate,
      '-pix_fmt', 'yuv420p',
      outputPath,
    ]
  }

  // Software encoding with libx264
  const crfMap: Record<VideoOptions['quality'], number> = {
    lossless: 0,
    high: 20,
    medium: 28,
  }
  const crf = crfMap[options.quality]

  return [
    '-i', inputPath,
    '-c:v', 'libx264',
    '-crf', String(crf),
    '-preset', 'slow',
    '-pix_fmt', 'yuv420p',
    outputPath,
  ]
}

// ─── Recording ───────────────────────────────────────────────

/**
 * Start a recording session. Returns a RecordingHandle with stop().
 */
export async function startRecording(
  platform: Platform,
  outputDir: string,
  options?: Partial<VideoOptions>,
): Promise<RecordingHandle> {
  const opts: VideoOptions = { ...DEFAULT_OPTIONS, ...options } as VideoOptions

  const timestamp = Date.now()
  const isSimctl = platform === 'ios' || platform === 'watchos'
  const ext = isSimctl ? 'mp4' : 'mkv'
  const outputPath = join(outputDir, `raw-${timestamp}.${ext}`)

  const captureArgs = buildCaptureArgs(platform, outputPath, opts)
  const cmd = isSimctl ? 'xcrun' : 'ffmpeg'

  const proc = runner(cmd, captureArgs)

  const maxDuration = opts.maxDuration ?? DEFAULT_OPTIONS.maxDuration!
  const timeoutId = setTimeout(() => {
    proc.kill()
  }, maxDuration * 1000)

  const handle: RecordingHandle = {
    platform,
    stop: async () => {
      clearTimeout(timeoutId)
      proc.kill()
      await proc.waitForExit().catch(() => {})
      return outputPath
    },
  }

  return handle
}

// ─── Encoding ────────────────────────────────────────────────

/**
 * Encode a raw recording for distribution. Returns VideoResult.
 */
export async function encodeRecording(
  rawPath: string,
  outputDir: string,
  options?: Partial<VideoOptions>,
): Promise<VideoResult> {
  const opts: VideoOptions = { ...DEFAULT_OPTIONS, ...options } as VideoOptions

  const timestamp = Date.now()
  const outputPath = join(outputDir, `video-${timestamp}.mp4`)

  const encodeArgs = buildEncodeArgs(rawPath, outputPath, opts)
  const proc = runner('ffmpeg', encodeArgs)

  const exitCode = await proc.waitForExit()
  if (exitCode !== 0) {
    throw new Error(`ffmpeg encode failed with exit code ${exitCode}`)
  }

  const fileStat = await stat(outputPath)

  const useHardware = opts.hardware && opts.quality !== 'lossless'
  const codec = useHardware ? 'h264_videotoolbox' : 'libx264'

  return {
    path: outputPath,
    duration: 0,   // duration requires ffprobe — set to 0 as placeholder
    size: fileStat.size,
    codec,
    fps: opts.fps,
  }
}
