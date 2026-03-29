import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { getStoragePath } from '../core/storage.js'

export interface RecordOptions {
  command: string
  args?: string[]
  shell?: boolean         // Default true
  cwd?: string
  env?: Record<string, string>
  cols?: number           // Default 120
  rows?: number           // Default 40
  maxDuration?: number    // Kill after N ms (default 300000 = 5min)
  outputPath?: string     // Where to write .cast file
}

export interface RecordResult {
  castFile: string
  exitCode: number
  duration: number
  outputSize: number
  lines: number
}

function getDefaultOutputPath(cwd?: string): string {
  const timestamp = Date.now()
  return join(getStoragePath(cwd), 'recordings', `${timestamp}.cast`)
}

export async function recordTerminal(options: RecordOptions): Promise<RecordResult> {
  const {
    command,
    args = [],
    shell = true,
    cwd,
    env,
    cols = 120,
    rows = 40,
    maxDuration = 300_000,
    outputPath,
  } = options

  const castFile = outputPath ?? getDefaultOutputPath(cwd)

  // Ensure output directory exists
  mkdirSync(dirname(castFile), { recursive: true })

  const stream = createWriteStream(castFile, { encoding: 'utf8' })

  // Write asciicast v2 header
  const header = {
    version: 2,
    width: cols,
    height: rows,
    timestamp: Math.floor(Date.now() / 1000),
    env: {
      SHELL: process.env.SHELL ?? '/bin/sh',
      TERM: process.env.TERM ?? 'xterm-256color',
    },
  }
  stream.write(JSON.stringify(header) + '\n')

  const startTime = performance.now()
  let outputSize = 0
  let lines = 0

  function elapsed(): number {
    return (performance.now() - startTime) / 1000
  }

  function writeEvent(type: 'o' | 'i', data: string): void {
    const event = JSON.stringify([elapsed(), type, data])
    stream.write(event + '\n')
    outputSize += data.length
    lines++
  }

  return new Promise<RecordResult>((resolve, reject) => {
    const spawnArgs = shell ? [] : args
    const spawnCommand = shell ? command + (args.length ? ' ' + args.join(' ') : '') : command

    const child = spawn(spawnCommand, spawnArgs, {
      shell,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, ...env, COLUMNS: String(cols), LINES: String(rows) },
    })

    const killTimer = setTimeout(() => {
      console.warn(`[recorder] max duration ${maxDuration}ms reached — killing process`)
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2000)
    }, maxDuration)

    child.stdout?.on('data', (chunk: Buffer) => {
      writeEvent('o', chunk.toString())
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      writeEvent('o', chunk.toString())
    })

    child.on('error', (err) => {
      clearTimeout(killTimer)
      stream.end(() => reject(err))
    })

    child.on('close', (code) => {
      clearTimeout(killTimer)
      const duration = (performance.now() - startTime) / 1000

      stream.end(() => {
        resolve({
          castFile,
          exitCode: code ?? 0,
          duration,
          outputSize,
          lines,
        })
      })
    })
  })
}
