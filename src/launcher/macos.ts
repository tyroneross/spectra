// src/launcher/macos.ts
//
// Resolve a macOS app via xcodebuild -showBuildSettings, then `open` the built
// .app. Returns a handle; killing it sends SIGTERM to the running app process.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { LauncherError, type DetectionResult, type LaunchHandle } from './types.js'

const XCODEBUILD_TIMEOUT_MS = 60_000

export interface MacosLaunchOptions {
  repoPath: string
  detection: DetectionResult
  /** Override for tests. */
  spawnFn?: typeof spawn
  /** Override timeout for tests. */
  timeoutMs?: number
  /** If true, resolve the app path but do not actually `open` it (tests). */
  dryRun?: boolean
}

interface BuildSettings {
  BUILT_PRODUCTS_DIR?: string
  EXECUTABLE_NAME?: string
  WRAPPER_NAME?: string
  PRODUCT_NAME?: string
}

function parseBuildSettings(output: string): BuildSettings {
  const out: BuildSettings = {}
  for (const line of output.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+) = (.+)$/)
    if (m) {
      const k = m[1]
      const v = m[2].trim()
      if (k === 'BUILT_PRODUCTS_DIR') out.BUILT_PRODUCTS_DIR = v
      else if (k === 'EXECUTABLE_NAME') out.EXECUTABLE_NAME = v
      else if (k === 'WRAPPER_NAME') out.WRAPPER_NAME = v
      else if (k === 'PRODUCT_NAME') out.PRODUCT_NAME = v
    }
  }
  return out
}

async function runXcodebuild(
  xcodeTarget: string,
  spawnImpl: typeof spawn,
  timeoutMs: number,
): Promise<BuildSettings> {
  const isWorkspace = xcodeTarget.endsWith('.xcworkspace')
  const args = isWorkspace
    ? ['-workspace', xcodeTarget, '-showBuildSettings']
    : ['-project', xcodeTarget, '-showBuildSettings']

  return new Promise((resolve, reject) => {
    const proc = spawnImpl('xcodebuild', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: string[] = []
    const err: string[] = []
    proc.stdout?.on('data', (c: Buffer) => out.push(c.toString('utf8')))
    proc.stderr?.on('data', (c: Buffer) => err.push(c.toString('utf8')))
    const timer = setTimeout(() => {
      try { proc.kill() } catch { /* best-effort */ }
      reject(new LauncherError(
        `xcodebuild -showBuildSettings timed out after ${timeoutMs}ms`,
        err.join('').slice(-400)
      ))
    }, timeoutMs)
    proc.on('error', (e) => {
      clearTimeout(timer)
      reject(new LauncherError(
        `xcodebuild not found or failed to spawn: ${e.message}`,
        'Install Xcode command-line tools: xcode-select --install'
      ))
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(parseBuildSettings(out.join('')))
      } else {
        reject(new LauncherError(
          `xcodebuild exited with code ${code}`,
          err.join('').slice(-400)
        ))
      }
    })
  })
}

export async function launchMacosApp(opts: MacosLaunchOptions): Promise<LaunchHandle> {
  if (!opts.detection.xcodeTarget) {
    throw new LauncherError(
      'detection.xcodeTarget is required for macOS launch',
      'Detection should have populated xcodeTarget.'
    )
  }
  const spawnImpl = opts.spawnFn ?? spawn
  const timeoutMs = opts.timeoutMs ?? XCODEBUILD_TIMEOUT_MS

  const settings = await runXcodebuild(opts.detection.xcodeTarget, spawnImpl, timeoutMs)

  const wrapper = settings.WRAPPER_NAME
    ?? (settings.PRODUCT_NAME ? `${settings.PRODUCT_NAME}.app` : undefined)
    ?? (settings.EXECUTABLE_NAME ? `${settings.EXECUTABLE_NAME}.app` : undefined)

  if (!settings.BUILT_PRODUCTS_DIR || !wrapper) {
    throw new LauncherError(
      'xcodebuild did not report BUILT_PRODUCTS_DIR or a product wrapper name',
      'The Xcode project may not have a buildable macOS app target.'
    )
  }

  const appPath = `${settings.BUILT_PRODUCTS_DIR}/${wrapper}`
  if (!existsSync(appPath) && !opts.dryRun) {
    throw new LauncherError(
      `Built .app does not exist at ${appPath}`,
      'Run an Xcode build first, or open the project in Xcode to build it.'
    )
  }

  const appName = basename(wrapper, '.app')

  if (opts.dryRun) {
    return {
      kind: 'macos',
      appName,
      appPath,
      killOnDisconnect: false,
      kill: async () => { /* dry run */ },
    }
  }

  // `open` returns immediately after handing the URL to LaunchServices; the
  // launched app process is not our child. We can't easily SIGTERM it from
  // here without bundle-identifier introspection, so killOnDisconnect: false
  // for macOS by default. The session-close path will simply forget the handle.
  const proc: ChildProcess = spawnImpl('open', [appPath], { stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => {
    proc.on('error', (e) => reject(new LauncherError(
      `Failed to invoke /usr/bin/open: ${e.message}`,
      'Check permissions on the .app bundle.'
    )))
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new LauncherError(`open exited with code ${code}`, undefined))
    })
  })

  return {
    kind: 'macos',
    appName,
    appPath,
    killOnDisconnect: false,
    kill: async () => { /* not owned by us; no-op */ },
  }
}
