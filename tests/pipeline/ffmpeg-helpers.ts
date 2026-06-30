import { spawn, spawnSync } from 'node:child_process'

export const ffmpegAvailable = commandExists('ffmpeg') && commandExists('ffprobe')

export interface ProbeResult {
  width: number
  height: number
  fps?: number
}

export async function runProcess(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'pipe' })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(Buffer.from(chunk)))
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)))
    proc.on('error', reject)
    proc.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
      if (code === 0) {
        resolve(stdout)
        return
      }
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()
      reject(new Error(`${cmd} exited with code ${code}${stderr ? `\n${stderr}` : ''}`))
    })
  })
}

export async function makeTestVideo(path: string, width = 64, height = 36, durationSeconds = 0.25): Promise<void> {
  await runProcess('ffmpeg', [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `testsrc2=size=${width}x${height}:rate=60:duration=${durationSeconds}`,
    '-an',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-y',
    path,
  ])
}

export async function probeVideo(path: string): Promise<ProbeResult> {
  const raw = await runProcess('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate',
    '-of', 'json',
    path,
  ])
  const data = JSON.parse(raw) as {
    streams?: Array<{
      width?: number
      height?: number
      avg_frame_rate?: string
    }>
  }
  const stream = data.streams?.[0]
  if (!stream?.width || !stream.height) {
    throw new Error(`Could not probe ${path}`)
  }
  return {
    width: stream.width,
    height: stream.height,
    fps: parseFps(stream.avg_frame_rate),
  }
}

function commandExists(cmd: string): boolean {
  return spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0
}

function parseFps(value: string | undefined): number | undefined {
  if (!value || value === '0/0') return undefined
  const [rawNumerator, rawDenominator] = value.split('/')
  const numerator = Number(rawNumerator)
  const denominator = rawDenominator === undefined ? 1 : Number(rawDenominator)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined
  return Math.round((numerator / denominator) * 100) / 100
}
