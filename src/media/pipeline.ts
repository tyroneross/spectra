// src/media/pipeline.ts
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Platform } from '../core/types.js'

export interface VideoOptions {
  fps: 30 | 60
  quality: 'lossless' | 'high' | 'medium'
  hardware: boolean       // use VideoToolbox on macOS
  codec: 'h264' | 'hevc'
  bitrate: '4M' | '8M'
  maxDuration?: number    // seconds, safety limit (default: 300)
  captureInput?: string   // avfoundation video input, e.g. "4:none"
}

export interface VideoResult {
  path: string
  duration: number
  size: number
  codec: string
  fps: number
  width?: number
  height?: number
}

export interface RecordingHandle {
  stop(): Promise<string>   // returns path to raw recording
  platform: Platform
  captureInput?: string
}

export interface VideoProbeResult {
  durationMs?: number
  width?: number
  height?: number
  fps?: number
  codec?: string
}

export interface PosterFrameOptions {
  atSeconds?: number
  maxWidth?: number
}

export interface CompositePane {
  x: number
  y: number
  width: number
  height: number
}

export interface CompositeLayout {
  left: CompositePane
  right: CompositePane
}

// ─── Process Runner ──────────────────────────────────────────

export type ProcessRunner = (cmd: string, args: string[]) => {
  kill: () => void
  waitForExit: () => Promise<number>
  stdout?: () => Promise<string>
  stderr?: () => Promise<string>
}

function defaultRunner(cmd: string, args: string[]): ReturnType<ProcessRunner> {
  const proc = spawn(cmd, args, { stdio: 'pipe' })
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(Buffer.from(chunk)))
  proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)))

  return {
    kill: () => proc.kill(),
    waitForExit: () =>
      new Promise((resolve, reject) => {
        proc.on('close', (code) => resolve(code ?? 0))
        proc.on('error', reject)
      }),
    stdout: async () => Buffer.concat(stdoutChunks).toString('utf-8'),
    stderr: async () => Buffer.concat(stderrChunks).toString('utf-8'),
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
  codec: 'h264',
  bitrate: '8M',
  maxDuration: 300,
}

const DEFAULT_AVFOUNDATION_INPUT = '1:none'

export function resolveVideoOptions(options?: Partial<VideoOptions>): VideoOptions {
  const quality = options?.quality ?? DEFAULT_OPTIONS.quality
  const bitrate = options?.bitrate ?? (quality === 'medium' ? '4M' : '8M')
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    quality,
    bitrate,
  } as VideoOptions
}

export function buildAvfoundationDeviceListArgs(): string[] {
  return ['-f', 'avfoundation', '-list_devices', 'true', '-i', '']
}

export function parseAvfoundationScreenInput(
  stderr: string,
  preferredName = 'Capture screen 0',
): string | undefined {
  let inVideoDevices = false
  const screenDevices: string[] = []

  for (const line of stderr.split(/\r?\n/)) {
    if (line.includes('AVFoundation video devices:')) {
      inVideoDevices = true
      continue
    }
    if (line.includes('AVFoundation audio devices:')) {
      inVideoDevices = false
      continue
    }
    if (!inVideoDevices) continue

    const match = line.match(/\]\s+\[(\d+)\]\s+(.+)$/)
    if (!match) continue

    const [, index, name] = match
    if (name === preferredName) return `${index}:none`
    if (/^Capture screen\b/.test(name)) screenDevices.push(`${index}:none`)
  }

  return screenDevices[0]
}

export async function discoverAvfoundationScreenInput(): Promise<string | undefined> {
  const proc = runner('ffmpeg', buildAvfoundationDeviceListArgs())
  await proc.waitForExit().catch(() => undefined)
  const stderr = proc.stderr ? await proc.stderr().catch(() => '') : ''
  return parseAvfoundationScreenInput(stderr)
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
      '--codec', options.codec,
      '--force',
      outputPath,
    ]
  }

  // web / macos → avfoundation screen capture
  const captureInput = options.captureInput ?? DEFAULT_AVFOUNDATION_INPUT
  return [
    '-f', 'avfoundation',
    '-framerate', String(options.fps),
    '-i', captureInput,
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
  return [
    '-i', inputPath,
    ...buildDistributionVideoArgs(options),
    outputPath,
  ]
}

export function buildCompositeEncodeArgs(
  inputPath: string,
  outputPath: string,
  layout: CompositeLayout,
  options: VideoOptions,
): string[] {
  const left = normalizeCompositePane(layout.left, 'left')
  const right = normalizeCompositePane(layout.right, 'right')
  const height = Math.min(left.height, right.height)
  const filter = [
    `[0:v]crop=${left.width}:${height}:${left.x}:${left.y}[l]`,
    `[0:v]crop=${right.width}:${height}:${right.x}:${right.y}[r]`,
    '[l][r]hstack=inputs=2:shortest=1[v]',
  ].join(';')

  return [
    '-i', inputPath,
    '-filter_complex', filter,
    '-map', '[v]',
    ...buildDistributionVideoArgs(options),
    outputPath,
  ]
}

function buildDistributionVideoArgs(options: VideoOptions): string[] {
  const useHardware = options.hardware && options.quality !== 'lossless'

  if (useHardware) {
    const encoder = options.codec === 'hevc' ? 'hevc_videotoolbox' : 'h264_videotoolbox'
    const args = [
      '-c:v', encoder,
      '-b:v', options.bitrate,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
    ]
    if (options.codec === 'hevc') {
      args.push('-tag:v', 'hvc1')
    }
    return args
  }

  // Software encoding with libx264/libx265
  const crfMap: Record<VideoOptions['quality'], number> = {
    lossless: 0,
    high: options.codec === 'hevc' ? 22 : 18,
    medium: options.codec === 'hevc' ? 28 : 24,
  }
  const crf = crfMap[options.quality]
  const encoder = options.codec === 'hevc' ? 'libx265' : 'libx264'

  const args = [
    '-c:v', encoder,
    '-crf', String(crf),
    '-preset', 'slow',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
  ]
  if (options.codec === 'hevc') {
    args.push('-tag:v', 'hvc1')
  }
  return args
}

function normalizeCompositePane(pane: CompositePane, label: string): CompositePane {
  return {
    x: normalizeInteger(pane.x, `${label}.x`, 0),
    y: normalizeInteger(pane.y, `${label}.y`, 0),
    width: normalizeInteger(pane.width, `${label}.width`, 1),
    height: normalizeInteger(pane.height, `${label}.height`, 1),
  }
}

function normalizeInteger(value: number, label: string, min: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid composite pane ${label}: expected a finite number`)
  }
  const rounded = Math.round(value)
  if (rounded < min) {
    throw new Error(`Invalid composite pane ${label}: expected ${min === 0 ? 'a non-negative' : 'a positive'} number`)
  }
  return rounded
}

export function buildProbeArgs(inputPath: string): string[] {
  return [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,duration:format=duration',
    '-of', 'json',
    inputPath,
  ]
}

export function buildPosterFrameArgs(
  inputPath: string,
  outputPath: string,
  options: PosterFrameOptions = {},
): string[] {
  const atSeconds = options.atSeconds ?? 1
  const maxWidth = options.maxWidth ?? 1280
  return [
    '-y',
    '-ss', String(atSeconds),
    '-i', inputPath,
    '-frames:v', '1',
    '-vf', `scale=min(${maxWidth}\\,iw):-2`,
    '-q:v', '2',
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
  const opts = resolveVideoOptions(options)

  const timestamp = Date.now()
  const isSimctl = platform === 'ios' || platform === 'watchos'
  const ext = isSimctl ? 'mp4' : 'mkv'
  const outputPath = join(outputDir, `raw-${timestamp}.${ext}`)

  const captureInput = isSimctl
    ? undefined
    : opts.captureInput ?? await discoverAvfoundationScreenInput() ?? DEFAULT_AVFOUNDATION_INPUT
  const captureArgs = buildCaptureArgs(platform, outputPath, { ...opts, captureInput })
  const cmd = isSimctl ? 'xcrun' : 'ffmpeg'

  const proc = runner(cmd, captureArgs)

  const maxDuration = opts.maxDuration ?? DEFAULT_OPTIONS.maxDuration!
  const timeoutId = setTimeout(() => {
    proc.kill()
  }, maxDuration * 1000)

  const handle: RecordingHandle = {
    platform,
    captureInput,
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
  compositeLayout?: CompositeLayout,
): Promise<VideoResult> {
  const opts = resolveVideoOptions(options)

  const timestamp = Date.now()
  const outputPath = join(outputDir, `video-${timestamp}.mp4`)

  const encodeArgs = compositeLayout
    ? buildCompositeEncodeArgs(rawPath, outputPath, compositeLayout, opts)
    : buildEncodeArgs(rawPath, outputPath, opts)
  const proc = runner('ffmpeg', encodeArgs)

  const exitCode = await proc.waitForExit()
  if (exitCode !== 0) {
    throw new Error(`ffmpeg encode failed with exit code ${exitCode}`)
  }

  const fileStat = await stat(outputPath)

  const probe = await probeVideo(outputPath).catch(() => undefined)
  const codec = probe?.codec ?? resolveCodecName(opts)

  return {
    path: outputPath,
    duration: probe?.durationMs ? probe.durationMs / 1000 : 0,
    size: fileStat.size,
    codec,
    fps: probe?.fps ?? opts.fps,
    width: probe?.width,
    height: probe?.height,
  }
}

export async function probeVideo(inputPath: string): Promise<VideoProbeResult | undefined> {
  const proc = runner('ffprobe', buildProbeArgs(inputPath))
  const exitCode = await proc.waitForExit()
  if (exitCode !== 0 || !proc.stdout) return undefined

  const raw = await proc.stdout()
  if (!raw.trim()) return undefined

  const data = JSON.parse(raw) as {
    streams?: Array<{
      codec_name?: string
      width?: number
      height?: number
      avg_frame_rate?: string
      r_frame_rate?: string
      duration?: string
    }>
    format?: {
      duration?: string
    }
  }
  const stream = data.streams?.[0]
  const durationSeconds = numberFromString(stream?.duration) ?? numberFromString(data.format?.duration)
  const fps = parseFps(stream?.avg_frame_rate) ?? parseFps(stream?.r_frame_rate)

  return {
    durationMs: durationSeconds !== undefined ? Math.round(durationSeconds * 1000) : undefined,
    width: typeof stream?.width === 'number' ? stream.width : undefined,
    height: typeof stream?.height === 'number' ? stream.height : undefined,
    fps,
    codec: stream?.codec_name,
  }
}

export async function extractPosterFrame(
  inputPath: string,
  outputPath: string,
  options?: PosterFrameOptions,
): Promise<void> {
  const proc = runner('ffmpeg', buildPosterFrameArgs(inputPath, outputPath, options))
  const exitCode = await proc.waitForExit()
  if (exitCode !== 0) {
    const detail = proc.stderr ? await proc.stderr().catch(() => '') : ''
    throw new Error(`ffmpeg poster extraction failed with exit code ${exitCode}${detail ? `: ${detail}` : ''}`)
  }
}

function resolveCodecName(options: VideoOptions): string {
  if (options.hardware && options.quality !== 'lossless') {
    return options.codec === 'hevc' ? 'hevc_videotoolbox' : 'h264_videotoolbox'
  }
  return options.codec === 'hevc' ? 'libx265' : 'libx264'
}

function numberFromString(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseFps(value: string | undefined): number | undefined {
  if (!value || value === '0/0') return undefined
  const [rawNumerator, rawDenominator] = value.split('/')
  const numerator = Number(rawNumerator)
  const denominator = rawDenominator === undefined ? 1 : Number(rawDenominator)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined
  const fps = numerator / denominator
  return Number.isFinite(fps) ? Math.round(fps * 100) / 100 : undefined
}
