// src/media/frame-secret-scan.ts
//
// Pre-publish privacy/secret scanner for recorded frames. Samples frames from
// a video (or treats a still image as a single frame), OCRs each frame, and
// matches the recognized text against a library of credential/PII patterns.
//
// This is a GATE, not a proof of absence: OCR misses low-contrast or small
// text, and the pattern library only covers known secret shapes. Treat a
// "clean" verdict as "nothing obvious found," not "guaranteed safe."
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { execSync, spawn } from 'node:child_process'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { detectFfmpeg } from './ffmpeg.js'

// ─── OCR engine seam ──────────────────────────────────────────

export interface OcrEngine {
  name: string
  available(): Promise<boolean>
  recognize(pngPath: string): Promise<string>
}

/**
 * Shells out to the `tesseract` CLI. `--psm 6` (assume a single uniform block
 * of text) is the best default for terminal/browser chrome screenshots.
 */
export class TesseractOcrEngine implements OcrEngine {
  readonly name = 'tesseract'
  private binaryPath: string | null | undefined = undefined

  private resolveBinary(): string | null {
    if (this.binaryPath !== undefined) return this.binaryPath
    try {
      const found = execSync('which tesseract', { stdio: 'pipe' }).toString().trim()
      this.binaryPath = found.length > 0 ? found : null
    } catch {
      this.binaryPath = null
    }
    if (!this.binaryPath && existsSync('/opt/homebrew/bin/tesseract')) {
      this.binaryPath = '/opt/homebrew/bin/tesseract'
    }
    return this.binaryPath
  }

  async available(): Promise<boolean> {
    try {
      return this.resolveBinary() !== null
    } catch {
      // available() must never throw — an unresolvable binary is "not available."
      return false
    }
  }

  async recognize(pngPath: string): Promise<string> {
    const bin = this.resolveBinary()
    if (!bin) throw new Error('tesseract binary not found on PATH')
    return new Promise((resolvePromise, reject) => {
      const proc = spawn(bin, [pngPath, 'stdout', '--psm', '6'], { stdio: 'pipe' })
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
      proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
      proc.on('close', (code) => {
        if (code === 0) resolvePromise(Buffer.concat(stdoutChunks).toString('utf-8'))
        else {
          const stderr = Buffer.concat(stderrChunks).toString().trim()
          reject(new Error(`tesseract exited with code ${code}${stderr ? '\n' + stderr : ''}`))
        }
      })
      proc.on('error', reject)
    })
  }
}

// ─── Secret patterns ──────────────────────────────────────────

export type SecretSeverity = 'high' | 'medium' | 'low'

export interface SecretPattern {
  id: string
  severity: SecretSeverity
  regex: RegExp
  description: string
}

export const DEFAULT_SECRET_PATTERNS: SecretPattern[] = [
  {
    id: 'anthropic-api-key',
    severity: 'high',
    regex: /sk-ant-[A-Za-z0-9_-]{20,}/,
    description: 'Anthropic API key',
  },
  {
    id: 'openai-api-key',
    severity: 'high',
    regex: /sk-[A-Za-z0-9]{20,}/,
    description: 'OpenAI-style API key',
  },
  {
    id: 'aws-access-key',
    severity: 'high',
    regex: /AKIA[0-9A-Z]{16}/,
    description: 'AWS access key ID',
  },
  {
    id: 'github-token',
    severity: 'high',
    regex: /gh[pousr]_[A-Za-z0-9]{20,}/,
    description: 'GitHub personal/app token',
  },
  {
    id: 'github-pat',
    severity: 'high',
    regex: /github_pat_[A-Za-z0-9_]{20,}/,
    description: 'GitHub fine-grained personal access token',
  },
  {
    id: 'slack-token',
    severity: 'high',
    regex: /xox[abpr]-[A-Za-z0-9-]{10,}/,
    description: 'Slack API token',
  },
  {
    id: 'google-api-key',
    severity: 'high',
    regex: /AIza[0-9A-Za-z_-]{30,}/,
    description: 'Google API key',
  },
  {
    id: 'jwt',
    severity: 'high',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    description: 'JSON Web Token',
  },
  {
    id: 'pem-private-key',
    severity: 'high',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    description: 'PEM private key header',
  },
  {
    id: 'bearer-token',
    severity: 'high',
    regex: /Bearer\s+[A-Za-z0-9._-]{20,}/,
    description: 'Bearer authorization header',
  },
  {
    id: 'generic-secret-assignment',
    severity: 'medium',
    regex: /(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
    description: 'Generic secret-shaped assignment',
  },
  {
    id: 'email-address',
    severity: 'low',
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    description: 'Email address',
  },
  {
    id: 'home-path-unix',
    severity: 'low',
    regex: /\/Users\/[A-Za-z0-9._-]+/,
    description: 'macOS absolute home directory path',
  },
  {
    id: 'home-path-linux',
    severity: 'low',
    regex: /\/home\/[A-Za-z0-9._-]+/,
    description: 'Linux absolute home directory path',
  },
  {
    id: 'home-path-noslash',
    severity: 'low',
    // OCR frequently drops the leading '/' at the start of a line or word
    // boundary, turning "/Users/tyrone/..." into "Users/tyrone/...". Catch
    // that mangled form too — it's the same privacy leak, just missing a
    // character OCR is prone to dropping.
    regex: /(?:^|[^A-Za-z0-9/])(?:Users|home)\/[A-Za-z0-9._-]{2,}\//,
    description: 'Home directory path with OCR-dropped leading slash',
  },
]

const PATH_PATTERN_IDS = new Set(['home-path-unix', 'home-path-linux', 'home-path-noslash'])

// ─── Text scanning (pure, unit-testable) ─────────────────────

export interface TextFinding {
  patternId: string
  severity: SecretSeverity
  description: string
  /** First 4 chars + '…' + last 2 chars of the match. The full match is never retained. */
  redacted: string
  /** Character offset of the match within the scanned text. */
  index: number
  /** Length of the match, in characters — not enough on its own to reconstruct the secret. */
  length: number
  /** Set when this finding was only found after the OCR-confusion normalization pass. */
  viaOcrConfusionPass?: boolean
}

/** First 4 + '…' + last 2. Never write the full match anywhere. */
function redact(match: string): string {
  const head = match.slice(0, 4)
  const tail = match.length > 4 ? match.slice(-2) : match.slice(-1)
  return `${head}…${tail}`
}

/**
 * Path findings get a stricter redaction than the generic first-4/last-2
 * scheme: keep only the first path segment (e.g. `/Users` or `Users` for the
 * slash-dropped form) plus '…'. The generic scheme would still leak most of
 * the username via its trailing 2 characters; a home path's sensitive part
 * IS the username, so drop it entirely.
 */
function redactPath(match: string): string {
  const trimmed = match.replace(/^[^A-Za-z0-9/]+/, '')
  const firstSegment = trimmed.match(/^\/?[A-Za-z]+/)?.[0] ?? trimmed.slice(0, 5)
  return `${firstSegment}…`
}

/** Returns a fresh global-flagged RegExp so callers never share `lastIndex` state. */
function toGlobalRegex(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
  return new RegExp(pattern.source, flags)
}

export function scanText(
  text: string,
  opts: { patterns?: SecretPattern[]; allow?: RegExp[] } = {},
): TextFinding[] {
  const patterns = opts.patterns ?? DEFAULT_SECRET_PATTERNS
  const allow = opts.allow ?? []
  const findings: TextFinding[] = []
  for (const pattern of patterns) {
    const re = toGlobalRegex(pattern.regex)
    for (const m of text.matchAll(re)) {
      const matched = m[0]
      if (allow.some((a) => a.test(matched))) continue
      findings.push({
        patternId: pattern.id,
        severity: pattern.severity,
        description: pattern.description,
        redacted: PATH_PATTERN_IDS.has(pattern.id) ? redactPath(matched) : redact(matched),
        index: m.index ?? -1,
        length: matched.length,
      })
    }
  }
  return findings
}

// ─── OCR-confusion normalization ──────────────────────────────
//
// OCR frequently confuses visually similar glyphs (capital O vs digit 0,
// lowercase l vs digit 1, capital I vs digit 1). Collapsing whitespace and
// then re-running the scan with those glyphs canonicalized raises recall on
// secrets OCR mangled — at the cost of false positives elsewhere in the text
// (ordinary words containing O/l/I get corrupted too). For a pre-publish
// gate, a false positive costs a human a second look; a false negative ships
// a real secret. Trade recall for precision here.

const OCR_CONFUSION_MAP: Record<string, string> = { O: '0', l: '1', I: '1' }

export function normalizeOcrText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function applyOcrConfusionMap(text: string): string {
  return text.replace(/[OlI]/g, (ch) => OCR_CONFUSION_MAP[ch] ?? ch)
}

/**
 * Runs `scanText` twice — once on the whitespace-normalized OCR text, once on
 * the OCR-confusion-mapped variant — and merges the results. Because the
 * confusion map is a 1:1 character substitution, offsets line up between the
 * two passes, so a hit found in both passes is de-duplicated by
 * (patternId, index); a hit found only after confusion-mapping is kept and
 * flagged `viaOcrConfusionPass`.
 */
export function scanOcrText(
  rawOcrText: string,
  opts: { patterns?: SecretPattern[]; allow?: RegExp[] } = {},
): TextFinding[] {
  const normalized = normalizeOcrText(rawOcrText)
  const primary = scanText(normalized, opts)
  const seen = new Set(primary.map((f) => `${f.patternId}:${f.index}`))

  const confused = normalizeOcrText(applyOcrConfusionMap(normalized))
  const secondary = scanText(confused, opts)
    .filter((f) => !seen.has(`${f.patternId}:${f.index}`))
    .map((f) => ({ ...f, viaOcrConfusionPass: true }))

  return [...primary, ...secondary]
}

// ─── Frame sampling ───────────────────────────────────────────

export interface SampledFrame {
  path: string
  index: number
  tMs: number
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])

function isImageFile(input: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(input).toLowerCase())
}

export class FrameScanInputError extends Error {
  readonly code = 'INPUT_NOT_FOUND'
}

export class FfmpegUnavailableError extends Error {
  readonly code = 'FFMPEG_UNAVAILABLE'
}

async function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: 'pipe' })
    const stderrChunks: Buffer[] = []
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    proc.on('close', (code) => {
      if (code === 0) resolvePromise()
      else {
        const stderr = Buffer.concat(stderrChunks).toString().trim()
        reject(new Error(`ffmpeg exited with code ${code}${stderr ? '\n' + stderr : ''}`))
      }
    })
    proc.on('error', reject)
  })
}

/**
 * Samples frames from a video at `fps`, scaled to 1920px wide (height auto,
 * even-rounded). If `input` is a still image, returns it as a single frame
 * at tMs=0 without invoking ffmpeg.
 */
export async function sampleFrames(
  input: string,
  opts: { fps?: number; outDir: string; maxFrames?: number },
): Promise<SampledFrame[]> {
  const fps = opts.fps ?? 1

  if (isImageFile(input)) {
    return [{ path: input, index: 0, tMs: 0 }]
  }

  const ffmpegPath = detectFfmpeg()
  if (!ffmpegPath) {
    throw new FfmpegUnavailableError('ffmpeg not found on PATH; required to sample video frames')
  }

  await mkdir(opts.outDir, { recursive: true })
  const pattern = join(opts.outDir, 'frame-%04d.png')
  const args = [
    '-y',
    '-i', input,
    '-vf', `fps=${fps},scale=1920:-2`,
    ...(opts.maxFrames ? ['-frames:v', String(opts.maxFrames)] : []),
    pattern,
  ]
  await runFfmpeg(ffmpegPath, args)

  const files = (await readdir(opts.outDir))
    .filter((f) => f.startsWith('frame-') && f.endsWith('.png'))
    .sort()
  return files.map((f, index) => ({
    path: join(opts.outDir, f),
    index,
    tMs: Math.round((index / fps) * 1000),
  }))
}

// ─── Full frame scan ──────────────────────────────────────────

export interface FrameFinding extends TextFinding {
  frameIndex: number
  tMs: number
  framePath: string
}

export type FrameScanVerdict = 'clean' | 'review' | 'blocked'

export interface FrameScanReport {
  input: string
  sampledAt: string
  engine: string
  fps: number
  frameCount: number
  findings: FrameFinding[]
  verdict: FrameScanVerdict
  unscannedReason?: string
}

function computeVerdict(findings: FrameFinding[]): FrameScanVerdict {
  if (findings.some((f) => f.severity === 'high')) return 'blocked'
  if (findings.some((f) => f.severity === 'medium' || f.severity === 'low')) return 'review'
  return 'clean'
}

export async function scanFrames(
  input: string,
  opts: {
    fps?: number
    engine?: OcrEngine
    patterns?: SecretPattern[]
    allow?: RegExp[]
    workDir?: string
  } = {},
): Promise<FrameScanReport> {
  const fps = opts.fps ?? 1
  const sampledAt = new Date().toISOString()

  try {
    await stat(input)
  } catch {
    throw new FrameScanInputError(`input not found: ${input}`)
  }

  const engine = opts.engine ?? new TesseractOcrEngine()
  const workDir = opts.workDir ?? join(process.cwd(), '.spectra', 'tmp', 'frame-secret-scan')

  const isAvailable = await engine.available()
  if (!isAvailable) {
    return {
      input,
      sampledAt,
      engine: engine.name,
      fps,
      frameCount: 0,
      findings: [],
      verdict: 'review',
      unscannedReason: `${engine.name} not available on PATH`,
    }
  }

  const frames = await sampleFrames(input, { fps, outDir: workDir })
  const findings: FrameFinding[] = []

  for (const frame of frames) {
    const text = await engine.recognize(frame.path)
    const hits = scanOcrText(text, { patterns: opts.patterns, allow: opts.allow })
    for (const hit of hits) {
      findings.push({ ...hit, frameIndex: frame.index, tMs: frame.tMs, framePath: frame.path })
    }
  }

  return {
    input,
    sampledAt,
    engine: engine.name,
    fps,
    frameCount: frames.length,
    findings,
    verdict: computeVerdict(findings),
  }
}
