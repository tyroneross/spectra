// src/launcher/web.ts
//
// Spawn a Next.js / Vite dev server in the given repo. Parse stdout for the
// "Local: http://localhost:NNNN" line to discover the actual bound port.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import { spawn, type ChildProcess } from 'node:child_process'
import { LauncherError, type DetectionResult, type LaunchHandle } from './types.js'

const URL_PATTERN = /https?:\/\/localhost:(\d+)/i
const READY_TIMEOUT_MS = 30_000

export interface WebLaunchOptions {
  repoPath: string
  detection: DetectionResult
  /** Override for tests — defaults to real spawn. */
  spawnFn?: typeof spawn
  /** Override timeout for tests. */
  timeoutMs?: number
}

export async function launchWebDevServer(opts: WebLaunchOptions): Promise<LaunchHandle> {
  if (!opts.detection.startCommand || opts.detection.startCommand.length === 0) {
    throw new LauncherError(
      `No startCommand for kind ${opts.detection.kind}`,
      'Detection should have populated startCommand.'
    )
  }
  const [cmd, ...args] = opts.detection.startCommand
  const spawnImpl = opts.spawnFn ?? spawn
  const timeoutMs = opts.timeoutMs ?? READY_TIMEOUT_MS

  const proc: ChildProcess = spawnImpl(cmd, args, {
    cwd: opts.repoPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },   // suppress auto-open
  })

  const url = await new Promise<string>((resolve, reject) => {
    let resolved = false
    const buffers: string[] = []

    const onChunk = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      buffers.push(text)
      const match = text.match(URL_PATTERN) ?? buffers.join('').match(URL_PATTERN)
      if (match && !resolved) {
        resolved = true
        clearTimeout(timer)
        resolve(match[0])
      }
    }

    proc.stdout?.on('data', onChunk)
    proc.stderr?.on('data', onChunk)
    proc.on('error', (err) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      reject(new LauncherError(
        `Failed to spawn dev server: ${err.message}`,
        'Check that the package manager (npm/npx) is installed.'
      ))
    })
    proc.on('exit', (code, signal) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      reject(new LauncherError(
        `Dev server exited before binding a URL (code=${code} signal=${signal})`,
        `Recent output: ${buffers.join('').slice(-500)}`
      ))
    })

    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      try { proc.kill() } catch { /* best-effort */ }
      reject(new LauncherError(
        `Dev server did not print a URL within ${timeoutMs}ms`,
        `Recent output: ${buffers.join('').slice(-500)}`
      ))
    }, timeoutMs)
  })

  return {
    kind: opts.detection.kind,
    pid: proc.pid,
    url,
    killOnDisconnect: true,
    kill: async () => {
      if (!proc.killed) {
        proc.kill()
        await new Promise<void>((resolve) => {
          if (proc.exitCode !== null) return resolve()
          proc.once('exit', () => resolve())
          // hard-kill safety net
          setTimeout(() => {
            try { proc.kill('SIGKILL') } catch { /* best-effort */ }
            resolve()
          }, 2000)
        })
      }
    },
  }
}
