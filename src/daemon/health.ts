import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HealthResult, PermissionStatus } from '../contract/core-api.js'
import { API_VERSION } from '../contract/wire.js'

const execFileAsync = promisify(execFile)

export interface HealthProbeOptions {
  startedAt?: number
  daemonVersion?: string
  now?: () => number
  aquaSessionProbe?: () => Promise<boolean>
  windowServerProbe?: (aquaSession: boolean) => Promise<{ connected: boolean; error?: string }>
  permissionsProvider?: () => Promise<PermissionStatus[]>
}

export async function health(
  params: { includePermissions?: boolean } = {},
  options: HealthProbeOptions = {},
): Promise<HealthResult> {
  const now = options.now?.() ?? Date.now()
  const startedAt = options.startedAt ?? now
  const aquaSession = await (options.aquaSessionProbe?.() ?? probeAquaSession())
  const windowServer = await (
    options.windowServerProbe?.(aquaSession)
    ?? probeWindowServer(aquaSession)
  )

  return {
    ok: windowServer.connected,
    apiVersion: API_VERSION,
    daemonVersion: options.daemonVersion ?? readDaemonVersion(),
    pid: process.pid,
    uptimeSec: Math.max(0, (now - startedAt) / 1000),
    startedAt,
    aquaSession,
    windowServer,
    permissions: params.includePermissions && options.permissionsProvider
      ? await options.permissionsProvider()
      : undefined,
  }
}

export async function probeAquaSession(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  try {
    const { stdout } = await execFileAsync('/bin/launchctl', ['managername'], {
      timeout: 1_000,
    })
    return stdout.trim().toLowerCase() === 'aqua'
  } catch {
    return false
  }
}

export async function probeWindowServer(
  aquaSession: boolean,
): Promise<{ connected: boolean; error?: string }> {
  if (process.platform !== 'darwin') return { connected: true }
  if (!aquaSession) {
    return {
      connected: false,
      error: 'launchctl manager is not Aqua; daemon is likely outside the GUI session',
    }
  }
  try {
    await execFileAsync('/usr/bin/pgrep', ['-x', 'WindowServer'], { timeout: 1_000 })
    return { connected: true }
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function readDaemonVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '..', '..', 'package.json'),
    join(here, '..', '..', '..', 'package.json'),
  ]
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: unknown }
      if (typeof pkg.version === 'string') return pkg.version
    } catch {
      // Try the next path; dist and tsx resolve from different directories.
    }
  }
  return '0.0.0-unknown'
}
