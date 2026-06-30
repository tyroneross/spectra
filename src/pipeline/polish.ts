import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cardsFromScript, timedStepCardsFilter } from './annotations.js'
import { framingFilter } from './framing.js'
import { buildScriptZoomTrack, scriptDurationMs, type DemoScript } from './script.js'
import { buildZoomTrack, type CursorPoint, type ZoomClick } from './zoom-keyframes.js'
import { zoomFilter } from './zoom-render.js'

export type ClicksJsonInput =
  | string
  | ZoomClick[]
  | {
    clicks?: ZoomClick[]
    cursorPath?: CursorPoint[]
  }

export interface PolishClipOptions {
  input: string
  clicksJson: ClicksJsonInput
  caption?: string
  outPath: string
  fps?: number
}

export interface PolishScriptOptions {
  input: string
  script: DemoScript
  outPath: string
  fps?: number
}

export interface PolishClipResult {
  outPath: string
  width: number
  height: number
  fps: number
  durationMs: number
  frames: number
}

interface VideoMetadata {
  width: number
  height: number
  durationMs?: number
}

interface ParsedClicks {
  clicks: ZoomClick[]
  cursorPath?: CursorPoint[]
}

const OUTPUT_W = 1920
const OUTPUT_H = 1080
const DEFAULT_FPS = 60

export async function polishClip(options: PolishClipOptions): Promise<PolishClipResult> {
  const fps = options.fps ?? DEFAULT_FPS
  if (!Number.isInteger(fps) || fps <= 0) {
    throw new Error('fps must be a positive integer')
  }

  const metadata = await probeVideo(options.input)
  const parsed = await parseClicksJson(options.clicksJson)
  const durationMs = metadata.durationMs ?? inferDurationMs(parsed)
  const track = buildZoomTrack(parsed.clicks, durationMs, fps, {
    cursorPath: parsed.cursorPath,
  })
  const captionMode = options.caption && !(await ffmpegHasFilter('drawtext')) ? 'bitmap' : 'drawtext'
  const zoom = zoomFilter(track, metadata.width, metadata.height, OUTPUT_W, OUTPUT_H, fps)
  const frame = framingFilter({
    inputLabel: 'zoomed',
    outputLabel: 'v',
    caption: options.caption,
    captionMode,
    fps,
    outW: OUTPUT_W,
    outH: OUTPUT_H,
  })
  const filterComplex = `[0:v]fps=${fps},${zoom}[zoomed];${frame}`

  await mkdir(dirname(options.outPath), { recursive: true })
  await runProcess('ffmpeg', [
    '-y',
    '-i', options.input,
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-frames:v', String(Math.max(1, track.length)),
    '-an',
    '-r', String(fps),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-movflags', '+faststart',
    options.outPath,
  ])

  return {
    outPath: options.outPath,
    width: OUTPUT_W,
    height: OUTPUT_H,
    fps,
    durationMs,
    frames: track.length,
  }
}

export async function polishScript(options: PolishScriptOptions): Promise<PolishClipResult> {
  const fps = options.fps ?? DEFAULT_FPS
  if (!Number.isInteger(fps) || fps <= 0) {
    throw new Error('fps must be a positive integer')
  }

  const metadata = await probeVideo(options.input)
  const durationMs = metadata.durationMs ?? scriptDurationMs(options.script)
  const track = buildScriptZoomTrack(options.script, durationMs, fps)
  const finalCaption = options.script.finalCaption?.trim()
  const captionMode = finalCaption && !(await ffmpegHasFilter('drawtext')) ? 'bitmap' : 'drawtext'
  const zoom = zoomFilter(track, metadata.width, metadata.height, OUTPUT_W, OUTPUT_H, fps)
  const frame = framingFilter({
    inputLabel: 'zoomed',
    outputLabel: 'framed',
    caption: finalCaption,
    captionMode,
    fps,
    outW: OUTPUT_W,
    outH: OUTPUT_H,
  })
  const cards = timedStepCardsFilter({
    inputLabel: 'framed',
    outputLabel: 'v',
    cards: cardsFromScript(options.script),
    fps,
    outW: OUTPUT_W,
    outH: OUTPUT_H,
  })
  const filterComplex = `[0:v]fps=${fps},${zoom}[zoomed];${frame};${cards}`

  await mkdir(dirname(options.outPath), { recursive: true })
  await runProcess('ffmpeg', [
    '-y',
    '-i', options.input,
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-frames:v', String(Math.max(1, track.length)),
    '-an',
    '-r', String(fps),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-movflags', '+faststart',
    options.outPath,
  ])

  return {
    outPath: options.outPath,
    width: OUTPUT_W,
    height: OUTPUT_H,
    fps,
    durationMs,
    frames: track.length,
  }
}

async function probeVideo(input: string): Promise<VideoMetadata> {
  const stdout = await runProcess('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration:format=duration',
    '-of', 'json',
    input,
  ])
  const data = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number; duration?: string }>
    format?: { duration?: string }
  }
  const stream = data.streams?.[0]
  if (!stream?.width || !stream.height) {
    throw new Error(`Could not read video dimensions for ${input}`)
  }

  const durationSeconds = numberFromString(stream.duration) ?? numberFromString(data.format?.duration)
  return {
    width: stream.width,
    height: stream.height,
    durationMs: durationSeconds === undefined ? undefined : Math.round(durationSeconds * 1000),
  }
}

async function parseClicksJson(input: ClicksJsonInput): Promise<ParsedClicks> {
  const raw = typeof input === 'string'
    ? await readClicksSource(input)
    : input

  if (Array.isArray(raw)) {
    return { clicks: raw }
  }

  return {
    clicks: raw.clicks ?? [],
    cursorPath: raw.cursorPath,
  }
}

async function readClicksSource(input: string): Promise<ZoomClick[] | { clicks?: ZoomClick[]; cursorPath?: CursorPoint[] }> {
  const trimmed = input.trim()
  const json = trimmed.startsWith('{') || trimmed.startsWith('[')
    ? trimmed
    : await readFile(input, 'utf-8')
  const parsed = JSON.parse(json) as unknown
  if (Array.isArray(parsed)) return parsed as ZoomClick[]
  if (parsed && typeof parsed === 'object') {
    return parsed as { clicks?: ZoomClick[]; cursorPath?: CursorPoint[] }
  }
  throw new Error('clicksJson must be a JSON array or an object with clicks/cursorPath')
}

function inferDurationMs(parsed: ParsedClicks): number {
  const clickTimes = parsed.clicks.map((click) => click.tMs)
  const cursorTimes = parsed.cursorPath?.map((point) => point.tMs) ?? []
  const latest = Math.max(0, ...clickTimes, ...cursorTimes)
  return latest + 3500
}

function numberFromString(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

async function ffmpegHasFilter(name: string): Promise<boolean> {
  const filters = await runProcess('ffmpeg', ['-hide_banner', '-filters']).catch(() => '')
  return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(filters)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function runProcess(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolveProcess, reject) => {
    const proc = spawn(cmd, args, { stdio: 'pipe' })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(Buffer.from(chunk)))
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)))
    proc.on('error', reject)
    proc.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
      if (code === 0) {
        resolveProcess(stdout)
        return
      }
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()
      reject(new Error(`${cmd} exited with code ${code}${stderr ? `\n${stderr}` : ''}`))
    })
  })
}

function parseCliArgs(argv: string[]): PolishClipOptions {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }
    values.set(key, value)
    index += 1
  }

  const input = values.get('input')
  const outPath = values.get('out') ?? values.get('outPath')
  const clicksJson = values.get('clicks-json') ?? values.get('clicksJson') ?? values.get('clicks')
  if (!input || !outPath || !clicksJson) {
    throw new Error('Usage: polish --input <video> --clicks-json <json-or-path> --caption <text> --out <mp4>')
  }

  const rawFps = values.get('fps')
  return {
    input,
    outPath,
    clicksJson,
    caption: values.get('caption'),
    fps: rawFps ? Number(rawFps) : undefined,
  }
}

function isDirectRun(): boolean {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
}

if (isDirectRun()) {
  polishClip(parseCliArgs(process.argv.slice(2))).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
