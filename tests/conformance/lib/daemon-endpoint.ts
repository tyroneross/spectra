// tests/conformance/lib/daemon-endpoint.ts
//
// M2B — daemon selection switch. No such switch existed in the repo before
// this milestone (verified in the plan's F1 finding); this is the seam it
// creates. Resolves which daemon the conformance suite talks to:
//
//   - SPECTRA_DAEMON_SOCKET=<path>  → connect to an ALREADY-RUNNING daemon at
//     that socket (TS today; a future Swift daemon later — this is exactly
//     the parameterization M3 needs to point the same suite at a Swift
//     binary without any suite code changes).
//   - unset (default)               → spawn the TS reference daemon
//     in-process-fake-seeded (tests/conformance/lib/daemon-runner.ts) as a
//     child process, with HOME redirected to an isolated temp directory so
//     the real `~/.spectra` is never touched, and manage its lifecycle.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable } from 'node:stream'
import type { Capability } from '../../../src/contract/wire.js'

type DaemonRunnerProcess = ChildProcessByStdio<null, Readable, Readable>

const here = dirname(fileURLToPath(import.meta.url))
const runnerPath = join(here, 'daemon-runner.ts')
const tsxBin = join(here, '..', '..', '..', 'node_modules', '.bin', 'tsx')

export interface DaemonSessionIds {
  web: string
  macos: string
  /** Pristine, pre-seeded (2 conformant steps) session for getSession/getRun —
   * never mutated by any test, so read-op validation is deterministic and
   * immune to the malformed-payload pollution the shared `web` session sees. */
  readonly: string
}

export interface DaemonEndpoint {
  socketPath: string
  /** Present only for the harness-spawned daemon (undefined when
   * SPECTRA_DAEMON_SOCKET points at an externally-managed daemon, in which
   * case the suite has no fixture session to rely on and must obtain its own
   * via a live createSession call). */
  sessionIds?: DaemonSessionIds
  /** A recordingId for a real (seeded-then-stopped) recording on the macos
   * fixture session, so getRecording reaches its success path. Harness-spawned
   * daemon only. */
  recordingId?: string
  /** True when talking to an externally-started daemon (SPECTRA_DAEMON_SOCKET
   * was set) — the suite should not assume the native-bridge fakes or the
   * mutation hook are present. */
  external: boolean
  close(): Promise<void>
}

export interface StartEndpointOptions {
  /** Forwarded to the spawned daemon-runner as env vars — used only by
   * tests/conformance/mutation-check.ts. No-op when talking to an external
   * (SPECTRA_DAEMON_SOCKET) daemon. */
  mutate?: { operation: string; kind: 'drop-field' | 'rename-field' }
  /** Grant the unix caller ONLY these capabilities (default-deny probe, D4).
   * When omitted the caller gets the full default grant. No-op for an external
   * daemon (its capability grant is out of the harness's control). */
  capabilities?: Capability[]
  timeoutMs?: number
}

export async function startConformanceDaemon(opts: StartEndpointOptions = {}): Promise<DaemonEndpoint> {
  const external = process.env.SPECTRA_DAEMON_SOCKET
  if (external) {
    return { socketPath: external, external: true, close: async () => {} }
  }

  const homeDir = mkdtempSync(join(tmpdir(), 'spectra-conformance-home-'))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    // Storage isolation (RESUME guardrail #2). The ACTUAL fix is cwd=homeDir
    // (below): src/core/storage.ts resolves the .spectra root by walking UP from
    // process.cwd() for a project marker (.git/package.json/.spectra) and only
    // falls back to homedir()/.spectra when none is found — so a daemon spawned
    // with cwd inside the repo would (and did, before this) resolve storage to
    // the REPO's real .spectra, accumulating library/session/recording state
    // across runs (non-deterministic corpus) and writing to a protected dir.
    // From a fresh tmp cwd the marker walk finds nothing and lands on
    // homedir()/.spectra, and Node's homedir() honors the overridden HOME.
    // SPECTRA_HOME is set defensively for any FUTURE storage code that might
    // honor it — no code reads it today, so it is not what makes this work.
    SPECTRA_HOME: homeDir,
  }
  if (opts.mutate) {
    env.SPECTRA_CONFORMANCE_MUTATE_OP = opts.mutate.operation
    env.SPECTRA_CONFORMANCE_MUTATE_KIND = opts.mutate.kind
  } else {
    delete env.SPECTRA_CONFORMANCE_MUTATE_OP
    delete env.SPECTRA_CONFORMANCE_MUTATE_KIND
  }
  if (opts.capabilities) {
    env.SPECTRA_CONFORMANCE_UNIX_CAPS = JSON.stringify(opts.capabilities)
  } else {
    delete env.SPECTRA_CONFORMANCE_UNIX_CAPS
  }

  const child = spawn(tsxBin, [runnerPath], {
    env,
    // cwd = the isolated tmp HOME so storage.ts's project-marker walk (see the
    // SPECTRA_HOME note above) finds NO .git/package.json/.spectra and resolves
    // the storage root to homeDir/.spectra — never the repo's real .spectra.
    // Safe for module resolution: tsxBin + runnerPath are absolute and the
    // daemon's own imports are ESM-relative to their files, not cwd-relative.
    cwd: homeDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const timeoutMs = opts.timeoutMs ?? 20_000
  const ready = await waitForReadyLine(child, timeoutMs)

  return {
    socketPath: ready.socketPath,
    sessionIds: ready.sessionIds,
    recordingId: ready.recordingId,
    external: false,
    close: async () => {
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
        child.kill('SIGTERM')
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
        }, 5_000).unref()
      })
      await rmHomeDirWithRetry(homeDir)
    },
  }
}

interface ReadyMessage {
  ready: true
  socketPath: string
  sessionIds: DaemonSessionIds
  recordingId?: string
  pid: number
}

function waitForReadyLine(
  child: DaemonRunnerProcess,
  timeoutMs: number,
): Promise<ReadyMessage> {
  return new Promise((resolve, reject) => {
    let stdoutBuf = ''
    let stderrBuf = ''
    const timer = setTimeout(() => {
      cleanup()
      child.kill('SIGKILL')
      reject(new Error(`daemon-runner did not become ready within ${timeoutMs}ms. stderr: ${stderrBuf}`))
    }, timeoutMs)

    const onStdout = (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8')
      const newlineIndex = stdoutBuf.indexOf('\n')
      if (newlineIndex === -1) return
      const line = stdoutBuf.slice(0, newlineIndex)
      try {
        const parsed = JSON.parse(line) as ReadyMessage
        if (parsed.ready && parsed.socketPath) {
          cleanup()
          resolve(parsed)
        }
      } catch {
        // Not JSON yet (or noise) — keep buffering.
      }
    }
    const onStderr = (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8')
    }
    const onExit = (code: number | null) => {
      cleanup()
      reject(new Error(`daemon-runner exited early (code ${code}). stderr: ${stderrBuf}`))
    }

    function cleanup() {
      clearTimeout(timer)
      child.stdout.off('data', onStdout)
      child.stderr.off('data', onStderr)
      child.off('exit', onExit)
    }

    child.stdout.on('data', onStdout)
    child.stderr.on('data', onStderr)
    child.once('exit', onExit)
  })
}

/**
 * M3.G1 flip (S4, additive) — asserts a unix socket's stat mode is exactly
 * 0600 (owner rw, no group/other access), the peer-credential security
 * boundary both the TS daemon (`server.ts`'s `chmod(socketPath, 0o600)`) and
 * the Swift front door are required to uphold. Used by
 * `tests/conformance/lib/front-door.ts`'s proxy-mode harness to assert the
 * BACKEND socket (the harness's own seeded TS daemon, X) is 0600 as part of
 * harness boot (T-02's acceptance criterion) — this is a verification-only
 * helper, it does not change how any socket is created or chmod'd. Throws a
 * plain `Error` (not a `DaemonError`/`DaemonApiError`) since this runs in the
 * test-harness process, never on a request path.
 */
export function assertSocketMode0600(socketPath: string): void {
  const mode = statSync(socketPath).mode & 0o777
  if (mode !== 0o600) {
    throw new Error(
      `Expected unix socket ${socketPath} to be mode 0600 (peer-credential security ` +
        `boundary), got ${mode.toString(8).padStart(3, '0')}`,
    )
  }
}

/** Defense-in-depth on top of daemon-runner.ts's own driver.disconnect()
 * teardown: a killed real Chrome/native-bridge child process can still hold
 * profile-directory file handles open for a brief moment after `kill()`
 * returns (observed live during M2B implementation: `rmSync` raced ENOTEMPTY
 * against Chromium's own async exit cleanup under `.spectra/chromium-
 * profile/`). Retries are a filesystem-cleanup robustness measure only — they
 * do not affect, mask, or relax any contract-conformance assertion. */
async function rmHomeDirWithRetry(homeDir: string, attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      rmSync(homeDir, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
    }
  }
}
