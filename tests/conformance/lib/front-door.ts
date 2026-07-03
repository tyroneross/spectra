// tests/conformance/lib/front-door.ts
//
// M3.G1 flip (S4) — proxy-mode harness (plan §S4 goal (b), Gate B / T-02).
// Boots the harness's OWN seeded TS daemon (the exact same in-process-fake-
// seeded daemon-runner.ts subprocess `daemon-endpoint.ts` already spawns for
// the direct-TS conformance run) on a socket X, then compiles + boots the
// Swift front door (macos/Spectra/DaemonCore) on a SECOND socket Y, with
// `SPECTRA_PROXY_BACKEND_SOCKET=X` and the PRODUCTION routing config (D-01:
// 5 native ops, 25 proxied — the real flip topology, not the all-11-native
// test-only config `verify-g1-suite.ts`/`verify-swift-op.ts` use).
//
// Because the backend (X) is the harness's own fully-fixture-seeded TS
// daemon — the SAME one `startConformanceDaemon()` already gives a direct-TS
// run — every fixture seam (fake drivers, seeded read-only session, seeded
// recording) is reachable THROUGH the tunnel too. That is what makes "point
// the full 170-test suite at Y" a meaningful proxy-FIDELITY gate rather than
// a repeat of the external-mode skip-gated run: see
// `tests/conformance/lib/external-mode.ts`'s `SPECTRA_CONFORMANCE_PROXY_FIDELITY`
// flag, which this module's caller (verify-flip-suite.ts) sets specifically
// so the suite does not skip the 25 proxied ops the way a genuinely-unknown
// external daemon would require.
//
// This module ONLY builds/tears down the two-daemon topology and asserts its
// preconditions (backend socket mode). It does not itself invoke vitest —
// `macos/Spectra/DaemonCore/verify-flip-suite.ts` (the orchestrator) spawns
// the suite as a child process pointed at `frontDoorSocketPath`, with
// `SPECTRA_CONFORMANCE_PROXY_FIDELITY=1` set.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { execFileSync, spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest, type ClientRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable } from 'node:stream'
import {
  startConformanceDaemon,
  assertSocketMode0600,
  type DaemonEndpoint,
  type DaemonSessionIds,
} from './daemon-endpoint.js'
import type { EnrichedContractSpec } from '../../../src/contract/enriched-spec.js'

const here = dirname(fileURLToPath(import.meta.url))
/** macos/Spectra/DaemonCore — the Swift daemon-core module this harness
 * compiles. Same directory `verify-g1-suite.ts`/`verify-swift-op.ts` resolve
 * relative to themselves; resolved here relative to this file's own path so
 * it is correct regardless of the caller's cwd. */
const daemonCoreDir = join(here, '..', '..', '..', 'macos', 'Spectra', 'DaemonCore')

/** D-01 v1 routing config: the REAL production topology — 5 native ops, the
 * other 25 (including the 6 session-coupled G1 ops) proxied to the TS
 * backend. Mirrors "## Routing table at flip (production config)" in
 * docs/plans/m3-g1-flip-plan.md verbatim — this is intentionally NOT
 * configurable by a harness caller: T-02's whole point is proving the suite
 * passes under the topology that will actually ship, not a test-convenience
 * variant of it (that variant is the all-11-native config
 * `verify-g1-suite.ts`/`verify-swift-op.ts` use for the separate Gate-A
 * regression, never this gate). */
const PRODUCTION_ROUTING_CONFIG = {
  version: 1,
  native: ['health', 'getPermissions', 'requestPermissions', 'listWindows', 'library'],
} as const

export interface FrontDoorHarnessOptions {
  /** How long to wait for the Swift front door to bind its socket. Default 20s
   * (compiling the whole DaemonCore module ahead of the bind can be slow on a
   * cold `swiftc` cache). */
  bootTimeoutMs?: number
  /** M3.G2 (S7, APPEND-ONLY — SG-2): overrides the routing config JSON written
   * to `routingConfigPath` before the front door boots. Defaults to
   * `PRODUCTION_ROUTING_CONFIG` (the v1, 5-op-native shape) when omitted —
   * UNCHANGED from before this option existed — so Gate B's G1 regression
   * (which never sets this) stays byte-identical. A caller exercising the G2
   * flip topology (verify-g2-suite.ts) passes a v2 config
   * (`{version:2, native, affinity, merge, fanout}`, docs/plans/
   * m3-g2-plan.md §D-03) here instead of hand-rolling a second front-door
   * boot routine. Written verbatim via `JSON.stringify(..., null, 2)`, same
   * as the production default was. */
  routingConfig?: unknown
  /** M3.G2 (S7, APPEND-ONLY): additional env vars merged into the front
   * door's spawn env — e.g. `SPECTRA_CONFORMANCE_SEED=1` +
   * `SPECTRA_CONFORMANCE_MILESTONE=g2` so a G2 caller's front door seeds
   * FakeDriver-backed sessions and accepts a `fake:` createSession target
   * (ADR-06). Spread BEFORE this module's own fixed keys
   * (`SPECTRA_DAEMON_SOCKET`/`SPECTRA_PROXY_BACKEND_SOCKET`/
   * `SPECTRA_ROUTING_CONFIG`/`HOME`/`SPECTRA_HOME`) so a caller can never
   * accidentally override the wiring this module itself is responsible for —
   * those five keys always win. Omitted (undefined) is a no-op: the spawn env
   * is `{...process.env, SPECTRA_DAEMON_SOCKET: ..., ...}` exactly as before
   * this option existed. */
  extraEnv?: Record<string, string>
}

export interface FrontDoorHarness {
  /** The Swift front door's own listen socket (Y) — point the conformance
   * suite's `SPECTRA_DAEMON_SOCKET` here. */
  frontDoorSocketPath: string
  /** The harness's own seeded TS daemon's socket (X) — the front door's proxy
   * backend. Asserted mode 0600 before this harness resolves. */
  backendSocketPath: string
  /** T-02/T-02c (rev 3): the backend's own pre-seeded fixture session ids
   * (web/macos/readonly), forwarded from the internal `startConformanceDaemon()`
   * call this harness already makes — exposed so a caller (verify-flip-suite.ts's
   * differential runner) can build a `GeneratorContext` via
   * `tests/conformance/lib/fixture-context.ts#buildFixtureContext` pointed at
   * `backendSocketPath` WITHOUT re-seeding (an extra, redundant set of
   * createSession/act calls) — reuses the exact fixture seam Gate B's full-suite
   * runs already depend on. */
  backendSessionIds?: DaemonSessionIds
  /** T-02/T-02c (rev 3): the backend's pre-seeded recordingId, forwarded for the
   * same reason as `backendSessionIds`. */
  backendRecordingId?: string
  /** Tears down the Swift front door process, then the backend TS daemon
   * (`DaemonEndpoint.close()`), then removes the harness's own temp dirs. */
  close(): Promise<void>
}

type FrontDoorProcess = ChildProcessByStdio<null, Readable, Readable>

/**
 * Boots the two-daemon proxy topology for Gate B (T-02): backend TS daemon
 * (X) via the existing `startConformanceDaemon()` machinery, then the
 * compiled Swift front door (Y) with `SPECTRA_PROXY_BACKEND_SOCKET=X` and the
 * production routing config. Asserts the backend socket is mode 0600 as part
 * of boot (T-02's explicit acceptance line), matching what
 * `src/daemon/server.ts`'s `chmod(socketPath, 0o600)` already guarantees for
 * every TS-daemon socket — this is a verification of that existing guarantee,
 * not a new chmod call.
 */
export async function startFrontDoorHarness(
  opts: FrontDoorHarnessOptions = {},
): Promise<FrontDoorHarness> {
  const bootTimeoutMs = opts.bootTimeoutMs ?? 20_000

  // 1. Backend (X): the harness's own seeded TS daemon. NOT talking to an
  // external daemon here — startConformanceDaemon() only takes the external
  // branch when SPECTRA_DAEMON_SOCKET is already set in THIS process's env,
  // which a front-door-harness caller must not have done before calling this.
  if (process.env.SPECTRA_DAEMON_SOCKET) {
    throw new Error(
      'startFrontDoorHarness() must be called with SPECTRA_DAEMON_SOCKET unset in the ' +
        'current process — it boots its OWN backend daemon and would otherwise silently ' +
        'attach to whatever daemon that env var already points at.',
    )
  }
  const backend: DaemonEndpoint = await startConformanceDaemon()
  assertSocketMode0600(backend.socketPath)

  // 2. Compile the Swift DaemonCore module (mirrors verify-g1-suite.ts's own
  // compile step verbatim, including its shell-glob approach for enumerating
  // sibling *.swift files without hardcoding the file list here).
  const swiftFiles = execFileSync('bash', ['-c', `ls ${daemonCoreDir}/*.swift`])
    .toString()
    .trim()
    .split('\n')
  const binDir = mkdtempSync(join(tmpdir(), 'spectra-front-door-bin-'))
  const bin = join(binDir, 'spectra-daemon-core')
  execFileSync('swiftc', [...swiftFiles, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'] })

  // 3. Write the production routing config + boot the front door (Y) with
  // backend=X. Isolated temp HOME so the front door's own StoragePath/
  // LibraryStore/SessionStore never touch this developer's real ~/.spectra —
  // same discipline daemon-endpoint.ts already applies to the TS backend.
  const frontDoorHome = mkdtempSync(join(tmpdir(), 'spectra-front-door-home-'))
  const frontDoorSocketPath = join(frontDoorHome, 'front-door.sock')
  const routingConfigPath = join(frontDoorHome, 'routing-config.json')
  writeFileSync(routingConfigPath, JSON.stringify(opts.routingConfig ?? PRODUCTION_ROUTING_CONFIG, null, 2))

  const frontDoor: FrontDoorProcess = spawn(bin, [], {
    env: {
      ...process.env,
      ...opts.extraEnv,
      // Fixed keys AFTER ...opts.extraEnv so they always take precedence —
      // see FrontDoorHarnessOptions.extraEnv's doc comment.
      SPECTRA_DAEMON_SOCKET: frontDoorSocketPath,
      SPECTRA_PROXY_BACKEND_SOCKET: backend.socketPath,
      SPECTRA_ROUTING_CONFIG: routingConfigPath,
      HOME: frontDoorHome,
      SPECTRA_HOME: frontDoorHome,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let frontDoorStderr = ''
  frontDoor.stderr.on('data', (chunk: Buffer) => {
    frontDoorStderr += chunk.toString('utf8')
  })

  const deadline = Date.now() + bootTimeoutMs
  let frontDoorExited: number | null | undefined
  frontDoor.once('exit', (code) => {
    frontDoorExited = code
  })
  while (Date.now() < deadline && !existsSync(frontDoorSocketPath) && frontDoorExited === undefined) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (frontDoorExited !== undefined) {
    await backend.close()
    throw new Error(
      `Swift front door exited early (code ${String(frontDoorExited)}) before binding its socket. ` +
        `stderr: ${frontDoorStderr}`,
    )
  }
  if (!existsSync(frontDoorSocketPath)) {
    frontDoor.kill('SIGKILL')
    await backend.close()
    throw new Error(`Swift front door did not bind ${frontDoorSocketPath} within ${bootTimeoutMs}ms.`)
  }

  return {
    frontDoorSocketPath,
    backendSocketPath: backend.socketPath,
    backendSessionIds: backend.sessionIds,
    backendRecordingId: backend.recordingId,
    close: async () => {
      await new Promise<void>((resolve) => {
        if (frontDoorExited !== undefined) {
          resolve()
          return
        }
        frontDoor.once('exit', () => resolve())
        frontDoor.kill('SIGTERM')
        setTimeout(() => {
          if (frontDoorExited === undefined) frontDoor.kill('SIGKILL')
        }, 5_000).unref()
      })
      await backend.close()
      try {
        rmSync(frontDoorHome, { recursive: true, force: true })
      } catch {
        // Best-effort — mirrors daemon-endpoint.ts's own cleanup tolerance.
      }
      try {
        rmSync(binDir, { recursive: true, force: true })
      } catch {
        // Best-effort.
      }
    },
  }
}

/** Exported for verify-flip-suite.ts's T-02b (fail-closed mutation) gate: the
 * SAME production config this module boots the happy-path harness with, so
 * the mutation test can start from a known-good baseline and mutate exactly
 * one field (moving a session-coupled op into `native:[]`) rather than
 * hand-duplicating the production op list a second time. */
export function productionRoutingConfig(): { version: 1; native: string[] } {
  return { version: PRODUCTION_ROUTING_CONFIG.version, native: [...PRODUCTION_ROUTING_CONFIG.native] }
}

/** Resolved DaemonCore source directory — exported so verify-flip-suite.ts
 * (which also needs to compile the module for Gates A/B2/C) does not
 * re-derive this path a second, independently-fragile way. */
export function resolveDaemonCoreDir(): string {
  return daemonCoreDir
}

// ═══════════════════════════════════════════════════════════════════════════
// T-02 (Gate B-diff) — differential byte-transparency mechanism (rev 3,
// Gate redesign — Ruling 1). See docs/plans/m3-g1-flip-plan.md's "Gate
// redesign rev 3" section for the design rationale. verify-flip-suite.ts's
// gateBDiff() is the orchestrator that calls these; this module owns the wire
// mechanics + comparison primitives only.
// ═══════════════════════════════════════════════════════════════════════════

export interface RawProbeResponse {
  status: number
  /** Lowercased response headers (multi-value headers joined with ", "). */
  headers: Record<string, string>
  raw: string
  elapsedMs: number
}

export interface RawRequestOptions {
  socketPath: string
  path: string
  method?: 'POST' | 'GET'
  body?: string
  timeoutMs?: number
}

/**
 * EPIPE/teardown-crash postmortem (M3.G1 flip harness): a `ClientRequest`'s
 * own `req.on('error', ...)` listener only forwards socket errors while the
 * request still considers itself actively attached to that socket. Once a
 * response has been fully consumed (or `req.destroy()` has already run) and
 * something LATER destroys the peer out from under it — e.g.
 * `startFrontDoorHarness().close()` SIGTERMing the front door / backend
 * subprocess during Gate B-diff teardown, while an SSE connection opened by
 * `openSseConnection`/`sseSmoke` is still holding a live socket open — a
 * pending write's completion can fail (EPIPE) or the peer can RST
 * (ECONNRESET) and that error is emitted DIRECTLY on the underlying
 * `net.Socket` instance, bypassing `req`'s own forwarding. With no listener
 * on the socket itself that is an unhandled `'error'` event and crashes the
 * whole Node process (`throw er; // Unhandled 'error' event`) — exactly the
 * `write EPIPE` crash that used to kill `verify-flip-suite.ts` right after
 * Gate B-diff's SSE smoke, before Gates B2/B-e2e/C/D ever ran.
 *
 * Attaching this on `req`'s `'socket'` event (fired as soon as the socket is
 * assigned, whether freshly connected or reused) gives a handle to the raw
 * `Socket` itself. A benign teardown-class error (EPIPE/ECONNRESET) is
 * logged and swallowed — by definition harmless once we are done with that
 * socket. Anything else is logged loudly (never silently dropped, never
 * rethrown from inside the handler — doing so would itself become a new
 * unhandled exception) so a genuinely novel failure mode is still visible.
 * This is additive to, not a replacement for, the caller's own
 * `req.on('error', reject)` — that still rejects the promise for a genuine
 * in-flight connection failure exactly as before.
 */
function guardSocketTeardownErrors(req: ClientRequest, label: string): void {
  req.on('socket', (socket) => {
    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
        console.warn(`[front-door] benign teardown socket error on ${label}: ${err.code}`)
        return
      }
      console.error(`[front-door] UNEXPECTED socket error on ${label} (not rethrown — see guardSocketTeardownErrors):`, err)
    })
  })
}

/**
 * Minimal HTTP-over-unix-socket client used ONLY by the T-02 differential
 * runner. Deliberately reimplemented here rather than reusing
 * `tests/conformance/lib/socket-client.ts` / `src/client/transport.ts`:
 * T-02 needs the response Content-Type header and the raw response bytes,
 * neither of which `socketRequest()` (transport.ts) surfaces today, and
 * neither of those two files is in this agent's owned set (see the rev-3
 * handoff) — widening their return shape is out of scope here. This sends
 * the exact same request headers `socketRequest` does (see transport.ts),
 * so it is a read of the SAME wire contract, not a divergent one.
 */
export function rawRequest(opts: RawRequestOptions): Promise<RawProbeResponse> {
  const { socketPath, path, method = 'POST', body, timeoutMs = 30_000 } = opts
  const payload = body ?? ''
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath,
        path,
        method,
        headers: {
          host: 'spectra.local',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: flattenHeaders(res.headers),
            raw: Buffer.concat(chunks).toString('utf8'),
            elapsedMs: Date.now() - started,
          })
        })
      },
    )
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`rawRequest timed out after ${timeoutMs}ms (${method} ${path})`))
    })
    req.on('error', reject)
    guardSocketTeardownErrors(req, `rawRequest ${method} ${path}`)
    if (method === 'POST') req.write(payload)
    req.end()
  })
}

function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v
    else if (Array.isArray(v)) out[k.toLowerCase()] = v.join(', ')
  }
  return out
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function safeJsonParse(raw: string): unknown {
  if (raw.length === 0) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * Structural diff between two JSON-ish values — returns the set of
 * dot/bracket paths (root = `''`) whose VALUES differ. Used for the
 * self-calibrating volatility mask: called on two DIRECT responses to the
 * identical request, the returned paths are exactly the fields that vary
 * run-to-run for reasons unrelated to proxy correctness (timestamps, uptimes,
 * pids, freshly-generated ids) — see `maskPaths`.
 */
export function diffVolatilePaths(a: unknown, b: unknown, prefix = ''): Set<string> {
  const out = new Set<string>()
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      const childPrefix = prefix ? `${prefix}.${k}` : k
      if (!(k in a) || !(k in b)) {
        out.add(childPrefix)
        continue
      }
      for (const p of diffVolatilePaths(a[k], b[k], childPrefix)) out.add(p)
    }
    return out
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.add(prefix)
      return out
    }
    for (let i = 0; i < a.length; i++) {
      for (const p of diffVolatilePaths(a[i], b[i], `${prefix}[${i}]`)) out.add(p)
    }
    return out
  }
  if (Array.isArray(a) !== Array.isArray(b) || typeof a !== typeof b) {
    out.add(prefix)
    return out
  }
  if (a !== b) out.add(prefix)
  return out
}

/** Deep-clones `value`, replacing every path in `paths` (as produced by
 * `diffVolatilePaths`) with a fixed sentinel — so two otherwise-identical
 * responses compare equal once their known-volatile fields are masked out. */
export function maskPaths(value: unknown, paths: ReadonlySet<string>, prefix = ''): unknown {
  if (paths.has(prefix)) return '<T02-MASKED>'
  if (Array.isArray(value)) {
    return value.map((item, i) => maskPaths(item, paths, `${prefix}[${i}]`))
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const childPrefix = prefix ? `${prefix}.${k}` : k
      out[k] = maskPaths(v, paths, childPrefix)
    }
    return out
  }
  return value
}

/** Stable (sorted-key) JSON serialization — used to compare two masked
 * values by content rather than by incidental key-insertion order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export interface DifferentialCheckResult {
  op: string
  ok: boolean
  detail: string
  directElapsedMs: number
  proxyElapsedMs: number
  /** Which comparison branch actually ran (Fable rev 3.1, Rulings 1/2): a
   * native op is judged by ROUTE FINGERPRINT, never byte-equality vs TS; a
   * proxied op is judged by byte-equality-minus-mask. Surfaced so a
   * caller/report can show which rule fired per op without re-deriving it.
   * `'wire-edge'` (Fable rev 3.4 hygiene fix) is the SAME native-fingerprint
   * computation, relabeled: the T-07 envelope-validation edge probes
   * (oversized body / unknown param key / bad apiVersion / missing
   * requestId) target `health` (a native op) purely as a harmless carrier —
   * they assert wire-envelope behavior, not a health-op fingerprint — so
   * `'native-fingerprint'` was a misnomer for exactly those four. Set via
   * `opts.modeOverride` below; no computation changes. */
  mode: 'native-fingerprint' | 'proxied-byte-equal' | 'wire-edge'
  /** Proxied ops only: the JSON paths the ≥1.1s-spaced 3-sample direct
   * calibration found volatile (diffVolatilePaths across all three pairs) —
   * the RAW calibration output, before the structural-protection filter
   * below is applied. Reported so a caller can see exactly what calibration
   * observed (including any path it had to reject as a calibration error).
   * Empty for native ops.
   */
  calibratedVolatilePaths: string[]
  /** Fable rev 3.2 (the guarded calibrated mask — supersedes the rev 3.1
   * fixed `{'timestamp'}`-only mask): the mask ACTUALLY APPLIED to the byte
   * compare — the deterministic seed `{'timestamp'}` UNION the calibrated-
   * volatile paths, MINUS any path that is structurally protected (see
   * `isStructurallyProtected`) — a protected path flagged volatile produces
   * a `calibration-error:` failure instead of being masked, and is excluded
   * from this set (byte-compare still runs on it). Persisted by the caller
   * (verify-flip-suite.ts) to `.build-loop/flip-evidence/t02-masks.json` for
   * the Fable group verdict's mask-classification review. Empty for native
   * ops (no masking applies to the fingerprint-only comparison).
   */
  appliedMaskPaths: string[]
  /** Fable rev 3.3 ruling (the recordTerminal live-capture exception,
   * pre-approved for exactly ONE path on ONE op — never generalized): paths
   * judged by a STRUCTURAL shape assertion instead of byte-equality-after-
   * masking. Currently only `result.timeline` on `recordTerminal` — a LIVE
   * terminal-cast recording whose event timeline is expected to vary
   * run-to-run (event count/ordering), unlike `replayTerminal` (a FIXED
   * pre-recorded cast, deliberately excluded from this and kept fully
   * byte-compared — it is the discriminator that proves the tunnel itself is
   * faithful). A structural path is entirely excluded from the byte compare
   * (never value-masked-then-compared like `appliedMaskPaths`) and instead
   * asserted array/shape-valid independently on both legs — a shape
   * violation is a REAL failure, never maskable. Empty for every op except
   * recordTerminal. `class` is a caller-facing classification tag persisted
   * to `.build-loop/flip-evidence/t02-masks.json` distinctly from ordinary
   * value-mask entries, for the Fable group verdict's review.
   */
  structuralPaths: Array<{ path: string; class: string }>
  /** Fable rev 3.5 ruling (TERMINAL, closed six-op set — the S4 flip's last
   * delta): the CONCRETE paths a class pattern actually matched-and-masked
   * this run, for exactly the six capture/AX ops (`act`, `observe`,
   * `snapshot`, `step`, `llmStep`, `walkthrough`) — never any other op. Each
   * entry is a RESOLVED path (e.g. `result.results[0].durationMs`), not the
   * pattern text, plus its class (`duration` | `embedded-content` |
   * `temp-path`). Populated ONLY for a path that passed its typed guard on
   * BOTH legs (see `classPatternGuardFailure`) — a hit that failed its guard
   * is instead pushed to `detail`/`ok:false` as a REAL FAIL and is NEVER
   * added here. Masked in ADDITION to `appliedMaskPaths` (the calibrated
   * mask keeps running as a diagnostic per rev 3.5 point 5), kept in this
   * SEPARATE field so `.build-loop/flip-evidence/t02-masks.json` can record
   * it distinctly as `mode: "class-pattern"` rather than folding it into the
   * ordinary calibrated-mask entries. Empty for every op outside the six and
   * for native ops.
   */
  classPatternPaths: Array<{ path: string; class: string }>
  /** Advisor ruling 2 (docs/plans/m3-g2-vb-advisor-ruling-2.md, Item 1;
   * evidence g2-chain3.log:1011) — present ONLY when the caller passed
   * `okDivergenceClass` AND the 4 responses (3 direct calibration + 1 proxy)
   * did not all agree on ok-ness (e.g. createSession's real-Chrome launch
   * flake: `direct=500 proxy=200` on the SAME TS backend). The caller
   * (verify-flip-suite.ts) persists this event into its masks ledger
   * (`.build-loop/flip-evidence/t02-masks.json`) distinctly from the
   * ordinary `appliedMaskPaths`/`classPatternPaths` entries, so a
   * PERSISTENT one-sided pattern (proxy leg always failing while direct
   * passes, across chains) stays visible as a finding rather than being
   * silently absorbed. Undefined for every op/run outside that opt-in AND
   * for the all-agree case (the existing full masked byte-diff runs
   * instead, and this stays undefined). */
  okDivergenceEvent?: {
    class: 'real-chrome-stateful'
    op: string
    responses: Array<{ leg: string; status: number; ok: boolean | undefined }>
    failedLegs: string[]
  }
}

/** The deterministic SEED of the proxied-op mask (Fable rev 3.1 Ruling 2,
 * carried forward under rev 3.2): the top-level envelope `timestamp` VALUE.
 * Always unioned with the per-op calibrated-volatile set (rev 3.2) before a
 * byte compare runs — see `runDifferentialCheck`'s proxied branch. Kept as
 * its own constant (rather than folded into the calibration) because it is
 * asserted PRESENT on both legs unconditionally, even for an op whose 3
 * direct samples happen not to exercise timestamp drift within the
 * calibration window.
 */
const PROXIED_OP_MASK: ReadonlySet<string> = new Set(['timestamp'])

/**
 * Fable rev 3.2, guard #2: structural fields that may NEVER be masked, even
 * if the per-op calibration flags them as run-to-run volatile. A calibration
 * result that includes any of these paths signals backend instability or a
 * harness bug — NOT maskable volatility — and is reported as a distinct
 * `calibration-error:` finding rather than silently absorbed into the mask.
 * `error.message` is deliberately NOT in this set (free text — maskable);
 * `error.code` IS (a structural discriminant). `result`/`error` are listed as
 * their OWN root paths only ("wholesale") — masking either whole subtree
 * away is protected, but a path NESTED under one of them (e.g.
 * `result.snapshot`, `result.path`) is not automatically protected merely
 * for living under `result`.
 */
const STRUCTURALLY_PROTECTED_PATHS: ReadonlySet<string> = new Set([
  'ok',
  'apiVersion',
  'requestId',
  'caller',
  'deliveryPath',
  'error.code',
  'result',
  'error',
])

/** Whether `path` (a `diffVolatilePaths`-shaped JSON path) names a
 * structurally-protected field per the rev 3.2 guard above. */
export function isStructurallyProtected(path: string): boolean {
  return STRUCTURALLY_PROTECTED_PATHS.has(path)
}

type JsonPathToken = { kind: 'key'; key: string } | { kind: 'index'; index: number }

/** Tokenizes a `diffVolatilePaths`-shaped path (`a.b[2].c`, root `''`) into
 * an ordered list of object-key / array-index steps, so `getByJsonPath` can
 * walk an arbitrary JSON value the same way `diffVolatilePaths` built the
 * path string in the first place. */
function tokenizeJsonPath(path: string): JsonPathToken[] {
  if (path === '') return []
  const tokens: JsonPathToken[] = []
  const re = /([^.[\]]+)|\[(\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) tokens.push({ kind: 'key', key: m[1] })
    else tokens.push({ kind: 'index', index: Number(m[2]) })
  }
  return tokens
}

/** Resolves `path` against `value`, distinguishing "absent" from "present
 * with value `undefined`/`null`" — used by the rev 3.2 presence+type guard
 * to detect a masked field the tunnel silently DROPPED (absent) vs one it
 * merely re-typed (present, wrong JSON type). */
function getByJsonPath(value: unknown, path: string): { present: boolean; value: unknown } {
  let cur: unknown = value
  for (const token of tokenizeJsonPath(path)) {
    if (token.kind === 'key') {
      if (!isPlainObject(cur) || !(token.key in cur)) return { present: false, value: undefined }
      cur = cur[token.key]
    } else {
      if (!Array.isArray(cur) || token.index >= cur.length) return { present: false, value: undefined }
      cur = cur[token.index]
    }
  }
  return { present: true, value: cur }
}

/** JSON-level type name for the rev 3.2 presence+type guard — `null` and
 * arrays are distinguished from `object`/`typeof` so a tunnel that turns a
 * masked array into `null` (or vice versa) is caught as a type mismatch. */
function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** How long to space the 3 direct calibration samples apart (Ruling 2 fix):
 * the previous 2-rapid-sample calibration aliased on second-granularity
 * `Date.now()`/epoch-seconds timestamps and often computed a volatile set of
 * `{}` for a proxied op, which then let a real (non-masked) timestamp value
 * flow into the byte-equality compare and false-positive as a body mismatch.
 * 1.1s comfortably straddles a 1-second timestamp tick. */
const CALIBRATION_SPACING_MS = 1_100

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Derives the operation name a request actually targets from its wire path
 * (`/api/v1/{op}`) — the SAME string Router.swift's `nativeOps.contains(_:)`
 * and `src/daemon/server.ts`'s route dispatch key off, so classification
 * here can never quietly drift from what the two daemons actually route on,
 * even for probes (T-07 edge cases, the unknown-route probe) whose request
 * BODY names a different/bogus operation than the URL they hit. */
function deriveOpFromPath(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? path
}

/** Whether `op` is one of the 5 natively-Swift-served ops, derived from the
 * SAME production routing config `startFrontDoorHarness()` boots the front
 * door with (`productionRoutingConfig().native`) — never a second,
 * independently-maintained list that could silently drift from it (per the
 * rev 3.1 brief's explicit instruction). */
export function isNativeOp(op: string): boolean {
  return (PRODUCTION_ROUTING_CONFIG.native as readonly string[]).includes(op)
}

/** Advisor ruling 2 (docs/plans/m3-g2-vb-advisor-ruling-2.md, Item 1) — the
 * Item-1 floor's error-taxonomy check needs an op's DECLARED errorCodes,
 * read from the same live contract.spec.json every other lib in this
 * directory reads from (never a second, independently-maintained list —
 * same discipline as `deriveOpFromPath`/`isNativeOp` above). Cached at
 * module scope after first read (the spec is static for the process
 * lifetime). Path resolved relative to THIS file, mirroring
 * `lib/external-mode.ts`'s `specPath` constant. */
const contractSpecPath = join(here, '..', '..', '..', 'src', 'contract', 'contract.spec.json')
let cachedContractSpec: EnrichedContractSpec | undefined
function declaredErrorCodesFor(op: string): readonly string[] {
  if (!cachedContractSpec) {
    cachedContractSpec = JSON.parse(readFileSync(contractSpecPath, 'utf8')) as EnrichedContractSpec
  }
  return cachedContractSpec.operations[op]?.errorCodes ?? []
}

/**
 * Collects 3 direct-only samples of the identical request, spaced
 * `CALIBRATION_SPACING_MS` apart, and returns the union of
 * `diffVolatilePaths` across all three pairs (1×2, 2×3, 1×3) — the
 * Ruling-2-fixed calibration. Used ONLY as a diagnostic/verification signal
 * (does the volatile set the harness observes actually equal exactly
 * `{'timestamp'}`, proving the aliasing bug is fixed) — NOT as the mask
 * `runDifferentialCheck` applies (see `PROXIED_OP_MASK`'s doc comment).
 */
export async function calibrateVolatilePaths(
  directSocketPath: string,
  opts: { path: string; method?: 'POST' | 'GET'; body: string; timeoutMs?: number },
): Promise<Set<string>> {
  const { path, method = 'POST', body, timeoutMs = 30_000 } = opts
  const c1 = await rawRequest({ socketPath: directSocketPath, path, method, body, timeoutMs })
  await sleep(CALIBRATION_SPACING_MS)
  const c2 = await rawRequest({ socketPath: directSocketPath, path, method, body, timeoutMs })
  await sleep(CALIBRATION_SPACING_MS)
  const c3 = await rawRequest({ socketPath: directSocketPath, path, method, body, timeoutMs })
  const j1 = safeJsonParse(c1.raw)
  const j2 = safeJsonParse(c2.raw)
  const j3 = safeJsonParse(c3.raw)
  const out = new Set<string>()
  for (const p of diffVolatilePaths(j1, j2)) out.add(p)
  for (const p of diffVolatilePaths(j2, j3)) out.add(p)
  for (const p of diffVolatilePaths(j1, j3)) out.add(p)
  return out
}

/**
 * The T-02 core primitive (Fable rev 3.1 — Rulings 1 & 2). Splits by route,
 * derived from `isNativeOp()` (the same source Router.swift routes on):
 *
 * - NATIVE op (health, getPermissions, requestPermissions, listWindows,
 *   library): byte-equality vs TS is meaningless — Swift is its own
 *   contract-conformant implementation, judged by Gate A's conformance
 *   oracle. Instead assert a ROUTE FINGERPRINT on the PROXY leg only: `caller`
 *   and `deliveryPath` ABSENT (Swift's envelope never includes them —
 *   `WireProtocol.swift`'s `successEnvelope`/`errorEnvelope`), and for
 *   `health` specifically, when the response is a success with a `result`,
 *   `result.daemonVersion` ENDS WITH `-swift-g1`. A present `caller`/
 *   `deliveryPath` on the proxy leg for a native op means the op was silently
 *   proxied instead of served natively — FAIL.
 * - PROXIED op (the other 25): assert the fingerprint the OTHER way —
 *   `caller` AND `deliveryPath` PRESENT on BOTH the direct and proxy legs
 *   (the TS envelope must pass through the tunnel unchanged) — then compare
 *   the two bodies byte-equal after masking the GUARDED CALIBRATED mask
 *   (Fable rev 3.2): the deterministic `timestamp` seed UNION the per-op
 *   3-sample calibrated-volatile set, MINUS any structurally-protected path
 *   (`isStructurallyProtected` — a protected path flagged volatile is a
 *   `calibration-error:` finding, not a mask candidate). Every path actually
 *   masked is then guarded: it must be PRESENT on both legs with the SAME
 *   JSON type, or that is a FAIL (a masked field the tunnel dropped or
 *   retyped). Any residual divergent path after masking is reported by name
 *   (real, unmasked infidelity).
 *
 * Why "prime" first: T-02 requires sending the IDENTICAL request body (same
 * requestId) both directly and through the front door to the SAME backend.
 * For a single-shot mutating op (closeSession, startRecording, …) a literal
 * byte-identical replay is only comparable once the op has already
 * transitioned into its settled/idempotent state (e.g. "already closed") —
 * calling it fresh the FIRST time (success) vs a repeat (error) are not the
 * same outcome class and would falsely convict the proxy. The prime call
 * performs that one real transition and is discarded; the calls that follow
 * all observe the SAME settled backend state and so are validly comparable.
 * For naturally-idempotent ops (reads) the prime is a harmless no-op
 * duplicate. See verify-flip-suite.ts's gateBDiff() doc comment for the
 * op-ordering note (session-destroying ops run last — `lib/op-order.ts`)
 * that keeps this safe across the whole 30-op sweep on one shared backend.
 */

/** Fable rev 3.3 ruling — the single, pre-approved structural-comparison
 * exception (recordTerminal's `result.timeline` only; see
 * `DifferentialCheckResult.structuralPaths`'s doc comment for the why).
 * Asserts `result.timeline` is present, an array, non-empty, and every
 * element is an object with `event: string` and `time: number` — WITHOUT
 * comparing element VALUES between legs (a live capture's exact event
 * count/ordering is expected to vary run-to-run). A violation here is a real
 * (never maskable) failure. */
function validateRecordTerminalTimelineShape(json: unknown, leg: 'direct' | 'proxy'): string[] {
  const failures: string[] = []
  const entry = getByJsonPath(json, 'result.timeline')
  if (!entry.present) {
    failures.push(`recordTerminal structural: "result.timeline" missing on ${leg} leg`)
    return failures
  }
  const timeline = entry.value
  if (!Array.isArray(timeline)) {
    failures.push(`recordTerminal structural: "result.timeline" on ${leg} leg is not an array (got ${jsonTypeOf(timeline)})`)
    return failures
  }
  if (timeline.length < 1) {
    failures.push(`recordTerminal structural: "result.timeline" on ${leg} leg is empty (expected length >= 1)`)
    return failures
  }
  timeline.forEach((el: unknown, i: number) => {
    if (!isPlainObject(el)) {
      failures.push(`recordTerminal structural: "result.timeline[${i}]" on ${leg} leg is not an object (got ${jsonTypeOf(el)})`)
      return
    }
    if (typeof el.event !== 'string') {
      failures.push(`recordTerminal structural: "result.timeline[${i}].event" on ${leg} leg is not a string (got ${jsonTypeOf(el.event)})`)
    }
    if (typeof el.time !== 'number') {
      failures.push(`recordTerminal structural: "result.timeline[${i}].time" on ${leg} leg is not a number (got ${jsonTypeOf(el.time)})`)
    }
  })
  return failures
}

/** Whether `path` (a `diffVolatilePaths`-shaped JSON path) names `result.timeline`
 * itself or something nested under it — used to keep recordTerminal's
 * structurally-judged timeline paths OUT of the ordinary value-mask
 * reporting/byte-compare, since rev 3.3 judges them a different way (see
 * `validateRecordTerminalTimelineShape`). */
function isUnderResultTimeline(path: string): boolean {
  return path === 'result.timeline' || path.startsWith('result.timeline.') || path.startsWith('result.timeline[')
}

// ═══════════════════════════════════════════════════════════════════════════
// Fable rev 3.5 (TERMINAL) — class-pattern masks for the six-op capture/AX
// class. Ruling context: per-run 3-sample calibration is inherently
// unreliable for LOW-VARIANCE volatile fields — a fast op can return an
// identical durationMs across all 3 samples this run, then diverge ±1ms on
// the proxy leg purely from sampling noise (observed: run1 llmStep
// `result.results[0].durationMs`; run2 walkthrough `result.duration_ms`;
// different op each time — not a defect, and not something the byte tunnel
// could selectively edit). CLOSED set, do not widen: applies ONLY to `act`,
// `observe`, `snapshot`, `step`, `llmStep`, `walkthrough` — every other op
// keeps the pure calibrated byte-equality above, unchanged, because a flake
// on a DETERMINISTIC op is a real finding, never a mask candidate (this is
// the standing tunnel-fidelity proof). Patterns are anchored ONLY beneath
// `result.` — matching a structurally-protected envelope field (`ok`,
// `error.code`, `apiVersion`, `requestId`, `caller`, `deliveryPath`) would be
// a bug, never silently masked (see `isStructurallyProtected`, still
// enforced on the ordinary calibrated mask above; these patterns cannot
// reach envelope-level paths by construction — see the `tokens[0].key ===
// 'result'` anchor below).
// ═══════════════════════════════════════════════════════════════════════════

type ClassPatternClass = 'duration' | 'embedded-content' | 'temp-path'

/** The closed op scope (rev 3.5 point 1) — do not widen. */
const CLASS_PATTERN_OPS: ReadonlySet<string> = new Set([
  'act',
  'observe',
  'snapshot',
  'step',
  'llmStep',
  'walkthrough',
])

const DURATION_LEAF_KEYS: ReadonlySet<string> = new Set(['duration', 'durationMs', 'duration_ms'])

/**
 * Classifies a `diffVolatilePaths`-shaped path against the three approved
 * anchored patterns (rev 3.5 point 2). Returns the matched class, or
 * `undefined` if `path` matches none.
 *
 * - `embedded-content`: an EXACT-path match on `result.snapshot` or
 *   `result.finalSnapshot` only — never a prefix/substring match, so e.g.
 *   `result.snapshotUrl` or `result.nested.snapshot` do NOT match.
 * - `duration` / `temp-path`: the LEAF KEY at ANY depth under `result` (e.g.
 *   `result.durationMs`, `result.results[0].durationMs`,
 *   `result.results[2].screenshotPath`) — anchored by requiring the path's
 *   FIRST token to be the literal object key `result` (never a path that
 *   merely happens to contain the substring "result" elsewhere, and never a
 *   leaf living outside `result` altogether) AND requiring at least one
 *   token AFTER it (never the bare `result` path itself, which the ordinary
 *   calibrated mask already treats as structurally protected wholesale).
 *
 * No generated-id pattern here (rev 3.5 point 2: "unobserved for these six —
 * do not add it").
 */
function classifyClassPatternPath(path: string): ClassPatternClass | undefined {
  if (path === 'result.snapshot' || path === 'result.finalSnapshot') return 'embedded-content'
  const tokens = tokenizeJsonPath(path)
  if (tokens.length < 2 || tokens[0].kind !== 'key' || tokens[0].key !== 'result') return undefined
  const last = tokens[tokens.length - 1]
  if (last.kind !== 'key') return undefined
  if (DURATION_LEAF_KEYS.has(last.key)) return 'duration'
  if (last.key === 'screenshotPath') return 'temp-path'
  return undefined
}

/**
 * Enumerates every LEAF (scalar/null — never an object/array container)
 * path present in `value`, in the same dot/bracket path format
 * `diffVolatilePaths`/`getByJsonPath` already use. Used to find class-pattern
 * candidates by walking the ACTUAL response tree — independent of what the
 * 3-sample calibration happened to observe (rev 3.5 point 2: "regardless of
 * whether the per-run calibration caught them" — a duration field that
 * stayed byte-identical across all 3 calibration samples this run, then
 * diverges only against the proxy leg, must still be found and masked).
 */
function collectLeafPaths(value: unknown, prefix = ''): string[] {
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([k, v]) => collectLeafPaths(v, prefix ? `${prefix}.${k}` : k))
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => collectLeafPaths(item, `${prefix}[${i}]`))
  }
  return prefix === '' ? [] : [prefix]
}

/**
 * Rev 3.5 point 2's per-class typed guard, applied to ONE leg's resolved
 * value at a matched path. Returns `undefined` if the guard passes, else a
 * human-readable failure reason. Never throws — a caller turns a non-
 * `undefined` return into an explicit REAL FAIL entry (rev 3.5 point 3: "a
 * hit that is missing, retyped, negative (duration), or empty (string
 * classes) = REAL FAIL" — never silently masked).
 */
function classPatternGuardFailure(cls: ClassPatternClass, value: unknown): string | undefined {
  if (cls === 'duration') {
    if (typeof value !== 'number' || Number.isNaN(value)) return `expected a JSON number, got ${jsonTypeOf(value)}`
    if (value < 0) return `expected a number >= 0, got ${value}`
    return undefined
  }
  // embedded-content / temp-path: both require a non-empty JSON string.
  if (typeof value !== 'string') return `expected a non-empty string, got ${jsonTypeOf(value)}`
  if (value.length === 0) return 'expected a non-empty string, got ""'
  return undefined
}

export async function runDifferentialCheck(
  directSocketPath: string,
  proxySocketPath: string,
  opts: {
    label: string
    path: string
    method?: 'POST' | 'GET'
    body: string
    timeoutMs?: number
    /** Fable rev 3.4 hygiene fix: overrides the reported `mode` label only
     * (never the computation branch, which still runs off `isNativeOp(op)`
     * exactly as before) — used by the T-07 wire-edge probes, which target
     * `health` (native) as a harmless carrier for envelope-validation edges,
     * not a health-op fingerprint check. See `DifferentialCheckResult.mode`'s
     * doc comment. */
    modeOverride?: 'wire-edge'
    /** Advisor ruling 2 (docs/plans/m3-g2-vb-advisor-ruling-2.md, Item 1;
     * evidence g2-chain3.log:1011) — SG-2 APPEND-ONLY opt-in, never
     * generalized beyond its one authorized caller (verify-flip-suite.ts
     * passing this for `op === 'createSession'` only). When passed AND the
     * 4 responses (3 direct calibration + 1 proxy) do not all agree on
     * ok-ness, the ordinary status-equality / masked-byte-equality /
     * masked-path-presence checks are replaced by the ruling's floor
     * (fingerprint presence on both legs stays via the existing checks;
     * per-response envelope + status<->ok coherence; error.code taxonomy
     * membership; latency-parity + content-type equality stay) and a
     * `real-chrome-stateful` divergence event is persisted on the returned
     * result's `okDivergenceEvent` for the caller's masks ledger. When all
     * four responses AGREE on ok-ness, the existing full masked byte-diff
     * runs UNCHANGED. Default (option absent) is byte-identical to every
     * existing caller — the G1 regression contract stays literally true. */
    okDivergenceClass?: 'real-chrome-stateful'
  },
): Promise<DifferentialCheckResult> {
  const { label, path, method = 'POST', body, timeoutMs = 30_000, modeOverride, okDivergenceClass } = opts
  const op = deriveOpFromPath(path)
  const native = isNativeOp(op)

  await rawRequest({ socketPath: directSocketPath, path, method, body, timeoutMs }).catch(() => undefined)

  const failures: string[] = []
  let directElapsedMs: number
  let proxyElapsedMs: number
  let directJson: unknown
  let proxyJson: unknown
  let calibratedVolatilePaths: string[] = []
  let appliedMaskPaths: string[] = []
  let structuralPaths: Array<{ path: string; class: string }> = []
  let classPatternPaths: Array<{ path: string; class: string }> = []
  let okDivergenceEvent: DifferentialCheckResult['okDivergenceEvent']

  if (native) {
    // Native ops: no calibration/byte-equality needed — only the fingerprint
    // on the proxy leg matters. Still fetch one direct sample for the
    // status/content-type/latency/error-provenance checks shared with the
    // proxied branch below.
    const d = await rawRequest({ socketPath: directSocketPath, path, method, body, timeoutMs })
    const p = await rawRequest({ socketPath: proxySocketPath, path, method, body, timeoutMs })
    directElapsedMs = d.elapsedMs
    proxyElapsedMs = p.elapsedMs
    directJson = safeJsonParse(d.raw)
    proxyJson = safeJsonParse(p.raw)

    if (d.status !== p.status) failures.push(`status: direct=${d.status} proxy=${p.status}`)
    const directCT = d.headers['content-type'] ?? '<none>'
    const proxyCT = p.headers['content-type'] ?? '<none>'
    if (directCT !== proxyCT) failures.push(`content-type: direct="${directCT}" proxy="${proxyCT}"`)

    if (isPlainObject(proxyJson)) {
      if ('caller' in proxyJson) {
        failures.push(`route fingerprint: native op "${op}" proxy leg has "caller" present — was it silently proxied?`)
      }
      if ('deliveryPath' in proxyJson) {
        failures.push(`route fingerprint: native op "${op}" proxy leg has "deliveryPath" present — was it silently proxied?`)
      }
      if (op === 'health' && proxyJson.ok === true && isPlainObject(proxyJson.result)) {
        const daemonVersion = proxyJson.result.daemonVersion
        if (typeof daemonVersion !== 'string' || !daemonVersion.endsWith('-swift-g1')) {
          failures.push(
            `route fingerprint: health proxy leg result.daemonVersion="${String(daemonVersion)}" does not end with "-swift-g1"`,
          )
        }
      }
    } else {
      failures.push(`route fingerprint: native op "${op}" proxy leg body did not parse as a JSON object`)
    }
  } else {
    // Proxied ops: fingerprint the OTHER way (both legs must carry the TS
    // envelope's caller/deliveryPath through unchanged), then byte-equal
    // after masking only the top-level timestamp value.
    const c1 = await rawRequest({ socketPath: directSocketPath, path, method, body, timeoutMs })
    await sleep(CALIBRATION_SPACING_MS)
    const c2 = await rawRequest({ socketPath: directSocketPath, path, method, body, timeoutMs })
    await sleep(CALIBRATION_SPACING_MS)
    const c3 = await rawRequest({ socketPath: directSocketPath, path, method, body, timeoutMs })
    const p = await rawRequest({ socketPath: proxySocketPath, path, method, body, timeoutMs })

    const j1 = safeJsonParse(c1.raw)
    const j2 = safeJsonParse(c2.raw)
    const pJson = safeJsonParse(p.raw)
    directJson = j2
    proxyJson = pJson
    directElapsedMs = c2.elapsedMs
    proxyElapsedMs = p.elapsedMs

    const j3 = safeJsonParse(c3.raw)
    const calibrated = new Set<string>()
    for (const dp of diffVolatilePaths(j1, j2)) calibrated.add(dp)
    for (const dp of diffVolatilePaths(j2, j3)) calibrated.add(dp)
    for (const dp of diffVolatilePaths(j1, j3)) calibrated.add(dp)
    calibratedVolatilePaths = [...calibrated].sort()

    // Guard #2 (Fable rev 3.2): a calibrated-volatile path that names a
    // structurally-protected field is a calibration ERROR, not a maskable
    // path — report it distinctly and keep it OUT of the applied mask (the
    // byte compare below still runs on it, which will likely also surface a
    // NAMED DIVERGENCE — both findings are informative, neither is dropped).
    const protectedButFlagged = calibratedVolatilePaths.filter((path) => isStructurallyProtected(path))
    for (const path of protectedButFlagged) {
      failures.push(`calibration-error: ${path} is structurally protected but flagged volatile`)
    }

    // Guard #1 (Fable rev 3.2): the mask actually applied is the
    // deterministic seed UNION calibrated-volatile, MINUS protected paths.
    // Rev 3.3 addendum: for recordTerminal, any calibrated-volatile path
    // under `result.timeline` is excluded here too — it is judged
    // STRUCTURALLY below (`validateRecordTerminalTimelineShape`), not by
    // value-masking-then-byte-compare, so it must never appear as an
    // ordinary applied-mask entry.
    const appliedMask = new Set<string>(PROXIED_OP_MASK)
    for (const path of calibratedVolatilePaths) {
      if (isStructurallyProtected(path)) continue
      if (op === 'recordTerminal' && isUnderResultTimeline(path)) continue
      appliedMask.add(path)
    }
    appliedMaskPaths = [...appliedMask].sort()

    // Fable rev 3.5 (TERMINAL) — class-pattern masks, six-op closed set
    // ONLY (see the block doc comment above `classifyClassPatternPath`).
    // Kept in a SEPARATE mask set (`classPatternMask`), never folded into
    // `appliedMask`/`appliedMaskPaths` above — the ledger persists these
    // distinctly as `mode: "class-pattern"` entries (rev 3.5 point 3), never
    // merged with the ordinary calibrated-mask reporting. Candidates are
    // found by walking BOTH legs' actual response trees (not the calibration
    // output) so a low-variance field that happened not to drift across the
    // 3 calibration samples THIS run is still matched and masked.
    const classPatternMask = new Set<string>()
    if (CLASS_PATTERN_OPS.has(op)) {
      const candidatePaths = new Set<string>([...collectLeafPaths(j2), ...collectLeafPaths(pJson)])
      const matched = [...candidatePaths]
        .map((p) => ({ path: p, cls: classifyClassPatternPath(p) }))
        .filter((m): m is { path: string; cls: ClassPatternClass } => m.cls !== undefined)
        .sort((a, b) => a.path.localeCompare(b.path))

      for (const { path, cls } of matched) {
        const dEntry = getByJsonPath(j2, path)
        const pEntry = getByJsonPath(pJson, path)
        if (!dEntry.present || !pEntry.present) {
          const missingLegs = [!dEntry.present ? 'direct' : null, !pEntry.present ? 'proxy' : null]
            .filter((v): v is string => v !== null)
            .join('+')
          failures.push(
            `class-pattern (${cls}) path "${path}" on op "${op}" missing on ${missingLegs} leg — REAL FAIL, not masked (rev 3.5 point 3)`,
          )
          continue
        }
        const dGuardFail = classPatternGuardFailure(cls, dEntry.value)
        const pGuardFail = classPatternGuardFailure(cls, pEntry.value)
        if (dGuardFail !== undefined || pGuardFail !== undefined) {
          failures.push(
            `class-pattern (${cls}) path "${path}" on op "${op}" failed its typed guard — ` +
              `direct: ${dGuardFail ?? 'ok'}; proxy: ${pGuardFail ?? 'ok'} — REAL FAIL, not masked (rev 3.5 point 3)`,
          )
          continue
        }
        classPatternMask.add(path)
        classPatternPaths.push({ path, class: cls })
      }
    }

    // Fable rev 3.3 ruling — the recordTerminal live-capture exception
    // (pre-approved for this ONE path on this ONE op only; never generalize
    // to other ops). `result.timeline` is asserted structurally-valid on
    // BOTH legs independently — a shape violation is a real, never-maskable
    // failure — and is entirely excluded from the byte compare below rather
    // than value-masked. `replayTerminal` is deliberately NOT included: it
    // replays a fixed cast and stays fully byte-compared.
    if (op === 'recordTerminal') {
      for (const f of validateRecordTerminalTimelineShape(j2, 'direct')) failures.push(f)
      for (const f of validateRecordTerminalTimelineShape(pJson, 'proxy')) failures.push(f)
      structuralPaths = [{ path: 'result.timeline', class: 'generated-recording-content' }]
    }

    // Advisor ruling 2 (docs/plans/m3-g2-vb-advisor-ruling-2.md, Item 1) —
    // computed unconditionally (cheap) so every gated block below shares one
    // source of truth; harmless/inert whenever `okDivergenceClass` is
    // undefined (the default — every existing caller stays on the ordinary
    // path). "Agree on ok-ness" = all 4 responses (3 direct calibration + 1
    // proxy) parse as an object with the SAME boolean `ok` value.
    const okOfLeg = (json: unknown): boolean | undefined =>
      isPlainObject(json) && typeof json.ok === 'boolean' ? json.ok : undefined
    const legOkValues = [okOfLeg(j1), okOfLeg(j2), okOfLeg(j3), okOfLeg(pJson)]
    const okAgree = legOkValues.every((v) => v === legOkValues[0])
    const divergenceFloorFires = okDivergenceClass !== undefined && !okAgree

    if (!divergenceFloorFires) {
      if (c2.status !== p.status) failures.push(`status: direct=${c2.status} proxy=${p.status}`)
    }
    // status-equality is replaced (not just skipped) by the floor's per-leg
    // status<->ok coherence check below when `divergenceFloorFires` — a real
    // ok-ness flip (e.g. 500 vs 200) is the EXPECTED shape of this class of
    // divergence, not itself a fail.
    const directCT = c2.headers['content-type'] ?? '<none>'
    const proxyCT = p.headers['content-type'] ?? '<none>'
    if (directCT !== proxyCT) failures.push(`content-type: direct="${directCT}" proxy="${proxyCT}"`)

    for (const [leg, json] of [
      ['direct', j2],
      ['proxy', pJson],
    ] as const) {
      if (!isPlainObject(json)) {
        failures.push(`route fingerprint: proxied op "${op}" ${leg} leg body did not parse as a JSON object`)
        continue
      }
      if (!('caller' in json)) failures.push(`route fingerprint: proxied op "${op}" ${leg} leg is missing "caller" (TS envelope not passed through)`)
      if (!('deliveryPath' in json)) {
        failures.push(`route fingerprint: proxied op "${op}" ${leg} leg is missing "deliveryPath" (TS envelope not passed through)`)
      }
      if (!('timestamp' in json)) failures.push(`route fingerprint: proxied op "${op}" ${leg} leg is missing "timestamp"`)
    }

    if (divergenceFloorFires) {
      // Advisor ruling 2 (docs/plans/m3-g2-vb-advisor-ruling-2.md, Item 1;
      // evidence g2-chain3.log:1011) — the masked-path-presence guard and the
      // masked byte-diff above both PRESUME a deterministic backend (an
      // error-leg envelope and a success-leg envelope have different shapes
      // by construction, so "byte-equal after masking" is not a meaningful
      // comparison here). Replaced by the ruling's floor: per-response
      // envelope validity + status<->ok coherence, and — for any error leg —
      // error.code taxonomy membership. Fingerprint presence (both legs,
      // above), content-type equality (above), and latency-parity (below)
      // still apply unconditionally.
      const declaredCodes = declaredErrorCodesFor(op)
      const legs: Array<{ leg: string; status: number; json: unknown }> = [
        { leg: 'direct-1', status: c1.status, json: j1 },
        { leg: 'direct-2', status: c2.status, json: j2 },
        { leg: 'direct-3', status: c3.status, json: j3 },
        { leg: 'proxy', status: p.status, json: pJson },
      ]
      const failedLegs: string[] = []
      for (const { leg, status, json } of legs) {
        if (!isPlainObject(json)) {
          failures.push(`okDivergence(${op}): ${leg} leg body did not parse as a JSON object`)
          failedLegs.push(leg)
          continue
        }
        const legOk = json.ok
        if (typeof legOk !== 'boolean') {
          failures.push(`okDivergence(${op}): ${leg} leg is missing a boolean "ok" field`)
          failedLegs.push(leg)
          continue
        }
        const isSuccessStatus = status >= 200 && status < 300
        if (legOk !== isSuccessStatus) {
          failures.push(`okDivergence(${op}): ${leg} leg status=${status} but ok=${legOk} (status<->ok incoherent)`)
          failedLegs.push(leg)
          continue
        }
        if (legOk === false) {
          const code = isPlainObject(json.error) ? (json.error as { code?: unknown }).code : undefined
          if (typeof code !== 'string' || !declaredCodes.includes(code)) {
            failures.push(
              `okDivergence(${op}): ${leg} leg error.code=${String(code)} is not in "${op}"'s declared errorCodes [${declaredCodes.join(', ')}]`,
            )
            failedLegs.push(leg)
          }
        }
      }
      // Ledger visibility (floor point 6): a PERSISTENT one-sided pattern
      // (e.g. proxy leg always failing while direct passes, across chains)
      // must stay visible to the caller's masks ledger as a finding, never
      // silently absorbed — this event is reported regardless of whether any
      // `failures` entry was also pushed above.
      okDivergenceEvent = {
        // Non-null: `divergenceFloorFires` is only true when
        // `okDivergenceClass !== undefined` (see its definition above); TS's
        // control-flow analysis doesn't narrow through the derived boolean.
        class: okDivergenceClass!,
        op,
        responses: legs.map(({ leg, status, json }) => ({ leg, status, ok: okOfLeg(json) })),
        failedLegs,
      }
    } else {
      // Guard #1 continued (Fable rev 3.2): every masked path must be PRESENT
      // on both legs with the SAME JSON type — a masked field the tunnel
      // dropped or retyped is a FAIL, not a silent pass-through of the mask.
      for (const path of appliedMaskPaths) {
        const dEntry = getByJsonPath(j2, path)
        const pEntry = getByJsonPath(pJson, path)
        if (!dEntry.present || !pEntry.present) {
          const missingLegs = [!dEntry.present ? 'direct' : null, !pEntry.present ? 'proxy' : null]
            .filter((v): v is string => v !== null)
            .join('+')
          failures.push(`masked path "${path}" missing on ${missingLegs} leg — masked field dropped through the tunnel`)
          continue
        }
        const dType = jsonTypeOf(dEntry.value)
        const pType = jsonTypeOf(pEntry.value)
        if (dType !== pType) {
          failures.push(`masked path "${path}" type mismatch: direct=${dType} proxy=${pType} — masked field retyped through the tunnel`)
        }
      }

      // Byte-compare mask (local to this step only — NOT reported as part of
      // `appliedMaskPaths`): the ordinary value-mask set UNION, for
      // recordTerminal only, the whole `result.timeline` subtree — excluded
      // from the byte compare entirely because it is judged structurally
      // above, not by masked-value equality.
      const byteCompareMask = new Set(appliedMask)
      if (op === 'recordTerminal') byteCompareMask.add('result.timeline')
      // Fable rev 3.5: class-pattern-masked paths (six-op closed set) are
      // additive to the calibrated mask above, applied to the byte compare
      // here but reported to the ledger as their OWN `classPatternPaths` field
      // (see return value below), never merged into `appliedMaskPaths`.
      for (const path of classPatternMask) byteCompareMask.add(path)

      const maskedDirectObj = maskPaths(j2, byteCompareMask)
      const maskedProxyObj = maskPaths(pJson, byteCompareMask)
      const residualDivergence = diffVolatilePaths(maskedDirectObj, maskedProxyObj)
      if (residualDivergence.size > 0) {
        const maskedDirect = canonicalJson(maskedDirectObj)
        const maskedProxy = canonicalJson(maskedProxyObj)
        failures.push(
          `NAMED DIVERGENCE (outside the applied mask, presumed real proxy infidelity) on ` +
            `[${[...residualDivergence].sort().join(', ')}]: ` +
            `direct=${maskedDirect.slice(0, 400)} proxy=${maskedProxy.slice(0, 400)}`,
        )
      }
    }
  }

  if (proxyElapsedMs > directElapsedMs + 2000) {
    failures.push(`latency parity violated: direct=${directElapsedMs}ms proxy=${proxyElapsedMs}ms (bound: direct+2000ms)`)
  }
  const directErrorCode =
    isPlainObject(directJson) && directJson.ok === false && isPlainObject(directJson.error)
      ? (directJson.error as { code?: unknown }).code
      : undefined
  const proxyErrorCode =
    isPlainObject(proxyJson) && proxyJson.ok === false && isPlainObject(proxyJson.error)
      ? (proxyJson.error as { code?: unknown }).code
      : undefined
  if (proxyErrorCode === 'internal_error' && directErrorCode !== 'internal_error') {
    failures.push(
      `error-provenance: proxy returned internal_error but direct returned ` +
        `${directErrorCode === undefined ? '(ok:true)' : String(directErrorCode)} — proxy-synthesized error`,
    )
  }

  return {
    op: label,
    ok: failures.length === 0,
    detail: failures.join(' | '),
    directElapsedMs,
    proxyElapsedMs,
    mode: modeOverride ?? (native ? 'native-fingerprint' : 'proxied-byte-equal'),
    calibratedVolatilePaths,
    appliedMaskPaths,
    structuralPaths,
    classPatternPaths,
    okDivergenceEvent,
  }
}

export interface SseFrameParsed {
  event: string
  id: string
  data: unknown
}

/** Parses one `event: …\nid: …\ndata: {...}\n\n` SSE frame (the exact shape
 * `src/daemon/server.ts`'s `writeSse` emits). */
export function parseSseFrame(raw: string): SseFrameParsed {
  let event = ''
  let id = ''
  let dataRaw = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
    else if (line.startsWith('id:')) id = line.slice('id:'.length).trim()
    else if (line.startsWith('data:')) dataRaw += line.slice('data:'.length).trim()
  }
  let data: unknown
  try {
    data = JSON.parse(dataRaw)
  } catch {
    data = dataRaw
  }
  return { event, id, data }
}

export interface SseConnection {
  status: number
  headers: Record<string, string>
  /** The raw text of the FIRST frame only (everything up to the first blank
   * line) — the "cheap emit" trigger for T-02's smoke test is the
   * `daemon.ready` frame every `/events` subscription emits immediately on
   * connect (`src/daemon/server.ts#handleEvents`), so no separate trigger
   * call is needed. */
  firstFrame: string
  elapsedMs: number
  /** Ends the connection from the client side. */
  close: () => void
  /** Resolves once the underlying HTTP response has actually ended/closed —
   * used to assert the tunnel does not leak the stream open after a client
   * disconnect. */
  closed: Promise<void>
}

/** Opens a GET `/events` (or `path`) connection over `socketPath` and
 * resolves as soon as the first SSE frame (up to the first blank line) has
 * arrived. Rejects if no frame arrives within `timeoutMs`. */
export function openSseConnection(opts: {
  socketPath: string
  path?: string
  timeoutMs?: number
}): Promise<SseConnection> {
  const { socketPath, path = '/api/v1/events', timeoutMs = 10_000 } = opts
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const req = httpRequest({ socketPath, path, method: 'GET', headers: { host: 'spectra.local' } }, (res) => {
      const headers = flattenHeaders(res.headers)
      let buf = ''
      let resolved = false
      let closedResolve = () => {}
      const closed = new Promise<void>((r) => {
        closedResolve = r
      })
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8')
        const frameEnd = buf.indexOf('\n\n')
        if (frameEnd !== -1 && !resolved) {
          resolved = true
          resolve({
            status: res.statusCode ?? 0,
            headers,
            firstFrame: buf.slice(0, frameEnd),
            elapsedMs: Date.now() - started,
            close: () => req.destroy(),
            closed,
          })
        }
      })
      res.on('end', () => closedResolve())
      res.on('close', () => closedResolve())
      // SSE responses never naturally 'end' (the server holds the stream
      // open indefinitely) — an unhandled 'error' directly on the
      // IncomingMessage (e.g. the peer resetting the connection while this
      // stream is still open, the exact M3.G1 teardown-crash scenario) would
      // otherwise crash the process the same way an unguarded raw Socket
      // error does. Same benign-teardown/loud-otherwise policy as
      // `guardSocketTeardownErrors` below.
      res.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
          console.warn(`[front-door] benign teardown response error on SSE ${path}: ${err.code}`)
          closedResolve()
          return
        }
        console.error(`[front-door] UNEXPECTED response error on SSE ${path} (not rethrown):`, err)
        closedResolve()
      })
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`SSE connection did not receive a frame within ${timeoutMs}ms (${path})`))
    })
    req.on('error', reject)
    guardSocketTeardownErrors(req, `SSE ${path}`)
    req.end()
  })
}

/**
 * T-02's `/events` SSE smoke check: subscribes direct twice (calibration —
 * `daemon.ready`'s `pid`/`emittedAt`/`eventId` differ run-to-run and get
 * masked exactly like the request/response path above), subscribes through
 * the proxy once, and asserts the masked frames match plus status/
 * Content-Type parity. Then closes the proxy connection from the client side
 * and asserts the tunnel actually ends the stream within a bounded window
 * (proves the tunnel does not leak a half-open stream on disconnect).
 *
 * Documented gap: this exercises CLIENT-initiated close propagation only.
 * Killing the shared backend mid-stream to exercise BACKEND-initiated close
 * propagation would tear down the same backend every other T-02 probe in
 * this gate run still needs, so it is deliberately out of scope for this
 * smoke check (not silently dropped — flagged here and in the S4 return).
 */
export async function sseSmoke(directSocketPath: string, proxySocketPath: string): Promise<{ ok: boolean; detail: string }> {
  const failures: string[] = []

  const d1 = await openSseConnection({ socketPath: directSocketPath })
  d1.close()
  const d2 = await openSseConnection({ socketPath: directSocketPath })
  const p = await openSseConnection({ socketPath: proxySocketPath })

  if (d2.status !== p.status) failures.push(`SSE status: direct=${d2.status} proxy=${p.status}`)
  const directCT = d2.headers['content-type'] ?? '<none>'
  const proxyCT = p.headers['content-type'] ?? '<none>'
  if (directCT !== proxyCT) failures.push(`SSE content-type: direct="${directCT}" proxy="${proxyCT}"`)

  const d1Frame = parseSseFrame(d1.firstFrame)
  const d2Frame = parseSseFrame(d2.firstFrame)
  const pFrame = parseSseFrame(p.firstFrame)
  if (d2Frame.event !== pFrame.event) failures.push(`SSE event name: direct="${d2Frame.event}" proxy="${pFrame.event}"`)

  const volatilePaths = diffVolatilePaths(d1Frame.data, d2Frame.data)
  const maskedDirect = canonicalJson(maskPaths(d2Frame.data, volatilePaths))
  const maskedProxy = canonicalJson(maskPaths(pFrame.data, volatilePaths))
  if (maskedDirect !== maskedProxy) {
    failures.push(
      `SSE data mismatch after masking ${volatilePaths.size} path(s): ` +
        `direct=${maskedDirect.slice(0, 300)} proxy=${maskedProxy.slice(0, 300)}`,
    )
  }

  p.close()
  const closeOutcome = await Promise.race([
    p.closed.then(() => 'closed' as const),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5_000)),
  ])
  if (closeOutcome !== 'closed') {
    failures.push('proxy /events stream did not close within 5s of client disconnect (possible tunnel leak/hang)')
  }

  // Teardown cleanliness (M3.G1 EPIPE postmortem): `d2` (the second direct
  // calibration connection) was previously left open here — its socket
  // outlived this function, still connected to the harness backend, with no
  // caller left to observe it. When `startFrontDoorHarness().close()` later
  // SIGTERMs that backend subprocess, the dangling connection's peer
  // disappears mid-stream and (pre-fix) could crash the process with an
  // unhandled EPIPE/ECONNRESET. Close it from the client side and wait
  // (briefly, best-effort) for it to actually finish tearing down before this
  // function returns, so no SSE connection this smoke check opened is still
  // live once the caller moves on. `d1` was already closed above, immediately
  // after its first frame.
  d2.close()
  await Promise.race([d2.closed, new Promise<void>((resolve) => setTimeout(resolve, 2_000))])

  return { ok: failures.length === 0, detail: failures.join(' | ') }
}
