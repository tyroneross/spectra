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
import { homedir } from 'node:os'
import type { BootstrapFn, DaemonClient } from './daemon-client.js'
import { resolveBundleHelpersDir } from '../native/compiler.js'

// ─── §G3 bootstrap rogue-spawn guard (M3.G1 flip, Q-01 APPROVED option (b),
// docs/plans/m3-g1-flip-plan.md) ────────────────────────────────────────────
//
// Post-flip, `dev.spectra.daemon` (the Swift front door) owns the PRIMARY
// socket and a SECOND LaunchAgent, `dev.spectra.daemon-ts`, runs the TS
// daemon on a secondary socket as the front door's proxy backend
// (`SPECTRA_DAEMON_LISTEN_SOCKET` — see src/daemon/server.ts's main-entry
// callsite). If this client's own auto-bootstrap fired during a crash/boot/
// rollback window in that topology, it would spawn ANOTHER TS daemon main
// entry with no listen-socket override, binding the PRIMARY socket — fighting
// the launchd-KeepAlive'd front door, silently un-flipping the topology, and
// giving `library`'s index.json a second writer (a data-integrity hazard).
//
// Detection is the presence of the `dev.spectra.daemon-ts` LaunchAgent plist
// — unique to the flip topology. The front-door label `dev.spectra.daemon`
// predates the flip and does NOT discriminate (a pre-flip machine already has
// that plist), so it is deliberately NOT the signal checked here.

const FLIP_TOPOLOGY_PLIST_LABEL = 'dev.spectra.daemon-ts'

/** Resolves the on-disk path of the `dev.spectra.daemon-ts` LaunchAgent plist
 * — mirrors `LaunchAgentManager.swift`'s own plist path convention
 * (`~/Library/LaunchAgents/<label>.plist`) without importing Swift code (this
 * is a plain filesystem check from the TS client side). `homeDir` defaults to
 * the real `os.homedir()`; the only caller that overrides it is a regression
 * test (T-10), never production code. */
export function resolveFlipTopologyPlistPath(homeDir: string = homedir()): string {
  return join(homeDir, 'Library', 'LaunchAgents', `${FLIP_TOPOLOGY_PLIST_LABEL}.plist`)
}

/** True when the M3.G1 flip topology (S5's dual-LaunchAgent install) is
 * present on this machine — i.e. `dev.spectra.daemon-ts` was installed by
 * `flip-g1.sh`/`LaunchAgentManager`. Exported (additive) so a regression test
 * can assert both branches without touching the real
 * `~/Library/LaunchAgents`. */
export function isFlipTopologyInstalled(homeDir?: string): boolean {
  return existsSync(resolveFlipTopologyPlistPath(homeDir))
}

const FLIP_TOPOLOGY_DECLINE_MESSAGE =
  '[spectra] daemon is launchd-managed under the M3.G1 flip topology ' +
  '(dev.spectra.daemon-ts is installed) — refusing to self-spawn a second TS ' +
  'daemon onto the primary socket (this would fight the launchd-managed front ' +
  'door and risk a second writer to the library index). Run ' +
  '`launchctl kickstart -k gui/$UID/dev.spectra.daemon` to restart the front ' +
  'door, or `launchctl kickstart -k gui/$UID/dev.spectra.daemon-ts` to restart ' +
  'the TS backend.\n'

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
  /** §G3 guard test-only override: the home directory the guard checks for
   * `Library/LaunchAgents/dev.spectra.daemon-ts.plist`. Defaults to the real
   * `os.homedir()`. Never set by production code — only by the T-10
   * regression harness (macos/Spectra/DaemonCore/verify-flip-suite.ts). */
  flipGuardHomeDir?: string
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
    // §G3 guard (Q-01 APPROVED option (b)): decline to self-spawn a second TS
    // daemon onto the primary socket while the flip topology is installed.
    // Returns `false` — NEVER throws — so `DaemonClient.failOpenRetry`'s
    // existing `if (ok && (await this.isUp()))` short-circuit
    // (src/client/daemon-client.ts, UNOWNED/unedited) falls straight through
    // to its own actionable `daemon_down` DaemonError with zero changes
    // needed there. Checked FIRST, before the existing `daemonEntry`
    // existence check, so the decline message is never masked by an
    // unrelated "entry not found" early-return.
    if (isFlipTopologyInstalled(opts.flipGuardHomeDir)) {
      process.stderr.write(FLIP_TOPOLOGY_DECLINE_MESSAGE)
      return false
    }

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
