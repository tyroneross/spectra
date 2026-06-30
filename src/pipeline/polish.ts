import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cardsFromScript, timedStepCardsOverlayPlan } from './annotations.js'
import { framingFilter } from './framing.js'
import { scriptDurationMs, scriptZoomWindows, type DemoScript } from './script.js'
import { renderCaptionPng, renderFrameChromePng } from './text-render.js'
import { buildZoomTrack, type CursorPoint, type ZoomClick } from './zoom-keyframes.js'
import { timedZoomFilter, zoomFilter } from './zoom-render.js'

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

interface CaptionOverlay {
  path: string
  filter: string
  outputLabel: string
}

interface StaticFramePlan {
  imagePaths: string[]
  filter: string
}

const OUTPUT_W = 1920
const OUTPUT_H = 1080
const DEFAULT_FPS = 60
const DEFAULT_FADE_MS = 250

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
  const captionText = options.caption?.trim()
  const captionOverlay = captionText
    ? await buildClipCaptionOverlay(captionText, durationMs, 1, OUTPUT_W, OUTPUT_H)
    : undefined
  const fallbackCaption = captionOverlay ? undefined : captionText
  const captionMode = fallbackCaption && !(await ffmpegHasFilter('drawtext')) ? 'bitmap' : 'drawtext'
  const zoom = zoomFilter(track, metadata.width, metadata.height, OUTPUT_W, OUTPUT_H, fps)
  const frame = framingFilter({
    inputLabel: 'zoomed',
    outputLabel: captionOverlay ? 'framed' : 'v',
    caption: fallbackCaption,
    captionMode,
    fps,
    outW: OUTPUT_W,
    outH: OUTPUT_H,
  })
  const filterComplex = [
    `[0:v]fps=${fps},${zoom}[zoomed]`,
    frame,
    ...(captionOverlay ? [captionOverlay.filter] : []),
  ].join(';')

  await mkdir(dirname(options.outPath), { recursive: true })
  await runProcess('ffmpeg', [
    '-y',
    '-i', options.input,
    ...imageInputArgs(captionOverlay ? [captionOverlay.path] : [], fps),
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
  const frames = frameCount(durationMs, fps)
  const finalCaption = options.script.finalCaption?.trim()
  let nextInputIndex = 1
  const staticFrame = await buildStaticFramePlan(nextInputIndex, OUTPUT_W, OUTPUT_H)
  if (staticFrame) nextInputIndex += staticFrame.imagePaths.length
  const captionOverlay = finalCaption
    ? await buildCaptionOverlay(options.script, finalCaption, durationMs, nextInputIndex, OUTPUT_W, OUTPUT_H)
    : undefined
  if (captionOverlay) nextInputIndex += 1

  const fallbackCaption = captionOverlay ? undefined : finalCaption
  const captionMode = fallbackCaption && !(await ffmpegHasFilter('drawtext')) ? 'bitmap' : 'drawtext'
  const zoom = timedZoomFilter(scriptZoomWindows(options.script, durationMs), durationMs, metadata.width, metadata.height, OUTPUT_W, OUTPUT_H, fps)
  const useStaticFrame = staticFrame && !fallbackCaption
  const frame = useStaticFrame ? staticFrame.filter : framingFilter({
    inputLabel: 'zoomed',
    outputLabel: 'framed',
    caption: fallbackCaption,
    captionMode,
    fps,
    outW: OUTPUT_W,
    outH: OUTPUT_H,
  })
  const cardInputLabel = captionOverlay?.outputLabel ?? 'framed'
  const cardPlan = await timedStepCardsOverlayPlan({
    inputLabel: cardInputLabel,
    outputLabel: 'v',
    cards: cardsFromScript(options.script),
    fps,
    outW: OUTPUT_W,
    outH: OUTPUT_H,
    inputIndexStart: nextInputIndex,
  })
  const imagePaths = [
    ...(useStaticFrame ? staticFrame.imagePaths : []),
    ...(captionOverlay ? [captionOverlay.path] : []),
    ...cardPlan.imagePaths,
  ]
  const filterComplex = [
    `[0:v]fps=${fps},${zoom}[zoomed]`,
    frame,
    ...(captionOverlay ? [captionOverlay.filter] : []),
    cardPlan.filter,
  ].join(';')

  await mkdir(dirname(options.outPath), { recursive: true })
  await runProcess('ffmpeg', [
    '-y',
    '-i', options.input,
    ...imageInputArgs(imagePaths, fps),
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-frames:v', String(Math.max(1, frames)),
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
    frames,
  }
}

async function buildStaticFramePlan(
  inputIndex: number,
  outW: number,
  outH: number,
): Promise<StaticFramePlan | undefined> {
  const layout = frameLayout(outW, outH)
  const chrome = await renderFrameChromePng({
    outW,
    outH,
    contentW: layout.contentW,
    contentH: layout.contentH,
    contentX: layout.contentX,
    contentY: layout.contentY,
    cornerRadius: layout.radius,
  })
  if (!chrome) return undefined

  return {
    imagePaths: [chrome.backgroundPath, chrome.maskPath],
    filter: [
      `${labelRef(`${inputIndex}:v`)}format=rgba[frameBg]`,
      `${labelRef(`${inputIndex + 1}:v`)}format=gray[frameMask]`,
      `[zoomed]scale=${layout.contentW}:${layout.contentH}:force_original_aspect_ratio=decrease:flags=bicubic,format=rgba,pad=${layout.contentW}:${layout.contentH}:(ow-iw)/2:(oh-ih)/2:color=0x00000000[scaled]`,
      '[scaled][frameMask]alphamerge[window]',
      `[frameBg][window]overlay=x=${layout.contentX}:y=${layout.contentY}:shortest=1[framed]`,
    ].join(';'),
  }
}

function frameLayout(outW: number, outH: number): { contentW: number; contentH: number; contentX: number; contentY: number; radius: number } {
  const contentW = even(Math.round(outW * 0.88))
  const contentH = even(Math.round(outH * 0.88))
  return {
    contentW,
    contentH,
    contentX: Math.round((outW - contentW) / 2),
    contentY: Math.round((outH - contentH) / 2) - Math.round(outH * 0.02),
    radius: 20,
  }
}

function even(value: number): number {
  return value % 2 === 0 ? value : value + 1
}

async function buildClipCaptionOverlay(
  caption: string,
  durationMs: number,
  inputIndex: number,
  outW: number,
  outH: number,
): Promise<CaptionOverlay | undefined> {
  return buildTimedCaptionOverlay(
    caption,
    { startMs: 0, endMs: Math.max(0, durationMs) },
    inputIndex,
    outW,
    outH,
    'framed',
    'v',
  )
}

async function buildCaptionOverlay(
  script: DemoScript,
  finalCaption: string,
  durationMs: number,
  inputIndex: number,
  outW: number,
  outH: number,
): Promise<CaptionOverlay | undefined> {
  const window = finalCaptionWindow(script, finalCaption, durationMs)
  return buildTimedCaptionOverlay(finalCaption, window, inputIndex, outW, outH, 'framed', 'captioned')
}

async function buildTimedCaptionOverlay(
  text: string,
  window: { startMs: number; endMs: number },
  inputIndex: number,
  outW: number,
  outH: number,
  inputLabel: string,
  outputLabel: string,
): Promise<CaptionOverlay | undefined> {
  const path = await renderCaptionPng({
    text,
    outW,
    outH,
  })
  if (!path) return undefined

  const startSec = seconds(window.startMs)
  const endSec = seconds(window.endMs)
  const duration = window.endMs - window.startMs
  const fadeMs = Math.min(DEFAULT_FADE_MS, duration / 2)
  const fadeSec = seconds(fadeMs)
  const fadeOutStartSec = seconds(window.endMs - fadeMs)
  const fade = fadeSec === '0'
    ? ''
    : `,fade=t=in:st=${startSec}:d=${fadeSec}:alpha=1,fade=t=out:st=${fadeOutStartSec}:d=${fadeSec}:alpha=1`
  const assetLabel = 'captionPng'
  return {
    path,
    outputLabel,
    filter: `${labelRef(`${inputIndex}:v`)}format=rgba${fade}${labelRef(assetLabel)};${labelRef(inputLabel)}${labelRef(assetLabel)}overlay=x=0:y=0:shortest=1:enable='between(t\\,${startSec}\\,${endSec})'${labelRef(outputLabel)}`,
  }
}

function finalCaptionWindow(script: DemoScript, finalCaption: string, durationMs: number): { startMs: number; endMs: number } {
  const validBeats = script.beats
    .filter((beat) =>
      Number.isFinite(beat.startMs)
      && Number.isFinite(beat.endMs)
      && beat.endMs > beat.startMs
    )
  const matchingBeat = [...validBeats].reverse().find((beat) => beat.stepText?.trim() === finalCaption)
  const beat = matchingBeat ?? validBeats.at(-1)
  if (!beat) return { startMs: 0, endMs: durationMs }
  const window = {
    startMs: Math.max(0, Math.min(durationMs, beat.startMs)),
    endMs: Math.max(0, Math.min(durationMs, beat.endMs)),
  }
  return window.endMs > window.startMs ? window : { startMs: 0, endMs: durationMs }
}

function imageInputArgs(paths: string[], fps: number): string[] {
  return paths.flatMap((path) => [
    '-loop', '1',
    '-framerate', String(fps),
    '-i', path,
  ])
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function labelRef(label: string): string {
  return label.startsWith('[') && label.endsWith(']') ? label : `[${label}]`
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

function frameCount(durationMs: number, fps: number): number {
  return Math.ceil((durationMs / 1000) * fps)
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
