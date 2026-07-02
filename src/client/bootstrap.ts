// src/client/bootstrap.ts
//
// Default auto-bootstrap for the daemon client. When an adapter finds the
// daemon down, it may attempt to start it. The stdio MCP adapter runs inside
// Claude Code (no Aqua / window server), so a spawned daemon there is only
// useful for headless/dev work — GUI capture still requires the menu-bar app to
// bootstrap the daemon inside a logged-in desktop session. This bootstrap
// therefore spawns the BE daemon bin detached and polls health; if it cannot
// reach a healthy daemon, the client falls through to its actionable error.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type { BootstrapFn, DaemonClient } from './daemon-client.js'
import { resolveBundleHelpersDir } from '../native/compiler.js'

/** Resolve the compiled BE daemon entry (dist/daemon/server.js) from this module. */
export function resolveDaemonEntry(): string {
  // dist/client/bootstrap.js → ../daemon/server.js
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..', 'daemon', 'server.js')
}

/**
 * Bundle-first helper resolution (native-Swift migration M1, additive).
 * If an installed Spectra.app bundle carries an embedded
 * `spectra-daemon-launcher` (Contents/Helpers/ -- see macos/project.yml's
 * embed phase), prefer spawning the daemon through it so the daemon and its
 * native helpers run under the bundle's own TCC identity. Mirrors the
 * pattern LaunchAgentManager.swift already uses for the LaunchAgent path.
 * Falls back to the existing bare-exec behavior (spawn node directly against
 * dist/daemon/server.js) whenever no bundle is found -- which is every
 * environment today (plugin/dev/CI), so default behavior is unchanged.
 */
function resolveEmbeddedDaemonLauncher(): string | null {
  const helpersDir = resolveBundleHelpersDir()
  if (!helpersDir) return null
  const candidate = join(helpersDir, 'spectra-daemon-launcher')
  return existsSync(candidate) ? candidate : null
}

export interface BootstrapOptions {
  /** Path to the BE daemon entry. Defaults to the resolved dist/daemon/server.js. */
  daemonEntry?: string
  /** How long to poll for health after spawn. Default 5s. */
  readyTimeoutMs?: number
  /** Poll interval. Default 250ms. */
  pollIntervalMs?: number
}

/**
 * Build a BootstrapFn that spawns the BE daemon detached and polls until the
 * client's health probe succeeds (or the timeout elapses). Resolves true only
 * when the daemon became reachable.
 */
export function spawnDaemonBootstrap(client: DaemonClient, opts: BootstrapOptions = {}): BootstrapFn {
  const daemonEntry = opts.daemonEntry ?? resolveDaemonEntry()
  const readyTimeoutMs = opts.readyTimeoutMs ?? 5_000
  const pollIntervalMs = opts.pollIntervalMs ?? 250

  return async function bootstrap(): Promise<boolean> {
    if (!existsSync(daemonEntry)) return false
    try {
      const embeddedLauncher = resolveEmbeddedDaemonLauncher()
      const child = embeddedLauncher
        ? spawn(embeddedLauncher, ['--node', process.execPath, '--script', daemonEntry], {
            detached: true,
            stdio: 'ignore',
          })
        : spawn(process.execPath, [daemonEntry], {
            detached: true,
            stdio: 'ignore',
          })
      child.unref()
    } catch {
      return false
    }
    const deadline = Date.now() + readyTimeoutMs
    while (Date.now() < deadline) {
      if (await client.isUp()) return true
      await delay(pollIntervalMs)
    }
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
