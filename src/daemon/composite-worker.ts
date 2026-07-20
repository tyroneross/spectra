import { spawn, spawnSync } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  BlackFrameGuard,
  JsonValue,
  RecordCompositeParams,
  RecordCompositeCompletedResult,
} from '../contract/core-api.js'
import { crashSafeMp4Args, detectFfmpeg } from '../media/ffmpeg.js'
import {
  ensureCompositeBinary,
  ensureScreenRecordingPreflightBinary,
} from '../native/compiler.js'

export const COMPOSITE_WORKER_DEFAULTS = {
  durationSeconds: 5,
  fps: 60,
  spotlight: 'none',
  cursor: true,
  maxWidth: 1600,
  crf: 20,
  blackThreshold: 40,
} as const

export interface ScreenRecordingPreflightFailure {
  code: string
  message: string
  hint?: string
  details?: JsonValue
  retryable?: boolean
}

export interface CompositeRecoveryManifest {
  schema: 'spectra.composite-recovery.v1'
  status: string
  output: string
  left: string
  right: string
  fps: number
  durationSeconds: number
  paneHeight: number
  pixFmt: string
  maxWidth: number
  crf: number
  updatedAt: string
}

export function buildCompositeRecoveryArgs(
  manifest: CompositeRecoveryManifest,
  outPath = manifest.output,
): string[] {
  const fps = Math.max(1, Math.round(manifest.fps))
  const paneHeight = Math.max(2, Math.round(manifest.paneHeight / 2) * 2)
  const maxWidth = Math.max(2, Math.round(manifest.maxWidth))
  const filter = [
    `[0:v]scale=-2:${paneHeight}:flags=lanczos,setsar=1[left]`,
    `[1:v]scale=-2:${paneHeight}:flags=lanczos,setsar=1[right]`,
    `[left][right]hstack=inputs=2:shortest=1,scale=w='min(${maxWidth}\\,iw)':h=-2:flags=lanczos,setsar=1[v]`,
  ].join(';')

  return [
    '-y',
    '-i', manifest.left,
    '-i', manifest.right,
    '-filter_complex', filter,
    '-map', '[v]',
    '-an',
    '-r', String(fps),
    '-vsync', 'cfr',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(manifest.crf),
    '-g', String(fps),
    '-keyint_min', String(fps),
    '-sc_threshold', '0',
    '-pix_fmt', manifest.pixFmt,
    '-video_track_timescale', String(Math.max(600, fps * 1000)),
    ...crashSafeMp4Args(),
    outPath,
  ]
}

export function compositeRecoveryDirectoryPrefix(outPath: string): string {
  return join(dirname(outPath), `${basename(outPath)}.spectra-recovery-`)
}

async function findLatestCompositeRecoveryDirectory(
  outPath: string,
  workerStartedAtMs?: number,
): Promise<string | undefined> {
  const parent = dirname(outPath)
  const prefix = `${basename(outPath)}.spectra-recovery-`
  try {
    const entries = await readdir(parent, { withFileTypes: true })
    const candidates = await Promise.all(entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
      .map(async entry => {
        const path = join(parent, entry.name)
        return { path, mtimeMs: (await stat(path)).mtimeMs }
      }))
    return candidates
      .filter(candidate => workerStartedAtMs === undefined || candidate.mtimeMs >= workerStartedAtMs - 2_000)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path
  } catch {
    return undefined
  }
}

export async function recoverCompositeOutput(
  recoveryDirectory: string,
  outPath: string,
): Promise<CompositeRecoveryManifest> {
  const ffmpeg = detectFfmpeg()
  if (!ffmpeg) throw new Error('ffmpeg is unavailable for composite recovery')

  const manifest = await readCompositeRecoveryManifest(recoveryDirectory)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, buildCompositeRecoveryArgs(manifest, outPath), { stdio: 'pipe' })
    const stderrChunks: Buffer[] = []
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)))
    child.on('error', reject)
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve()
        return
      }
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      reject(new Error(`composite recovery ffmpeg exited with code ${exitCode}${stderr ? `\n${stderr}` : ''}`))
    })
  })
  await stat(outPath)
  return manifest
}

async function readCompositeRecoveryManifest(
  recoveryDirectory: string,
): Promise<CompositeRecoveryManifest> {
  const manifestPath = join(recoveryDirectory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as CompositeRecoveryManifest
  if (manifest.schema !== 'spectra.composite-recovery.v1') {
    throw new Error(`unsupported composite recovery manifest: ${manifestPath}`)
  }
  return manifest
}

function recoveredCompositeResult(
  outPath: string,
  command: string,
  recoveryDirectory: string,
  manifest: CompositeRecoveryManifest,
  reason: string,
): RecordCompositeCompletedResult {
  const guard = probeBlackFrames(outPath)
  const warnings = [
    reason,
    'Crash recovery preserves the recorded panes but may omit cursor and annotation overlays generated after capture.',
  ]
  if (guard.allBlack) {
    warnings.push(
      `Recovered output appears all-black (mean luminance ${guard.meanLuma?.toFixed(1)} < `
      + `${COMPOSITE_WORKER_DEFAULTS.blackThreshold} across ${guard.sampleCount} sampled frames).`,
    )
  } else if (guard.skipped) {
    warnings.push('Black-frame guard skipped; ffmpeg was unavailable or no luminance samples were produced.')
  }
  return {
    ok: true,
    output: outPath,
    command,
    details: {
      recoveryDirectory,
      recoveredFromFragments: true,
      recoveryManifestStatus: manifest.status,
    },
    blackFrameGuard: guard,
    warnings,
  }
}

export function buildCompositeWorkerArgs(params: RecordCompositeParams): string[] {
  if (!params.appA) throw new Error('recordComposite requires appA')
  if (!params.appB) throw new Error('recordComposite requires appB')
  if (!params.outPath) throw new Error('recordComposite requires outPath')

  const args = ['--app-a', params.appA, '--app-b', params.appB, '--out', params.outPath]

  if (params.titleA) args.push('--title-a', params.titleA)
  if (params.labelA) args.push('--label-a', params.labelA)
  if (params.titleB) args.push('--title-b', params.titleB)
  if (params.labelB) args.push('--label-b', params.labelB)
  if (params.caption) args.push('--caption', params.caption)

  args.push('--duration', String(params.durationSeconds ?? COMPOSITE_WORKER_DEFAULTS.durationSeconds))
  args.push('--fps', String(params.fps ?? COMPOSITE_WORKER_DEFAULTS.fps))
  args.push('--spotlight', params.spotlight ?? COMPOSITE_WORKER_DEFAULTS.spotlight)
  args.push(params.cursor === false ? '--no-cursor' : '--cursor')
  args.push('--max-width', String(params.maxWidth ?? COMPOSITE_WORKER_DEFAULTS.maxWidth))
  args.push('--crf', String(params.crf ?? COMPOSITE_WORKER_DEFAULTS.crf))

  return args
}

export function parseLuminance(output: string, blackThreshold = COMPOSITE_WORKER_DEFAULTS.blackThreshold): BlackFrameGuard {
  const values: number[] = []
  const pattern = /lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(output)) !== null) {
    const value = Number.parseFloat(match[1])
    if (Number.isFinite(value)) values.push(value)
  }

  if (values.length === 0) {
    return { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true }
  }

  const meanLuma = values.reduce((sum, value) => sum + value, 0) / values.length
  return {
    sampleCount: values.length,
    meanLuma,
    allBlack: meanLuma < blackThreshold,
    skipped: false,
  }
}

function probeBlackFrames(outPath: string): BlackFrameGuard {
  const ffmpeg = detectFfmpeg()
  if (!ffmpeg) return { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true }

  try {
    const result = spawnSync(
      ffmpeg,
      [
        '-nostats',
        '-i', outPath,
        '-vf', 'fps=2,signalstats,metadata=print:file=-',
        '-an',
        '-f', 'null',
        '-',
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
    return parseLuminance(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  } catch {
    return { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true }
  }
}

function parseWorkerStdout(stdout: string): {
  output?: string
  validation?: JsonValue
  details?: JsonValue
} {
  const trimmed = stdout.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed) as Record<string, JsonValue>
    return {
      output: typeof parsed.output === 'string' ? parsed.output : undefined,
      validation: parsed.validation,
      details: parsed,
    }
  } catch {
    return {}
  }
}

export function parseScreenRecordingPreflightOutput(output: string): ScreenRecordingPreflightFailure | undefined {
  const trimmed = output.trim()
  if (!trimmed) return undefined

  const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]) as Record<string, JsonValue>
      const error = parsed.error
      if (!error || typeof error !== 'object' || Array.isArray(error)) continue
      const body = error as Record<string, JsonValue>
      const code = typeof body.code === 'string' ? body.code : undefined
      const message = typeof body.message === 'string' ? body.message : undefined
      if (!code || !message) continue
      return {
        code,
        message,
        hint: typeof body.hint === 'string' ? body.hint : undefined,
        details: body.details,
        retryable: typeof body.retryable === 'boolean' ? body.retryable : undefined,
      }
    } catch {
      // Keep scanning earlier lines; Swift or macOS may have emitted diagnostics.
    }
  }
  return undefined
}

function runScreenRecordingPreflight(): ScreenRecordingPreflightFailure | undefined {
  const binary = ensureScreenRecordingPreflightBinary()
  const result = spawnSync(binary, [], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })
  if (result.status === 0) return undefined

  const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  return parseScreenRecordingPreflightOutput(combinedOutput) ?? {
    code: 'permission_denied',
    message: 'Screen Recording not granted to Spectra.',
    hint: 'Enable Screen Recording for the signed Spectra daemon helper in System Settings > Privacy & Security > Screen Recording, then retry.',
    details: {
      preflightCommand: binary,
      exitCode: result.status,
      stderr: result.stderr ?? '',
    },
    retryable: false,
  }
}

export async function recordCompositeWithWorker(
  params: RecordCompositeParams,
): Promise<RecordCompositeCompletedResult> {
  const args = buildCompositeWorkerArgs(params)
  const pendingRecovery = await findLatestCompositeRecoveryDirectory(params.outPath)
  if (pendingRecovery) {
    try {
      const pendingManifest = await readCompositeRecoveryManifest(pendingRecovery)
      if (pendingManifest.status !== 'complete') {
        const recoveryCommand = `recover-composite ${join(pendingRecovery, 'manifest.json')}`
        const manifest = await recoverCompositeOutput(pendingRecovery, params.outPath)
        return recoveredCompositeResult(
          params.outPath,
          recoveryCommand,
          pendingRecovery,
          manifest,
          `Spectra recovered an interrupted composite from ${pendingRecovery} before starting a new capture.`,
        )
      }
    } catch (error) {
      return {
        ok: false,
        command: `recover-composite ${join(pendingRecovery, 'manifest.json')}`,
        details: { recoveryDirectory: pendingRecovery },
        blackFrameGuard: { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true },
        warnings: [`Recoverable fragmented pane recordings remain at ${pendingRecovery}.`],
        error: `Pending composite recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  const workerStartedAtMs = Date.now()
  const binary = ensureCompositeBinary()
  const commandLine = [binary, ...args].join(' ')
  const preflightFailure = runScreenRecordingPreflight()

  if (preflightFailure) {
    return {
      ok: false,
      command: commandLine,
      blackFrameGuard: { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true },
      warnings: [],
      error: preflightFailure.message,
      errorCode: preflightFailure.code,
      hint: preflightFailure.hint,
      details: preflightFailure.details,
      retryable: preflightFailure.retryable,
    }
  }

  let { stdout, stderr, code } = await new Promise<{
    stdout: string
    stderr: string
    code: number | null
  }>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: 'pipe' })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)))
    child.on('error', reject)
    child.on('close', (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        code: exitCode,
      })
    })
  })

  if (code !== 0) {
    const exitDescription = code === null ? 'after receiving a signal' : `with code ${code}`
    const recoveryDirectory = await findLatestCompositeRecoveryDirectory(params.outPath, workerStartedAtMs)
    if (recoveryDirectory) {
      try {
        const manifest = await recoverCompositeOutput(recoveryDirectory, params.outPath)
        return recoveredCompositeResult(
          params.outPath,
          commandLine,
          recoveryDirectory,
          manifest,
          `The capture worker exited ${exitDescription}; Spectra rebuilt the composite from fragmented pane recordings at ${recoveryDirectory}.`,
        )
      } catch (recoveryError) {
        stderr += `\nComposite recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`
      }
    }
    return {
      ok: false,
      command: commandLine,
      blackFrameGuard: { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true },
      warnings: recoveryDirectory
        ? [`Recoverable fragmented pane recordings remain at ${recoveryDirectory}.`]
        : [],
      details: recoveryDirectory ? { recoveryDirectory } : undefined,
      error: `spectra-composite-capture exited ${exitDescription}`
        + `${stderr.trim() ? `\n${stderr.trim()}` : ''}`
        + `${recoveryDirectory ? `\nRecovery directory: ${recoveryDirectory}` : ''}`,
    }
  }

  const parsed = parseWorkerStdout(stdout)
  const output = parsed.output ?? params.outPath
  const warnings: string[] = []

  try {
    await stat(output)
  } catch {
    return {
      ok: false,
      output,
      command: commandLine,
      validation: parsed.validation,
      details: parsed.details,
      blackFrameGuard: { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true },
      warnings,
      error: `Composite worker completed but output was not written: ${output}`,
    }
  }

  const guard = probeBlackFrames(output)
  if (guard.allBlack) {
    warnings.push(
      `Output appears all-black (mean luminance ${guard.meanLuma?.toFixed(1)} < `
      + `${COMPOSITE_WORKER_DEFAULTS.blackThreshold} across ${guard.sampleCount} sampled frames).`,
    )
  } else if (guard.skipped) {
    warnings.push('Black-frame guard skipped; ffmpeg was unavailable or no luminance samples were produced.')
  }

  return {
    ok: true,
    output,
    command: commandLine,
    validation: parsed.validation,
    details: parsed.details,
    blackFrameGuard: guard,
    warnings,
  }
}
