import { spawn } from 'node:child_process'
import { stat, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { requireFfmpeg } from '../media/ffmpeg.js'

export async function regularFile(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`Use an absolute local file: ${path}`)
  const real = await realpath(path)
  if (!(await stat(real)).isFile()) throw new Error(`Not a regular file: ${path}`)
  return real
}
export async function runProcess(command: string, args: string[], signal?: AbortSignal, timeout = 0, onStdout?: (chunk: Buffer) => void): Promise<string> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], signal, timeout, killSignal: 'SIGKILL' })
    let output = '', errors = ''
    child.stdout.on('data', b => { onStdout?.(b); output = (output + b).slice(-1_000_000) })
    child.stderr.on('data', b => { errors = (errors + b).slice(-16_000) })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code}): ${errors}`)))
  })
}
export function ffmpeg(args: string[], signal?: AbortSignal) {
  return runProcess(requireFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], signal)
}
export async function probe(path: string, signal?: AbortSignal): Promise<{ duration: number; videoDuration: number; width: number; height: number; audio: boolean }> {
  const raw = await runProcess('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', path], signal)
  const result = JSON.parse(raw) as { streams: Array<{ codec_type: string; width?: number; height?: number; duration?: string }>; format: { duration?: string } }
  const video = result.streams.find(s => s.codec_type === 'video')
  const duration = Number(result.format.duration ?? video?.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Cannot measure media duration: ${path}`)
  return { duration, videoDuration: Number(video?.duration ?? duration), width: video?.width ?? 0, height: video?.height ?? 0, audio: result.streams.some(s => s.codec_type === 'audio') }
}
