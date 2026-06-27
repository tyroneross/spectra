// src/media/pipeline.ts
//
// ffmpeg/ffprobe helpers for the LIVE media surface: video probing and poster-
// frame extraction (consumed by media/production.ts → createProductionBundle).
//
// The full-display AVFoundation recording path — startRecording /
// encodeRecording / buildCaptureArgs / avfoundation device discovery / the
// composite encode filtergraph — was removed in the daemon-consolidation
// cutover (P3). Window-isolated ScreenCaptureKit via the daemon composite
// worker (src/daemon/composite-worker.ts) is now the only recording path; the
// daemon 501s the legacy full-display start/stopRecording operations.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { spawn } from 'node:child_process'

/**
 * Recording option shape. Retained as the typed vocabulary for the capture
 * presets (src/media/presets.ts picks fps/quality/hardware/codec/bitrate); the
 * full-display recording engine that consumed the rest is gone.
 */
export interface VideoOptions {
  fps: 30 | 60
  quality: 'lossless' | 'high' | 'medium'
  hardware: boolean       // use VideoToolbox on macOS
  codec: 'h264' | 'hevc'
  bitrate: '4M' | '8M'
  maxDuration?: number    // seconds, safety limit (default: 300)
  captureInput?: string   // avfoundation video input, e.g. "4:none"
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

// ─── Argument Builders (probe + poster) ──────────────────────

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

// ─── Probe + Poster ──────────────────────────────────────────

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
