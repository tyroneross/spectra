import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CanvasSize, FocalRect } from '../media/spotlight.js'
import { cardsFromScript, timedStepCardsOverlayPlan } from './annotations.js'
import { deriveZoomTrackFromActivity } from './auto-zoom.js'
import { frameChromeRenderPlan, framingFilter, type FrameChromeAssets } from './framing.js'
import { scriptDurationMs, scriptZoomWindows, type DemoScript } from './script.js'
import { cleanupSpotlightPrePass, defaultBoldSpotlightFocal, renderSpotlightPrePass } from './spotlight.js'
import { renderCaptionPng, type CaptionBannerStyle, type CaptionBannerStyleName } from './text-render.js'
import { resolveFocalRect } from './window-focus.js'
import { buildZoomTrack, type CursorPoint, type ZoomClick } from './zoom-keyframes.js'
import { timedZoomFilter, zoomFilter } from './zoom-render.js'

export type ClicksJsonInput =
  | string
  | ZoomClick[]
  | {
    clicks?: ZoomClick[]
    cursorPath?: CursorPoint[]
  }

/**
 * Optional whole-clip spotlight pre-pass: the focal rect stays sharp and full
 * brightness, everything else gets a feathered blur + dark-crush toward
 * near-black (see pipeline/spotlight.ts DARK_SPOTLIGHT_DEFAULTS). Applied
 * before zoom/framing/caption so those stages see an already-spotlighted
 * frame. Per-beat spotlight is out of scope — this is a single focal rect for
 * the whole clip.
 */
export interface PolishClipSpotlightOptions {
  focal: FocalRect
  dim?: number
  blur?: number
  feather?: number
}

/**
 * Auto-detects the focal window instead of requiring a hand-specified
 * `spotlight.focal` rect -- for captures showing multiple windows / desktop
 * clutter, where the frontmost/target window should be spotlighted
 * automatically. `true` auto-detects the frontmost application's window; an
 * object filters by app name and/or window title substring (see
 * `resolveFocalRect` in window-focus.ts). Ignored when an explicit
 * `spotlight` is already given. If the underlying native helper can't
 * resolve a window (missing binary, no GUI session, no match), auto-focus is
 * silently skipped -- it never fails the render.
 */
export type AutoFocusOption = boolean | { app?: string; title?: string }

export interface PolishClipOptions {
  input: string
  clicksJson: ClicksJsonInput
  caption?: string
  outPath: string
  fps?: number
  spotlight?: PolishClipSpotlightOptions
  /** See `AutoFocusOption`. */
  autoFocus?: AutoFocusOption
  /**
   * Caption banner style preset ('cool' | 'warm' | 'bold', or a custom
   * CaptionBannerStyle object). Threaded down into the step-card/caption PNG
   * renders. Absent => 'cool' (today's fixed look, unchanged). 'bold' also
   * turns on the dark-crush spotlight pre-pass by default -- see `spotlight`.
   */
  style?: CaptionBannerStyle | CaptionBannerStyleName
}

export interface PolishScriptOptions {
  input: string
  script: DemoScript
  outPath: string
  fps?: number
  /**
   * Path to a voiceover/narration audio file. When set, this audio REPLACES
   * any input audio: it starts at t=0, is padded with silence if shorter than
   * the video (so a short VO never truncates the video) and trimmed to the
   * video duration if longer. When absent, behavior is unchanged (input audio
   * passthrough via buildAudioArgs, or `-an` when the source is silent).
   */
  voiceover?: string
  /** Same whole-clip dark-crush spotlight pre-pass as PolishClipOptions.spotlight. */
  spotlight?: PolishClipSpotlightOptions
  /** Same auto-focal-window detection as PolishClipOptions.autoFocus. */
  autoFocus?: AutoFocusOption
  /** Same caption banner style preset as PolishClipOptions.style. */
  style?: CaptionBannerStyle | CaptionBannerStyleName
}

/**
 * Resolves the effective spotlight pre-pass options, in priority order:
 * 1. An explicit `spotlight` (with its own `focal`) is always honored as-is.
 * 2. Otherwise, if `autoFocus` is set, resolve a focal rect via the
 *    window-bounds native helper (`resolveFocalRect`). A successful
 *    resolution wins; a `undefined` result (binary missing, no GUI session,
 *    no matching window) falls through to (3) rather than failing.
 * 3. Otherwise, turn the spotlight on with a sensible default focal rect
 *    when style is the 'bold' preset (bold = cinematic dark-crush by
 *    default). Only the string preset name 'bold' triggers this -- a custom
 *    style object isn't assumed to want the spotlight look.
 * 4. Otherwise, no spotlight -- unchanged behavior.
 */
async function resolveSpotlightOptions(
  requested: PolishClipSpotlightOptions | undefined,
  style: CaptionBannerStyle | CaptionBannerStyleName | undefined,
  canvas: CanvasSize,
  autoFocus: AutoFocusOption | undefined,
): Promise<PolishClipSpotlightOptions | undefined> {
  if (requested) return requested

  if (autoFocus) {
    const filters = typeof autoFocus === 'object' ? autoFocus : {}
    const focal = await resolveFocalRect({ app: filters.app, title: filters.title, canvas })
    if (focal) return { focal }
  }

  if (style !== 'bold') return undefined
  return { focal: defaultBoldSpotlightFocal(canvas) }
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

interface FrameChromePlan {
  /** Full ffmpeg input args for the precomputed mask, ready to splice into argv. */
  maskInputArgs: string[]
  chromeAssets: FrameChromeAssets
}

const OUTPUT_W = 1920
const OUTPUT_H = 1080
const DEFAULT_FPS = 60
const DEFAULT_FADE_MS = 250
const CHROME_CACHE_VERSION = 1
const CHROME_CACHE_DIR = join(tmpdir(), 'spectra-frame-chrome')

export async function polishClip(options: PolishClipOptions): Promise<PolishClipResult> {
  const fps = options.fps ?? DEFAULT_FPS
  if (!Number.isInteger(fps) || fps <= 0) {
    throw new Error('fps must be a positive integer')
  }

  const [metadata, hasAudio] = await Promise.all([
    probeVideo(options.input),
    probeHasAudio(options.input),
  ])

  const spotlight = await resolveSpotlightOptions(options.spotlight, options.style, { w: metadata.width, h: metadata.height }, options.autoFocus)
  let renderInput = options.input
  let spotlightTempPath: string | undefined
  if (spotlight) {
    spotlightTempPath = await renderSpotlightPrePass({
      input: options.input,
      canvas: { w: metadata.width, h: metadata.height },
      focal: spotlight.focal,
      dim: spotlight.dim,
      blur: spotlight.blur,
      feather: spotlight.feather,
      hasAudio,
    })
    renderInput = spotlightTempPath
  }

  try {
    const parsed = await parseClicksJson(options.clicksJson)
    const durationMs = metadata.durationMs ?? inferDurationMs(parsed)
    // No hand-authored clicks or cursor path: auto-derive a zoom track from
    // scene-change activity (see auto-zoom.ts) so the clip still zooms during
    // active stretches. Explicit clicksJson (or a cursorPath) is always
    // honored as-is — this is fill-only for the empty case, and falls back
    // to the prior static (no-zoom) behavior when no activity is detected.
    const effectiveClicks = parsed.clicks.length === 0 && !parsed.cursorPath?.length
      ? await deriveZoomTrackFromActivity(options.input, durationMs)
      : parsed.clicks
    const track = buildZoomTrack(effectiveClicks, durationMs, fps, {
      cursorPath: parsed.cursorPath,
    })
    let nextInputIndex = 1
    const chrome = await renderFrameChromeAssets(nextInputIndex, OUTPUT_W, OUTPUT_H, fps)
    nextInputIndex += 1
    const captionText = options.caption?.trim()
    const captionOverlay = captionText
      ? await buildClipCaptionOverlay(captionText, durationMs, nextInputIndex, OUTPUT_W, OUTPUT_H, options.style)
      : undefined
    if (captionOverlay) nextInputIndex += 1
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
      chromeAssets: chrome.chromeAssets,
    })
    const filterComplex = [
      `[0:v]fps=${fps},${zoom}[zoomed]`,
      frame,
      ...(captionOverlay ? [captionOverlay.filter] : []),
    ].join(';')

    const audio = buildAudioArgs(hasAudio)
    await mkdir(dirname(options.outPath), { recursive: true })
    await runProcess('ffmpeg', [
      '-y',
      '-i', renderInput,
      ...chrome.maskInputArgs,
      ...imageInputArgs(captionOverlay ? [captionOverlay.path] : [], fps),
      '-filter_complex', filterComplex,
      '-map', '[v]',
      ...audio.mapArgs,
      '-frames:v', String(Math.max(1, track.length)),
      ...audio.codecArgs,
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
  } finally {
    if (spotlightTempPath) await cleanupSpotlightPrePass(spotlightTempPath)
  }
}

export async function polishScript(options: PolishScriptOptions): Promise<PolishClipResult> {
  const fps = options.fps ?? DEFAULT_FPS
  if (!Number.isInteger(fps) || fps <= 0) {
    throw new Error('fps must be a positive integer')
  }

  const [metadata, hasAudio] = await Promise.all([
    probeVideo(options.input),
    probeHasAudio(options.input),
  ])

  const spotlight = await resolveSpotlightOptions(options.spotlight, options.style, { w: metadata.width, h: metadata.height }, options.autoFocus)
  let renderInput = options.input
  let spotlightTempPath: string | undefined
  if (spotlight) {
    spotlightTempPath = await renderSpotlightPrePass({
      input: options.input,
      canvas: { w: metadata.width, h: metadata.height },
      focal: spotlight.focal,
      dim: spotlight.dim,
      blur: spotlight.blur,
      feather: spotlight.feather,
      hasAudio,
    })
    renderInput = spotlightTempPath
  }

  try {
    const durationMs = metadata.durationMs ?? scriptDurationMs(options.script)
    const frames = frameCount(durationMs, fps)
    const finalCaption = options.script.finalCaption?.trim()
    let nextInputIndex = 1
    const chrome = await renderFrameChromeAssets(nextInputIndex, OUTPUT_W, OUTPUT_H, fps)
    nextInputIndex += 1
    const captionOverlay = finalCaption
      ? await buildCaptionOverlay(options.script, finalCaption, durationMs, nextInputIndex, OUTPUT_W, OUTPUT_H, options.style)
      : undefined
    if (captionOverlay) nextInputIndex += 1

    const fallbackCaption = captionOverlay ? undefined : finalCaption
    const captionMode = fallbackCaption && !(await ffmpegHasFilter('drawtext')) ? 'bitmap' : 'drawtext'
    const zoom = timedZoomFilter(scriptZoomWindows(options.script, durationMs), durationMs, metadata.width, metadata.height, OUTPUT_W, OUTPUT_H, fps)
    const frame = framingFilter({
      inputLabel: 'zoomed',
      outputLabel: 'framed',
      caption: fallbackCaption,
      captionMode,
      fps,
      outW: OUTPUT_W,
      outH: OUTPUT_H,
      chromeAssets: chrome.chromeAssets,
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
      style: options.style,
    })
    const imagePaths = [
      ...(captionOverlay ? [captionOverlay.path] : []),
      ...cardPlan.imagePaths,
    ]
    const filterComplex = [
      `[0:v]fps=${fps},${zoom}[zoomed]`,
      frame,
      ...(captionOverlay ? [captionOverlay.filter] : []),
      cardPlan.filter,
    ].join(';')

    // Input order is load-bearing for the filter graph: 0 = source video, 1 =
    // chrome mask, then the looped overlay images. A voiceover, when present, is
    // appended LAST so its input index is deterministic and the existing
    // [0:v]/mask/image indices are undisturbed.
    const voiceoverIndex = 2 + imagePaths.length // 0=video, 1=mask, 2..=images
    const audio = options.voiceover
      ? buildVoiceoverAudioArgs(voiceoverIndex, frames / fps)
      : buildAudioArgs(hasAudio)
    await mkdir(dirname(options.outPath), { recursive: true })
    await runProcess('ffmpeg', [
      '-y',
      '-i', renderInput,
      ...chrome.maskInputArgs,
      ...imageInputArgs(imagePaths, fps),
      ...(options.voiceover ? ['-i', options.voiceover] : []),
      '-filter_complex', filterComplex,
      '-map', '[v]',
      ...audio.mapArgs,
      '-frames:v', String(Math.max(1, frames)),
      ...audio.codecArgs,
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
  } finally {
    if (spotlightTempPath) await cleanupSpotlightPrePass(spotlightTempPath)
  }
}

/**
 * Renders the rounded-rect mask ONCE via a single ffmpeg pass (see
 * `frameChromeRenderPlan` in framing.ts) and returns the ffmpeg input args
 * needed to supply it to `framingFilter` as a looped raw-video input.
 * Cached on disk by a hash of the render params, so repeated calls at the
 * same geometry (the common case -- every polish run uses the same
 * 1920x1080 / 0.88 / 20px chrome) reuse the existing file instead of
 * re-rendering.
 *
 * This is the fix for the dominant render-time cost: the rounded-rect mask
 * is otherwise recomputed via a per-pixel `geq` expression on every output
 * frame, which profiling showed as ~87% of total render time. The mask is a
 * pure boolean (0 or 255) cutout, so rendering it once and reusing the
 * result is bit-identical to recomputing it every frame -- it just isn't
 * recomputed N times.
 *
 * The mask is cached as raw video (not PNG): PNG's encode/decode round-trip
 * lets ffmpeg's pixel-format auto-negotiation pick slightly different
 * intermediate formats than the live per-frame graph, which measurably
 * (~5dB) eroded pixel parity in testing. Raw video has no container
 * metadata to negotiate over, so the reloaded mask is bit-identical to the
 * one ffmpeg would have computed inline.
 */
async function renderFrameChromeAssets(
  inputIndexStart: number,
  outW: number,
  outH: number,
  fps: number,
): Promise<FrameChromePlan> {
  const plan = frameChromeRenderPlan({ outW, outH })
  const { contentW, contentH } = plan.layout
  const cacheKey = createHash('sha256')
    .update(JSON.stringify({ version: CHROME_CACHE_VERSION, outW, outH, layout: plan.layout }))
    .digest('hex')
    .slice(0, 32)
  const maskPath = join(CHROME_CACHE_DIR, `mask-${cacheKey}.gray`)

  if (!(await exists(maskPath))) {
    await mkdir(CHROME_CACHE_DIR, { recursive: true })
    await runProcess('ffmpeg', [
      '-y',
      '-filter_complex', plan.filterComplex,
      '-map', plan.maskLabel,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      maskPath,
    ])
  }

  return {
    maskInputArgs: [
      '-stream_loop', '-1',
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      '-s', `${contentW}x${contentH}`,
      '-framerate', String(fps),
      '-i', maskPath,
    ],
    chromeAssets: { maskIndex: inputIndexStart },
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}

async function buildClipCaptionOverlay(
  caption: string,
  durationMs: number,
  inputIndex: number,
  outW: number,
  outH: number,
  style: CaptionBannerStyle | CaptionBannerStyleName | undefined,
): Promise<CaptionOverlay | undefined> {
  return buildTimedCaptionOverlay(
    caption,
    { startMs: 0, endMs: Math.max(0, durationMs) },
    inputIndex,
    outW,
    outH,
    'framed',
    'v',
    style,
  )
}

async function buildCaptionOverlay(
  script: DemoScript,
  finalCaption: string,
  durationMs: number,
  inputIndex: number,
  outW: number,
  outH: number,
  style: CaptionBannerStyle | CaptionBannerStyleName | undefined,
): Promise<CaptionOverlay | undefined> {
  const window = finalCaptionWindow(script, finalCaption, durationMs)
  // No valid placement (e.g. the matched beat is truncated out of a short input):
  // skip the final caption rather than defaulting it to the whole clip, which would
  // overlap the per-beat step cards.
  if (!window) return undefined
  return buildTimedCaptionOverlay(finalCaption, window, inputIndex, outW, outH, 'framed', 'captioned', style)
}

async function buildTimedCaptionOverlay(
  text: string,
  window: { startMs: number; endMs: number },
  inputIndex: number,
  outW: number,
  outH: number,
  inputLabel: string,
  outputLabel: string,
  style: CaptionBannerStyle | CaptionBannerStyleName | undefined,
): Promise<CaptionOverlay | undefined> {
  const path = await renderCaptionPng({
    text,
    outW,
    outH,
    style,
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

export function finalCaptionWindow(script: DemoScript, finalCaption: string, durationMs: number): { startMs: number; endMs: number } | null {
  const validBeats = script.beats
    .filter((beat) =>
      Number.isFinite(beat.startMs)
      && Number.isFinite(beat.endMs)
      && beat.endMs > beat.startMs
    )
  const matchingBeat = [...validBeats].reverse().find((beat) => beat.stepText?.trim() === finalCaption)
  const beat = matchingBeat ?? validBeats.at(-1)
  // No beats at all: caption-only script — show it for the whole clip.
  if (!beat) return { startMs: 0, endMs: durationMs }
  // The placing beat starts after the clip ends (input shorter than the script):
  // the payoff was truncated away, so the final caption should not appear.
  if (beat.startMs >= durationMs) return null
  const window = {
    startMs: Math.max(0, Math.min(durationMs, beat.startMs)),
    endMs: Math.max(0, Math.min(durationMs, beat.endMs)),
  }
  // Window collapsed to zero length after clamping: don't fall back to full-clip
  // (that overlaps the step cards) — skip instead.
  return window.endMs > window.startMs ? window : null
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

/**
 * Probes whether the input has an audio stream. Used so polishClip/
 * polishScript can preserve audio when it exists instead of unconditionally
 * stripping it with `-an`.
 */
async function probeHasAudio(input: string): Promise<boolean> {
  const stdout = await runProcess('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=index',
    '-of', 'csv=p=0',
    input,
  ]).catch(() => '')
  return stdout.trim().length > 0
}

interface AudioArgs {
  /** Spliced in right after `-map [v]`. */
  mapArgs: string[]
  /** Spliced in right after `-frames:v`, alongside the video codec args. */
  codecArgs: string[]
}

/**
 * Builds the audio map + codec ffmpeg args. When the input has an audio
 * stream, it's preserved (re-encoded to AAC, since the rest of the pipeline
 * only ever re-encodes video). The audio is first padded with silence via
 * `-af apad` so it's never SHORTER than the `-frames:v`-limited video output
 * — without this, a source audio track shorter than the video would let
 * `-shortest` cut the video early too, truncating the final captioned
 * payoff. `-shortest` then trims the (now-padded) audio at the video's end,
 * so video duration always wins regardless of which track was originally
 * longer. When there's no audio, behavior is unchanged from before (`-an`).
 */
export function buildAudioArgs(hasAudio: boolean): AudioArgs {
  return hasAudio
    ? { mapArgs: ['-map', '0:a?'], codecArgs: ['-c:a', 'aac', '-af', 'apad', '-shortest'] }
    : { mapArgs: [], codecArgs: ['-an'] }
}

/**
 * Builds the audio map + codec ffmpeg args for a SEPARATE voiceover input
 * (mux a narration track instead of the source's own audio). The source's
 * audio is NOT mapped, so the voiceover fully REPLACES any input audio. The
 * voiceover maps from `${voiceoverInputIndex}:a`, starts at t=0, and is pinned
 * to exactly the video duration via `apad,atrim=end=<videoDurationSec>`:
 * `apad` pads with trailing silence so a VO SHORTER than the video never
 * truncates the video, and `atrim=end` cuts a VO LONGER than the video to the
 * video duration. This is done in the filter graph (deterministic) rather than
 * via `-shortest`, which does not reliably trim a frames-capped output on
 * short clips. `voiceoverInputIndex` is the 0-based ffmpeg `-i` index of the
 * voiceover input, which polishScript appends after the source/mask/overlay
 * inputs; `videoDurationSec` is the true output video duration (frames / fps).
 */
export function buildVoiceoverAudioArgs(voiceoverInputIndex: number, videoDurationSec: number): AudioArgs {
  const end = videoDurationSec.toFixed(6)
  return {
    mapArgs: ['-map', `${voiceoverInputIndex}:a`],
    codecArgs: ['-c:a', 'aac', '-af', `apad,atrim=end=${end}`],
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
