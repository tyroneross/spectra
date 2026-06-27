// src/media/spotlight.ts
// Agent demo video production — spotlight focus, activity scan, segment render, merge.
import { spawnSync, spawn } from 'node:child_process'
import { writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { requireFfmpeg } from './ffmpeg.js'

// ─── Internal helpers ─────────────────────────────────────────

async function spawnFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderrChunks: Buffer[] = []
    const proc = spawn(ffmpegPath, args, { stdio: 'pipe' })
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)))
    proc.stdout?.on('data', () => {})
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else {
        const stderr = Buffer.concat(stderrChunks).toString().trim()
        reject(new Error(`ffmpeg exited with code ${code}${stderr ? '\n' + stderr : ''}`))
      }
    })
    proc.on('error', reject)
  })
}

function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
}

function uniqueTmpId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ─── Activity scan pure helpers ───────────────────────────────

/**
 * Parse pts_time values from ffmpeg showinfo filter stderr output.
 * Pure function — no ffmpeg required.
 */
export function parsePtsLines(stderrLines: string[]): number[] {
  const pts: number[] = []
  for (const line of stderrLines) {
    const match = line.match(/pts_time:(\d+(?:\.\d+)?)/)
    if (match) {
      const val = parseFloat(match[1])
      if (Number.isFinite(val)) pts.push(val)
    }
  }
  return pts
}

/**
 * Bucket pts_time values into per-minute change counts.
 * Pure function.
 */
export function bucketPerMinute(ptsTimes: number[]): { minute: number; changes: number }[] {
  const counts = new Map<number, number>()
  for (const t of ptsTimes) {
    const minute = Math.floor(t / 60)
    counts.set(minute, (counts.get(minute) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([minute, changes]) => ({ minute, changes }))
}

/**
 * Derive contiguous active ranges from activity timestamps with gap tolerance.
 * Timestamps within gapToleranceSec of each other are merged into one range.
 * Pure function.
 */
export function deriveActiveRanges(
  ptsTimes: number[],
  gapToleranceSec = 5,
): { startSec: number; endSec: number }[] {
  if (ptsTimes.length === 0) return []
  const sorted = [...ptsTimes].sort((a, b) => a - b)
  const ranges: { startSec: number; endSec: number }[] = []
  let start = sorted[0]
  let end = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - end
    if (gap <= gapToleranceSec) {
      end = sorted[i]
    } else {
      ranges.push({ startSec: start, endSec: end })
      start = sorted[i]
      end = sorted[i]
    }
  }
  ranges.push({ startSec: start, endSec: end })
  return ranges
}

// ─── Activity scan (ffmpeg) ───────────────────────────────────

/**
 * Scan a video for scene-change activity using ffmpeg fps+select+showinfo.
 * Returns per-minute change counts and contiguous active ranges.
 */
export async function scanActivity(
  input: string,
  opts?: { threshold?: number },
): Promise<{
  perMinute: { minute: number; changes: number }[]
  activeRanges: { startSec: number; endSec: number }[]
}> {
  const threshold = opts?.threshold ?? 0.04
  const ffmpeg = requireFfmpeg()
  const filter = `fps=1,select='gt(scene,${threshold})',showinfo`

  const args = [
    '-i', input,
    '-vf', filter,
    '-an',
    '-f', 'null',
    '-',
  ]

  const stderrLines = await new Promise<string[]>((resolve, reject) => {
    const chunks: Buffer[] = []
    const proc = spawn(ffmpeg, args, { stdio: 'pipe' })
    proc.stderr?.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    proc.stdout?.on('data', () => {})
    proc.on('close', () => resolve(Buffer.concat(chunks).toString('utf-8').split(/\r?\n/)))
    proc.on('error', reject)
  })

  const ptsTimes = parsePtsLines(stderrLines)
  return {
    perMinute: bucketPerMinute(ptsTimes),
    activeRanges: deriveActiveRanges(ptsTimes),
  }
}

// ─── Spotlight filter builder (pure) ─────────────────────────

export interface FocalRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CanvasSize {
  w: number
  h: number
}

/**
 * Build an ffmpeg filtergraph string that applies a spotlight focus effect.
 * Dims and blurs the background; keeps the focal region sharp.
 * Output label: [out]
 * Pure function — no side effects.
 */
export function buildSpotlightFilter(opts: {
  focal: FocalRect
  canvas: CanvasSize
  dim?: number
  blur?: number
  feather?: number
}): string {
  const { focal, canvas } = opts
  const dim = opts.dim ?? 0.2
  const blur = opts.blur ?? 22
  const feather = opts.feather ?? 40
  const cw = canvas.w
  const ch = canvas.h

  const parts = [
    `[0:v]split=3[raw][bg_in][mask_in]`,
    `[bg_in]gblur=sigma=${blur},eq=brightness=-${dim}:saturation=0.6[bg]`,
    `[mask_in]drawbox=0:0:iw:ih:black:fill,drawbox=${focal.x}:${focal.y}:${focal.w}:${focal.h}:white:fill,gblur=sigma=${feather}[mask]`,
    `[raw][mask]alphamerge[sharp]`,
    `[bg][sharp]overlay=0:0[composed]`,
    `[composed]scale=${cw}:${ch}:force_original_aspect_ratio=decrease,pad=${cw}:${ch}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[out]`,
  ]
  return parts.join(';')
}

// ─── drawtext detection (cached) ─────────────────────────────

let drawtextCache: boolean | undefined = undefined

/**
 * Detect whether the installed ffmpeg supports the drawtext filter.
 * Result is cached after the first call.
 */
export function hasDrawtext(): boolean {
  if (drawtextCache !== undefined) return drawtextCache
  try {
    const ffmpeg = requireFfmpeg()
    const result = spawnSync(ffmpeg, ['-hide_banner', '-filters'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    const output = (result.stdout ?? '') + (result.stderr ?? '')
    drawtextCache = output.includes('drawtext')
  } catch {
    drawtextCache = false
  }
  return drawtextCache
}

// ─── Segment render ───────────────────────────────────────────

export interface RenderSegmentOpts {
  input: string
  startSec: number
  durationSec: number
  focal: FocalRect
  canvas: CanvasSize
  caption?: string
  captionPngPath?: string
  speed?: number
  out: string
}

/**
 * Render a single spotlight-focused segment to an mp4 file.
 * Audio is always stripped (-an).
 */
export async function renderSegment(opts: RenderSegmentOpts): Promise<void> {
  const ffmpeg = requireFfmpeg()

  // Start with the spotlight filtergraph (outputs [out])
  let filterParts = buildSpotlightFilter({ focal: opts.focal, canvas: opts.canvas })
  let lastLabel = '[out]'
  const extraInputArgs: string[] = []
  const shortestArgs: string[] = []

  if (opts.caption && hasDrawtext()) {
    // Lower-third bar + centered drawtext
    const escaped = escapeDrawtext(opts.caption)
    const captionFilter = (
      `${lastLabel}drawbox=0:ih-90:iw:90:black@0.6:fill,` +
      `drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc` +
      `:text=${escaped}` +
      `:x=(w-text_w)/2:y=h-63:fontsize=36:fontcolor=white[cap]`
    )
    filterParts += ';' + captionFilter
    lastLabel = '[cap]'
  } else if (opts.captionPngPath) {
    // Overlay PNG caption; -loop 1 makes the still image fill the segment duration
    extraInputArgs.push('-loop', '1', '-i', opts.captionPngPath)
    filterParts += `;${lastLabel}[1:v]overlay=(W-w)/2:H-h-10[cap]`
    lastLabel = '[cap]'
    shortestArgs.push('-shortest')
  } else if (opts.caption) {
    process.stderr.write(
      `[spectra_demo] drawtext not available; caption "${opts.caption}" skipped\n`,
    )
  }

  if (opts.speed !== undefined && opts.speed !== 1) {
    filterParts += `;${lastLabel}setpts=PTS/${opts.speed}[sped]`
    lastLabel = '[sped]'
  }

  const args = [
    '-ss', String(opts.startSec),
    '-t', String(opts.durationSec),
    '-i', opts.input,
    ...extraInputArgs,
    '-filter_complex', filterParts,
    '-map', lastLabel,
    '-an',
    ...shortestArgs,
    '-y',
    opts.out,
  ]

  await spawnFfmpeg(ffmpeg, args)
}

// ─── Segment merge ────────────────────────────────────────────

/**
 * Merge segments using ffmpeg concat demuxer (stream copy — no re-encode).
 * All segments must share the same codec, size, and fps.
 */
export async function mergeSegments(segPaths: string[], out: string): Promise<void> {
  const ffmpeg = requireFfmpeg()
  const listFile = join(tmpdir(), `spectra-concat-${uniqueTmpId()}.txt`)
  const listContent = segPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')

  await writeFile(listFile, listContent, 'utf-8')
  try {
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-y',
      out,
    ]
    await spawnFfmpeg(ffmpeg, args)
  } finally {
    await rm(listFile, { force: true }).catch(() => {})
  }
}

// ─── Polish demo pipeline ─────────────────────────────────────

export interface PolishSegmentSpec {
  input: string
  startSec: number
  durationSec: number
  focal: FocalRect
  caption?: string
  captionPngPath?: string
}

export interface PolishDemoSpec {
  canvas: CanvasSize
  fps?: number
  segments: PolishSegmentSpec[]
  speed?: number
}

export interface PolishDemoResult {
  out: string
  segmentCount: number
  warnings: string[]
}

/**
 * Render each segment with the spotlight filter then merge into one mp4.
 * Segments are written to a temp directory and cleaned up after merge.
 */
export async function polishDemo(
  spec: PolishDemoSpec,
  out: string,
): Promise<PolishDemoResult> {
  const warnings: string[] = []
  const tmpDir = join(tmpdir(), `spectra-demo-${uniqueTmpId()}`)
  await mkdir(tmpDir, { recursive: true })

  const segPaths: string[] = []

  try {
    for (let i = 0; i < spec.segments.length; i++) {
      const seg = spec.segments[i]
      const segOut = join(tmpDir, `seg-${String(i).padStart(4, '0')}.mp4`)

      if (seg.caption && !hasDrawtext()) {
        if (seg.captionPngPath) {
          warnings.push(`segment ${i}: drawtext unavailable — using captionPngPath fallback`)
        } else {
          warnings.push(`segment ${i}: drawtext unavailable and no captionPngPath — caption skipped`)
        }
      }

      await renderSegment({
        input: seg.input,
        startSec: seg.startSec,
        durationSec: seg.durationSec,
        focal: seg.focal,
        canvas: spec.canvas,
        caption: seg.caption,
        captionPngPath: seg.captionPngPath,
        speed: spec.speed,
        out: segOut,
      })

      segPaths.push(segOut)
    }

    await mergeSegments(segPaths, out)
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }

  return { out, segmentCount: spec.segments.length, warnings }
}
