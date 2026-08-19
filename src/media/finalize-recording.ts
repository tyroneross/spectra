// src/media/finalize-recording.ts
//
// Finalize + validate a raw screen recording into a universally-playable mp4.
//
// The native ScreenCaptureKit recorder can emit H.264 4:4:4 (pix_fmt=gbrp,
// "High 4:4:4 Predictive"), which QuickTime/Preview/most editors CANNOT decode,
// and — in the observed failure mode — sometimes leaves a truncated/stub file
// with no moov atom. This module produces a yuv420p + faststart mp4 and refuses
// to succeed unless the OUTPUT is a real, playable video: it is the gate that
// prevents 4:4:4 files and 5-byte stubs from ever being registered as valid
// "video" artifacts.
//
// It mirrors the production polish path (src/pipeline/polish.ts:
// `-c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart`) and reuses the
// repo's ffmpeg detection (src/media/ffmpeg.ts) + the mockable process runner
// (src/media/pipeline.ts). No hardcoded ffmpeg paths.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { open, stat } from 'node:fs/promises'
import { detectFfmpeg } from './ffmpeg.js'
import { getProcessRunner } from './pipeline.js'

/** A finalized recording smaller than this is treated as a stub/failure. */
export const MIN_VALID_BYTES = 1024

export interface FinalizeProbe {
  hasVideoStream: boolean
  hasAudioStream: boolean
  codec?: string
  pixFmt?: string
  width?: number
  height?: number
  durationMs?: number
}

export type FinalizeAction = 'remux' | 'transcode'

export interface FinalizeResult {
  /** The validated, registerable mp4 (yuv420p + faststart). */
  path: string
  action: FinalizeAction
  sizeBytes: number
  probe: FinalizeProbe
}

/**
 * Thrown when the raw source is unusable or the finalized output fails
 * validation. Callers should surface this loudly and never register an
 * artifact — the raw is preserved for rescue.
 */
export class RecordingFinalizeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RecordingFinalizeError'
  }
}

/**
 * Builds the ffmpeg argv for finalizing a recording.
 * - `remux`: lossless container rewrite for an already-web-safe stream
 *   (`-c copy -movflags +faststart`).
 * - `transcode`: re-encode to yuv420p H.264 with faststart, matching
 *   polish.ts. Audio is preserved (AAC) when present, else stripped (`-an`).
 */
export function buildFinalizeArgs(
  input: string,
  output: string,
  action: FinalizeAction,
  hasAudio: boolean,
): string[] {
  if (action === 'remux') {
    return ['-y', '-i', input, '-c', 'copy', '-movflags', '+faststart', output]
  }
  return [
    '-y',
    '-i', input,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-preset', 'veryfast',
    '-movflags', '+faststart',
    ...(hasAudio ? ['-c:a', 'aac'] : ['-an']),
    output,
  ]
}

export function buildFinalizeProbeArgs(path: string): string[] {
  return [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height,duration:format=duration',
    '-of', 'json',
    path,
  ]
}

/**
 * Probes a media file for the fields finalize/validation needs (stream
 * presence, video codec, pixel format, dimensions, duration). Returns
 * `undefined` when ffprobe fails or emits no parsable output.
 */
export async function probeForFinalize(path: string): Promise<FinalizeProbe | undefined> {
  const proc = getProcessRunner()('ffprobe', buildFinalizeProbeArgs(path))
  const exitCode = await proc.waitForExit()
  if (exitCode !== 0 || !proc.stdout) return undefined
  const raw = await proc.stdout()
  if (!raw.trim()) return undefined

  let data: {
    streams?: Array<{
      codec_type?: string
      codec_name?: string
      pix_fmt?: string
      width?: number
      height?: number
      duration?: string
    }>
    format?: { duration?: string }
  }
  try {
    data = JSON.parse(raw)
  } catch {
    return undefined
  }

  const streams = data.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')
  const durationSeconds =
    numberFromString(video?.duration) ?? numberFromString(data.format?.duration)

  return {
    hasVideoStream: Boolean(video),
    hasAudioStream: Boolean(audio),
    codec: video?.codec_name,
    pixFmt: video?.pix_fmt,
    width: typeof video?.width === 'number' ? video.width : undefined,
    height: typeof video?.height === 'number' ? video.height : undefined,
    durationMs: durationSeconds === undefined ? undefined : Math.round(durationSeconds * 1000),
  }
}

/**
 * Bounded scan for an mp4 `moov` atom. A 5-byte stub (the observed failure
 * mode) has none; a faststart mp4 places it near the front. Scans the head and
 * tail so a non-faststart mp4 (moov at end) still validates.
 */
export async function hasMoovAtom(path: string): Promise<boolean> {
  const CHUNK = 2 * 1024 * 1024
  const needle = Buffer.from('moov', 'ascii')
  const fileSize = (await stat(path)).size
  if (fileSize < 8) return false

  const handle = await open(path, 'r')
  try {
    const headLen = Math.min(CHUNK, fileSize)
    const head = Buffer.alloc(headLen)
    await handle.read(head, 0, headLen, 0)
    if (head.includes(needle)) return true

    if (fileSize > headLen) {
      const tailLen = Math.min(CHUNK, fileSize)
      const tail = Buffer.alloc(tailLen)
      await handle.read(tail, 0, tailLen, fileSize - tailLen)
      if (tail.includes(needle)) return true
    }
    return false
  } finally {
    await handle.close()
  }
}

export interface FinalizeRecordingParams {
  /** The raw file emitted by the native recorder. Preserved on success/failure. */
  rawPath: string
  /** Destination for the validated, registerable mp4. */
  outPath: string
}

/**
 * Finalizes a raw recording into a validated yuv420p + faststart mp4.
 *
 * Fast path: already H.264 + yuv420p → lossless remux (`-c copy`).
 * Otherwise: transcode to yuv420p H.264 (preserving audio if present).
 *
 * Validates the OUTPUT before returning: size ≥ 1KB, has a moov atom, has a
 * video stream, duration > 0, and pix_fmt === yuv420p. Any failure throws
 * `RecordingFinalizeError` — the caller keeps the raw and registers nothing.
 */
export async function finalizeRecording(params: FinalizeRecordingParams): Promise<FinalizeResult> {
  const { rawPath, outPath } = params

  // Guard the source against the stub class before spending an ffmpeg pass.
  const rawStat = await stat(rawPath).catch(() => undefined)
  if (!rawStat) {
    throw new RecordingFinalizeError(`Raw recording not found at ${rawPath}`)
  }
  if (rawStat.size < MIN_VALID_BYTES) {
    throw new RecordingFinalizeError(
      `Raw recording at ${rawPath} is ${rawStat.size} bytes (< ${MIN_VALID_BYTES}); `
      + 'the native recorder produced a stub with no usable video.',
    )
  }

  if (!detectFfmpeg()) {
    throw new RecordingFinalizeError(
      'ffmpeg not found — cannot finalize recording. Install with: brew install ffmpeg',
    )
  }

  const sourceProbe = await probeForFinalize(rawPath)
  if (!sourceProbe || !sourceProbe.hasVideoStream) {
    throw new RecordingFinalizeError(
      `Raw recording at ${rawPath} has no decodable video stream.`,
    )
  }
  if (!sourceProbe.durationMs || sourceProbe.durationMs <= 0) {
    throw new RecordingFinalizeError(
      `Raw recording at ${rawPath} has zero duration.`,
    )
  }

  const action: FinalizeAction =
    sourceProbe.codec === 'h264' && sourceProbe.pixFmt === 'yuv420p' ? 'remux' : 'transcode'

  const args = buildFinalizeArgs(rawPath, outPath, action, sourceProbe.hasAudioStream)
  const proc = getProcessRunner()('ffmpeg', args)
  const exitCode = await proc.waitForExit()
  if (exitCode !== 0) {
    const detail = proc.stderr ? await proc.stderr().catch(() => '') : ''
    throw new RecordingFinalizeError(
      `ffmpeg ${action} failed (exit ${exitCode})${detail ? `: ${detail.trim()}` : ''}`,
    )
  }

  // Validate the OUTPUT — this is the gate that stops stubs / 4:4:4 files.
  const outStat = await stat(outPath).catch(() => undefined)
  if (!outStat || outStat.size < MIN_VALID_BYTES) {
    throw new RecordingFinalizeError(
      `Finalized output ${outPath} is ${outStat?.size ?? 'missing'} bytes (< ${MIN_VALID_BYTES}).`,
    )
  }
  if (!(await hasMoovAtom(outPath))) {
    throw new RecordingFinalizeError(
      `Finalized output ${outPath} has no moov atom — not a playable mp4.`,
    )
  }

  const outProbe = await probeForFinalize(outPath)
  if (!outProbe || !outProbe.hasVideoStream) {
    throw new RecordingFinalizeError(
      `Finalized output ${outPath} has no video stream after ${action}.`,
    )
  }
  if (!outProbe.durationMs || outProbe.durationMs <= 0) {
    throw new RecordingFinalizeError(
      `Finalized output ${outPath} has zero duration after ${action}.`,
    )
  }
  if (outProbe.pixFmt !== 'yuv420p') {
    throw new RecordingFinalizeError(
      `Finalized output ${outPath} is pix_fmt=${outProbe.pixFmt ?? 'unknown'}, expected yuv420p.`,
    )
  }

  return {
    path: outPath,
    action,
    sizeBytes: outStat.size,
    probe: outProbe,
  }
}

function numberFromString(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
