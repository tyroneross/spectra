// macos/Spectra/DaemonCore/verify-flip-suite.ts
//
// M3.G1 flip acceptance harness (S4) — orchestrates Gates A-D of
// docs/plans/m3-g1-flip-plan.md's "## Verification gates (ordered)" end to
// end, headlessly, so the production topology is verifiable without a live
// launchd install (Gate E is separate — Opus-coordinated, on this machine's
// real launchd, per the plan). Also runs T-10 (the §G3 bootstrap-guard
// regression, Q-01) — not one of the lettered gates, but S4-owned and has no
// other home.
//
// Run: npx tsx macos/Spectra/DaemonCore/verify-flip-suite.ts
//
// Gate order (rev 3 — Gate redesign, docs/plans/m3-g1-flip-plan.md "## Gate
// redesign rev 3"): A → B-diff (T-02) → B2 (T-02b) → B-e2e (T-02c) → C (T-04)
// → D (T-03). B-diff runs BEFORE B2/B-e2e/C/D and, if it CONVICTS the proxy
// (a proxy-synthesized `internal_error` or a latency-parity blowout), main()
// stops early — the rev-3 handoff's sequencing rule: an S1 ProxyClient fix
// is needed before investing in T-02c, not a gate-design question.
//
// Gates covered here:
//   A  — native-G1 oracle regression (T-01): explicit all-11-native routing +
//        SPECTRA_STANDALONE_SESSION_OPS=1 (rev 3: Router.swift now REQUIRES
//        this explicit opt-in for standalone session-coupled-native boots —
//        see the S1 backend-aware fail-closed rule), SPECTRA_CONFORMANCE_SEED=1
//        + SEED_SESSION=conformance-seed, full conformance+corpus suite
//        pointed at the Swift daemon (skip-list stays at its DEFAULT G1-only
//        allowlist — NOT proxy-fidelity mode — so only the 11 G1 ops run,
//        matching "≥22 passed / 0 failed"); plus the legacy
//        verify-g1-suite.ts / verify-swift-op.ts scripts, updated (rev 3) to
//        set the same standalone opt-in flag so they stay green under the
//        corrected Router rule. C8 (2026-07-03): corpus.test.ts is RE-ADDED
//        here as a separate run, byte-regressing the 5 natively-routed ops
//        (health/getPermissions/requestPermissions/listWindows/library)
//        against a Swift-RECORDED corpus (swift-native-corpus.json, NOT
//        golden-corpus.json — see gateA()'s inline reconciliation note and
//        tests/conformance/corpus/record-corpus.ts's SPECTRA_CORPUS_TARGET=
//        swift-native mode). Every other corpus.test.ts entry is SKIPPED
//        (no valid Swift-recorded corpus for it yet), so Gate A stays green.
//   B-diff (T-02) — differential byte-transparency (rev 3, Ruling 1):
//        tests/conformance/lib/front-door.ts's two-daemon harness (backend X
//        = the harness's own seeded TS daemon, front door Y = Swift under
//        PRODUCTION routing). For every one of the 30 spec ops + the T-07
//        wire edges + one unknown-route probe, sends the identical request
//        body/requestId (a) DIRECT to X and (b) through Y to that SAME X,
//        self-calibrating a volatility mask from two direct runs, then
//        asserting masked-byte-equal bodies + equal status/Content-Type + a
//        latency-parity bound (proxy ≤ direct+2s) + an error-provenance check
//        (proxy-only internal_error = FAIL) + an /events SSE smoke. Replaces
//        the old "point the full suite at the front door, require absolute
//        success" design (Ruling 1) — success is NOT required, transparency
//        is. Backend socket mode-0600 assertion happens inside
//        front-door.ts's own boot step (unchanged).
//   B2 — fail-closed routing (T-02b, rev 3 falsifiers): (i) backend
//        configured + flag set + session-op-native → still refuses; (ii) no
//        backend + no flag + session-op-native → refuses; (iii) no backend +
//        flag set → boots (the Gate A/C regression recipe).
//   B-e2e (T-02c, rev 3, Ruling 1) — measured-equality end-to-end: runs the
//        conformance+corpus suite (full assertions — SPECTRA_CONFORMANCE_
//        PROXY_FIDELITY=1 turns off the external skip-list on BOTH legs)
//        DIRECT against the harness backend, records the per-test result
//        set, reruns identically THROUGH the front door, and asserts
//        RESULT-SET EQUALITY. Both-ways failures go to an excluded-set
//        report (backend capability limits — logged for Fable review, not a
//        gate failure); direct-pass/proxy-fail is the only failure mode.
//        Replaces the old "skip-list disabled, 170/170 absolute" design.
//   C  — capability gate external (T-04, rev 3 scoping — Ruling 3): explicit
//        all-11-native routing + SPECTRA_STANDALONE_SESSION_OPS=1, SPECTRA_
//        CONFORMANCE_UNIX_CAPS restricted to ["daemon:read"],
//        capability-gate.test.ts run externally behind SPECTRA_CONFORMANCE_
//        EXTERNAL_CAPS_HONORED=1. capability-gate.test.ts itself now scopes
//        expectations by registration (11 registered ops → strict
//        capability_denied pattern; unregistered ops → exactly not_found).
//   D  — mutation spot-checks (T-03): (1) routing-table-bites — automated
//        here: mark `health` NOT native with no reachable backend, assert the
//        live call goes RED (daemon_unhealthy), then restore and assert
//        GREEN. (2) CapabilityPolicy-call-removal — NOT automatable from this
//        file: it requires transiently editing macos/Spectra/DaemonCore/
//        Router.swift (S1-owned, pin-protected — this agent must never edit
//        it). Printed as an explicit MANUAL gate, not silently skipped; S1/
//        Opus must execute it once at integration (comment out the
//        `CapabilityPolicy.shared.assert` call in Router.swift, confirm T-04
//        goes RED, then revert and confirm GREEN again).
//
// ─── Oracle-semantics note (rev 3 — RESOLVED) ──────────────────────────────
// Gates A/C boot a STANDALONE Swift binary with an explicit all-11-native
// SPECTRA_ROUTING_CONFIG and deliberately NO `SPECTRA_PROXY_BACKEND_SOCKET`
// — the literal "T-01 recipe" (rev-2 note #6, T-01's pass condition). The
// rev-2 ambiguity this comment used to flag (would D-01's fail-closed
// denylist refuse this legacy all-11-native config too?) is resolved by S1's
// rev-3 Router.swift: the denylist only fires when a proxy backend is
// configured OR `SPECTRA_STANDALONE_SESSION_OPS` is unset (confirmed by
// reading Router.swift directly — `loadConfig`'s `hasProxyBackend ||
// !standaloneOptIn` guard). Gates A/C now set that flag explicitly (see
// their boot envs below) — this is falsifier (iii) from T-02b, not a
// separate risk.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { randomUUID } from 'node:crypto'
import { execFileSync, spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable } from 'node:stream'
import { callOperation } from '../../../tests/conformance/lib/socket-client.js'
import { apiResponseEnvelopeSchema } from '../../../src/contract/schemas.js'
import { API_VERSION } from '../../../src/contract/wire.js'
import type { EnrichedContractSpec } from '../../../src/contract/enriched-spec.js'
import type { DaemonEndpoint } from '../../../tests/conformance/lib/daemon-endpoint.js'
import { assertSocketMode0600 } from '../../../tests/conformance/lib/daemon-endpoint.js'
import {
  startFrontDoorHarness,
  productionRoutingConfig,
  resolveDaemonCoreDir,
  runDifferentialCheck,
  sseSmoke,
  isNativeOp,
  type DifferentialCheckResult,
} from '../../../tests/conformance/lib/front-door.js'
import { buildFixtureContext, withSessionOverride } from '../../../tests/conformance/lib/fixture-context.js'
import { validPayloads } from '../../../tests/conformance/lib/payload-generator.js'
import { orderedOperationNames } from '../../../tests/conformance/lib/op-order.js'
import { spawnDaemonBootstrap, resolveFlipTopologyPlistPath } from '../../../src/client/bootstrap.js'

// Narrow backstop for the M3.G1 EPIPE teardown crash (see front-door.ts's
// `guardSocketTeardownErrors`/SSE-response-error postmortem comments for the
// root cause this primarily fixes). This orchestrator also spawns/kills
// several other daemon subprocesses across Gates A/B2/C/D whose client
// sockets live in files outside this agent's owned set (e.g.
// tests/conformance/lib/daemon-endpoint.ts, socket-client.ts) — this repo
// does not have every one of those sockets individually audited/guarded, so
// this is a deliberately NARROW, clearly-scoped safety net: it ONLY swallows
// a benign EPIPE/ECONNRESET write/read failure (the exact signature of a
// socket whose peer process was already killed during a gate's own
// teardown), and rethrows (crashes, as before) anything else. This must
// never become a general-purpose error suppressor — if this fires for a
// NON-benign reason, the fix is to find and guard that specific socket, not
// to widen this handler.
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if ((err.code === 'EPIPE' || err.code === 'ECONNRESET') && err.syscall === 'write') {
    console.warn(
      `[verify-flip-suite] backstop: ignoring benign teardown-phase ${err.code} on a socket write ` +
        `(peer process already gone) — see front-door.ts's guardSocketTeardownErrors for the primary fix.`,
    )
    return
  }
  // Anything else: preserve the original crash-on-uncaught-exception
  // semantics (log + nonzero exit) rather than silently hanging — merely
  // registering this listener suppresses Node's default auto-exit behavior,
  // so a non-benign error must still terminate the process explicitly.
  console.error(err)
  process.exit(1)
})

// Same narrow backstop, for the promise-rejection path (Node crashes on an
// unhandled rejection by default too, separately from 'uncaughtException') —
// a benign teardown-phase EPIPE/ECONNRESET surfaced as a rejected Promise
// rather than an EventEmitter 'error' would otherwise still kill the whole
// chain the same way. Same non-benign-rethrows-as-a-crash policy as above.
process.on('unhandledRejection', (reason) => {
  const err = reason as NodeJS.ErrnoException
  if (err && (err.code === 'EPIPE' || err.code === 'ECONNRESET')) {
    console.warn(`[verify-flip-suite] backstop: ignoring benign teardown-phase unhandled rejection ${err.code}.`)
    return
  }
  console.error(reason)
  process.exit(1)
})

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const daemonCoreDir = resolveDaemonCoreDir()
const vitestBin = join(repoRoot, 'node_modules', '.bin', 'vitest')
const tsxBin = join(repoRoot, 'node_modules', '.bin', 'tsx')

// The G1 seed recipe REQUIRED pair (docs/plans/m3-g1-flip-plan.md's Env
// Contract table: "missing SEED_SESSION false-REDs D1"). HARD-CODED here —
// never left for a caller of this script to forget — and used ONLY for the
// gates that boot a STANDALONE Swift daemon self-seeding via
// SPECTRA_CONFORMANCE_SEED=1 (Gates A and C). Gate B does NOT set this: its
// backend is a real TS daemon reachable through the tunnel, so the suite's
// normal Tier-1 wire-seeding path (real `createSession` calls) is what
// should run there — setting SEED_SESSION for Gate B would instead point
// every session-dependent op at a session id ('conformance-seed') that does
// not exist in the TS backend's SessionManager, false-REDing T-02 instead of
// fixing it.
const SEED_SESSION = 'conformance-seed'

const ALL_11_NATIVE_ROUTING_CONFIG = {
  version: 1,
  native: [
    'health',
    'getPermissions',
    'requestPermissions',
    'listWindows',
    'library',
    'listSessions',
    'getSession',
    'getRun',
    'closeSession',
    'closeAllSessions',
    'recordLlmUsage',
  ],
} as const

interface GateResult {
  gate: string
  ok: boolean | 'manual'
  detail: string
}

const results: GateResult[] = []

function record(gate: string, ok: boolean | 'manual', detail = ''): void {
  results.push({ gate, ok, detail })
  const marker = ok === 'manual' ? '○ MANUAL' : ok ? '✔' : '✗'
  console.log(`${marker} ${gate}${detail ? ' — ' + detail : ''}`)
}

function compileSwiftBinary(): { bin: string; binDir: string } {
  const swiftFiles = execFileSync('bash', ['-c', `ls ${daemonCoreDir}/*.swift`]).toString().trim().split('\n')
  const binDir = mkdtempSync(join(tmpdir(), 'spectra-flip-suite-bin-'))
  const bin = join(binDir, 'spectra-daemon-core')
  console.log('· compiling the Swift daemon-core…')
  execFileSync('swiftc', [...swiftFiles, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'] })
  console.log('  ✔ compiled')
  return { bin, binDir }
}

type DaemonProc = ChildProcessByStdio<null, Readable, Readable>

/** Spawns `bin` with `env`, waits (up to `timeoutMs`) for either the socket
 * at `sock` to appear or the process to exit early. Returns the process +
 * whatever stderr it produced so far — never throws; callers decide what
 * "success" means for their gate (a normal boot wants the socket to appear,
 * a fail-closed check WANTS early exit). */
async function bootDaemon(
  bin: string,
  sock: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 15_000,
): Promise<{ proc: DaemonProc; bound: boolean; exitCode: number | null; stderr: () => string }> {
  const proc: DaemonProc = spawn(bin, [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderrBuf = ''
  proc.stderr.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf8')
  })
  let exited: number | null | undefined
  proc.once('exit', (code) => {
    exited = code
  })

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(sock)) return { proc, bound: true, exitCode: null, stderr: () => stderrBuf }
    if (exited !== undefined) return { proc, bound: false, exitCode: exited, stderr: () => stderrBuf }
    await new Promise((r) => setTimeout(r, 100))
  }
  return { proc, bound: existsSync(sock), exitCode: exited ?? null, stderr: () => stderrBuf }
}

async function stopDaemon(proc: DaemonProc): Promise<void> {
  await new Promise<void>((resolveStop) => {
    if (proc.exitCode !== null) {
      resolveStop()
      return
    }
    proc.once('exit', () => resolveStop())
    proc.kill('SIGTERM')
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill('SIGKILL')
    }, 5_000).unref()
  })
}

function runVitest(files: string[], env: NodeJS.ProcessEnv, label: string): void {
  try {
    execFileSync(vitestBin, ['run', ...files], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    record(label, true)
  } catch (error) {
    record(label, false, error instanceof Error ? error.message : String(error))
  }
}

function runLegacyScript(scriptName: string, args: string[], label: string): void {
  try {
    execFileSync(tsxBin, [join(daemonCoreDir, scriptName), ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    record(label, true)
  } catch (error) {
    record(label, false, error instanceof Error ? error.message : String(error))
  }
}

// ─── Gate A — native-G1 oracle regression (T-01) ───────────────────────────
async function gateA(bin: string): Promise<void> {
  console.log('\n=== Gate A — native-G1 oracle regression (T-01) ===')
  const home = mkdtempSync(join(tmpdir(), 'spectra-flip-gateA-home-'))
  const sock = join(home, 'daemon.sock')
  const routingConfigPath = join(home, 'routing-config.json')
  writeFileSync(routingConfigPath, JSON.stringify(ALL_11_NATIVE_ROUTING_CONFIG, null, 2))

  const boot = await bootDaemon(bin, sock, {
    ...process.env,
    SPECTRA_DAEMON_SOCKET: sock,
    SPECTRA_CONFORMANCE_SEED: '1',
    SPECTRA_ROUTING_CONFIG: routingConfigPath,
    // rev 3: Router.swift's backend-aware fail-closed rule refuses to boot
    // any all-11-native config UNLESS this harness-only opt-in is set (no
    // SPECTRA_PROXY_BACKEND_SOCKET is set here, so this is exactly the
    // standalone regression recipe, falsifier (iii) from T-02b) — NEVER set
    // in a launchd plist (see Router.swift's own doc comment).
    SPECTRA_STANDALONE_SESSION_OPS: '1',
    HOME: home,
    SPECTRA_HOME: home,
  })

  if (!boot.bound) {
    record('Gate A: Swift daemon boot (all-11-native config)', false, `exit ${String(boot.exitCode)}; stderr: ${boot.stderr()}`)
    rmSync(home, { recursive: true, force: true })
    return
  }
  record('Gate A: Swift daemon boot (all-11-native config)', true)

  try {
    // INTEGRATOR RECONCILIATION (2026-07-03, for Fable group-verdict ratification):
    // Gate A runs conformance.test.ts (CONTRACT-level G1 regression) — corpus.test.ts
    // was REMOVED as a Swift pass/fail criterion at that time. corpus replays the byte-
    // exact response corpus RECORDED FROM THE TS DAEMON; a from-scratch Swift
    // reimplementation legitimately diverges on non-contract cosmetics (daemonVersion
    // "0.3.2" vs "0.3.2-swift-g1"; optional fields like `startedAt` that Swift omits —
    // all contract-legal, conformance = 22/0). corpus is a valid byte-regression only
    // for the SAME implementation vs its own recording; reusing the TS recording as a
    // cross-implementation gate produced 14 false positives on G1 ops.
    //
    // C8 (Fable M3.G1 follow-on, 2026-07-03) — RESTORED below: a SEPARATE corpus
    // (tests/conformance/corpus/swift-native-corpus.json), recorded from THIS SAME
    // standalone-Swift-daemon recipe (not the TS daemon), now byte-regresses the 5
    // NATIVELY-ROUTED ops (health/getPermissions/requestPermissions/listWindows/
    // library — see tests/conformance/lib/front-door.ts's PRODUCTION_ROUTING_CONFIG).
    // corpus.test.ts itself was updated (C8-owned) so that, against an EXTERNAL
    // daemon, only entries with a swift-native-corpus.json match are byte-diffed —
    // every other entry (the other 6 G1 ops + all driver/capture ops) is SKIPPED, not
    // run against golden-corpus.json, so this stays a valid same-implementation
    // regression and Gate A stays green (verified live: 14 passed / 0 failed / 63
    // skipped against a fresh standalone Swift daemon booted with this exact recipe).
    runVitest(
      ['tests/conformance/conformance.test.ts'],
      {
        ...process.env,
        SPECTRA_DAEMON_SOCKET: sock,
        SPECTRA_CONFORMANCE_SEED_SESSION: SEED_SESSION,
      },
      'Gate A: conformance suite vs Swift (contract-level G1 regression, ≥22 passed expected)',
    )
    runVitest(
      ['tests/conformance/corpus/corpus.test.ts'],
      {
        ...process.env,
        SPECTRA_DAEMON_SOCKET: sock,
        SPECTRA_CONFORMANCE_SEED_SESSION: SEED_SESSION,
      },
      'Gate A: Swift-native corpus byte-regression (C8 — 5 natively-routed ops vs swift-native-corpus.json; ' +
        'all other entries SKIPPED, no valid Swift-recorded corpus for them yet)',
    )
  } finally {
    await stopDaemon(boot.proc)
    rmSync(home, { recursive: true, force: true })
  }

  runLegacyScript('verify-g1-suite.ts', [], 'Gate A: legacy verify-g1-suite.ts (explicit all-11-native config)')
  runLegacyScript('verify-swift-op.ts', ['health', '{}'], 'Gate A: legacy verify-swift-op.ts (representative op, explicit all-11-native config)')
}

// ─── Gate B-diff — differential byte-transparency (T-02, rev 3) ───────────
//
// Op-ordering note: probes iterate via `orderedOperationNames()` (the SAME
// shared ordering conformance.test.ts/corpus/record-corpus.ts use) so the
// two session-destroying ops (closeSession, closeAllSessions) run LAST —
// after every other op's probe has already exercised the shared fixture
// sessions. Combined with `runDifferentialCheck`'s own prime→calibrate→
// compare protocol (see front-door.ts's doc comment on that function), this
// is what makes a literal identical-body 3x replay valid for stateful ops
// without per-op special-casing.
/** Render each op's Ruling-1/2 comparison mode + (for proxied ops) the
 * Ruling-2-fixed calibrated volatile set in the console report — so a run's
 * output alone shows which rule fired per op (native fingerprint vs
 * proxied byte-equal) and proves the ≥1.1s-spaced calibration converges to
 * exactly `{timestamp}` (or flags an unexpected extra volatile path for
 * follow-up) without needing to re-run anything by hand. */
function modeSuffix(result: DifferentialCheckResult): string {
  if (result.mode === 'native-fingerprint') return 'native-fingerprint'
  if (result.mode === 'wire-edge') return 'wire-edge'
  const calibrated = result.calibratedVolatilePaths
  const applied = result.appliedMaskPaths
  const asExpected = calibrated.length === 1 && calibrated[0] === 'timestamp'
  const marker = asExpected ? 'calibration OK' : calibrated.length === 0 ? 'calibration EMPTY (unexpected)' : 'calibration EXTRA-PATHS'
  return (
    `proxied-byte-equal; calibrated-volatile=[${calibrated.join(', ') || '(none)'}] (${marker}); ` +
    `applied-mask=[${applied.join(', ') || '(none)'}]`
  )
}

// ─── T-02 mask transparency (Fable rev 3.2, guard #3) ──────────────────────
// Every op's APPLIED mask (front-door.ts's `appliedMaskPaths` — the union of
// the deterministic `timestamp` seed + calibrated-volatile paths, minus any
// structurally-protected path) is persisted here so the Fable group verdict
// can classify each masked path against the allowed volatility classes
// (timestamps, durations, generated ids, temp paths, free-text messages)
// without re-running the suite. A previous file's per-op mask set is loaded
// first and diffed against the new one — mask GROWTH (a path present now
// that was not present before) is WARNed in the console report, never
// silently absorbed; it is not itself a gate failure (a legitimate new
// volatility source is expected to show up here occasionally — the WARN is
// what routes it to the Fable review, per the handoff's drift-watch clause).
const MASKS_EVIDENCE_PATH = join(repoRoot, '.build-loop', 'flip-evidence', 't02-masks.json')

interface PersistedOpMask {
  mode: DifferentialCheckResult['mode']
  calibratedVolatilePaths: string[]
  appliedMaskPaths: string[]
  /** Fable rev 3.3 ruling: paths judged by structural shape assertion
   * instead of value-masking-then-byte-compare (currently only
   * `result.timeline` on `recordTerminal`). Persisted distinctly from
   * `appliedMaskPaths` — each entry is `{ path, class }` with an explicit
   * `mode: 'structural'` tag — so the Fable group verdict's mask review can
   * tell "we compare this by shape" apart from "we compare this by masked
   * value" at a glance. Empty for every op except recordTerminal. */
  structural: Array<{ path: string; class: string; mode: 'structural' }>
  /** Fable rev 3.5 ruling (TERMINAL, six-op closed set): the RESOLVED
   * CONCRETE paths a class pattern actually matched-and-masked THIS run
   * (never the pattern text) plus their class (`duration` |
   * `embedded-content` | `temp-path`), tagged `mode: 'class-pattern'` —
   * persisted distinctly from `appliedMaskPaths` (the calibrated mask, kept
   * running as a diagnostic per rev 3.5 point 5) so the Fable group
   * verdict's review sees exactly what the class-pattern rule masked, not
   * the pattern definitions. Empty for every op outside the six-op set
   * (`act`, `observe`, `snapshot`, `step`, `llmStep`, `walkthrough`) and for
   * native ops. */
  classPattern: Array<{ path: string; class: string; mode: 'class-pattern' }>
}

function loadPreviousMasks(path: string): Record<string, PersistedOpMask> {
  if (!existsSync(path)) return {}
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Partial<PersistedOpMask>>
    const out: Record<string, PersistedOpMask> = {}
    for (const [op, entry] of Object.entries(raw)) {
      out[op] = {
        mode:
          entry.mode === 'native-fingerprint'
            ? 'native-fingerprint'
            : entry.mode === 'wire-edge'
              ? 'wire-edge'
              : 'proxied-byte-equal',
        calibratedVolatilePaths: Array.isArray(entry.calibratedVolatilePaths) ? entry.calibratedVolatilePaths : [],
        appliedMaskPaths: Array.isArray(entry.appliedMaskPaths) ? entry.appliedMaskPaths : [],
        structural: Array.isArray(entry.structural) ? entry.structural : [],
        classPattern: Array.isArray(entry.classPattern) ? entry.classPattern : [],
      }
    }
    return out
  } catch {
    // A corrupt/unreadable previous file is treated as "no baseline" — never
    // fatal to this gate; the new file below still gets written correctly.
    return {}
  }
}

/** Persists `masks` to `MASKS_EVIDENCE_PATH`, printing a per-op mask-growth
 * WARN for any op whose new applied-mask set is not a subset of its
 * previously-recorded set (a brand-new masked path since the last run). */
function persistMasksAndWarnGrowth(masks: Record<string, PersistedOpMask>): void {
  const previous = loadPreviousMasks(MASKS_EVIDENCE_PATH)
  for (const [op, entry] of Object.entries(masks)) {
    const prevSet = new Set(previous[op]?.appliedMaskPaths ?? [])
    const grown = entry.appliedMaskPaths.filter((p) => !prevSet.has(p))
    if (prevSet.size > 0 && grown.length > 0) {
      console.log(`  ⚠ mask GROWTH for "${op}": new masked path(s) [${grown.join(', ')}] not in the previous t02-masks.json — flagged for Fable review, not a gate failure`)
    }

    // Fable rev 3.5 point 3: resolved-set GROWTH for the class-pattern mask
    // (six-op closed set) — a NEW concrete path matched this run that was
    // not matched previously — prints its own non-blocking WARN, kept
    // separate from the ordinary calibrated-mask growth WARN above.
    const prevClassPatternSet = new Set((previous[op]?.classPattern ?? []).map((c) => c.path))
    const classPatternGrown = entry.classPattern.filter((c) => !prevClassPatternSet.has(c.path))
    if (prevClassPatternSet.size > 0 && classPatternGrown.length > 0) {
      console.log(
        `  ⚠ class-pattern mask GROWTH for "${op}": new resolved path(s) ` +
          `[${classPatternGrown.map((c) => `${c.path} (${c.class})`).join(', ')}] not in the previous ` +
          `t02-masks.json — flagged for Fable review, not a gate failure`,
      )
    }
  }
  mkdirSync(dirname(MASKS_EVIDENCE_PATH), { recursive: true })
  writeFileSync(MASKS_EVIDENCE_PATH, JSON.stringify(masks, null, 2))
  console.log(`\n--- Gate B-diff mask transparency: per-op applied masks written to ${MASKS_EVIDENCE_PATH} ---`)
  for (const [op, entry] of Object.entries(masks)) {
    if (entry.mode === 'native-fingerprint' || entry.mode === 'wire-edge') continue
    console.log(`  · ${op}: applied=[${entry.appliedMaskPaths.join(', ') || '(none)'}]`)
    if (entry.structural.length > 0) {
      console.log(`    structural=[${entry.structural.map((s) => `${s.path} (class: ${s.class})`).join(', ')}]`)
    }
    if (entry.classPattern.length > 0) {
      console.log(`    class-pattern=[${entry.classPattern.map((c) => `${c.path} (class: ${c.class})`).join(', ')}]`)
    }
  }
}

async function gateBDiff(): Promise<boolean> {
  console.log('\n=== Gate B-diff — differential byte-transparency (T-02) ===')
  const harness = await startFrontDoorHarness()
  record('Gate B-diff: front-door harness boot (backend 0600 asserted)', true)
  let convicted = false
  const scratchDir = mkdtempSync(join(tmpdir(), 'spectra-flip-bdiff-scratch-'))
  const masks: Record<string, PersistedOpMask> = {}
  const collectMask = (result: DifferentialCheckResult) => {
    masks[result.op] = {
      mode: result.mode,
      calibratedVolatilePaths: result.calibratedVolatilePaths,
      appliedMaskPaths: result.appliedMaskPaths,
      structural: result.structuralPaths.map((s) => ({ ...s, mode: 'structural' as const })),
      classPattern: result.classPatternPaths.map((c) => ({ ...c, mode: 'class-pattern' as const })),
    }
  }
  try {
    const fakeEndpoint: DaemonEndpoint = {
      socketPath: harness.backendSocketPath,
      sessionIds: harness.backendSessionIds,
      recordingId: harness.backendRecordingId,
      external: false,
      close: async () => {},
    }
    const genCtx = await buildFixtureContext(fakeEndpoint, scratchDir)
    const spec = JSON.parse(
      readFileSync(join(repoRoot, 'src', 'contract', 'contract.spec.json'), 'utf8'),
    ) as EnrichedContractSpec

    const noteConviction = (detail: string) => {
      if (/internal_error|latency parity violated/.test(detail)) convicted = true
    }

    // Smoke: a fast, deterministic error probe run FIRST (T-02's explicit
    // "tunnel smoke test" instruction) — getRecording against a bogus id.
    {
      const requestId = randomUUID()
      const body = JSON.stringify({
        apiVersion: API_VERSION,
        operation: 'getRecording',
        params: { recordingId: 'spectra-t02-bogus-recording-id' },
        requestId,
      })
      const result = await runDifferentialCheck(harness.backendSocketPath, harness.frontDoorSocketPath, {
        label: 'getRecording (bogus id) — tunnel smoke',
        path: '/api/v1/getRecording',
        body,
      })
      record(`Gate B-diff [smoke]: ${result.op} [${modeSuffix(result)}]`, result.ok, result.detail)
      noteConviction(result.detail)
      collectMask(result)
    }

    for (const op of orderedOperationNames(spec.operations)) {
      const opSpec = spec.operations[op]
      const payload = validPayloads(opSpec.params, genCtx)[0]
      const params = withSessionOverride(op, genCtx, payload.params)
      const requestId = randomUUID()
      const body = JSON.stringify({ apiVersion: API_VERSION, operation: op, params, requestId })
      const result = await runDifferentialCheck(harness.backendSocketPath, harness.frontDoorSocketPath, {
        label: op,
        path: `/api/v1/${op}`,
        body,
        timeoutMs: 30_000,
        // Advisor ruling 2 (docs/plans/m3-g2-vb-advisor-ruling-2.md, Item 1;
        // evidence g2-chain3.log:1011 — `direct=500 proxy=200` on the SAME TS
        // backend, a real-Chrome createSession launch flake, not a tunnel-
        // fidelity bug): createSession ONLY, scope-pinned per this ruling's
        // authorization. Every other op keeps the ordinary byte-diff.
        ...(op === 'createSession' ? { okDivergenceClass: 'real-chrome-stateful' as const } : {}),
      })
      record(
        `Gate B-diff: ${result.op} [${modeSuffix(result)}] (direct ${result.directElapsedMs}ms / proxy ${result.proxyElapsedMs}ms)`,
        result.ok,
        result.detail,
      )
      noteConviction(result.detail)
      collectMask(result)
    }

    for (const probe of buildWireEdgeProbes()) {
      const result = await runDifferentialCheck(harness.backendSocketPath, harness.frontDoorSocketPath, probe)
      record(`Gate B-diff [edge]: ${result.op} [${modeSuffix(result)}]`, result.ok, result.detail)
      noteConviction(result.detail)
      collectMask(result)
    }

    const sse = await sseSmoke(harness.backendSocketPath, harness.frontDoorSocketPath)
    record('Gate B-diff: /events SSE smoke (frame parity + close propagation)', sse.ok, sse.detail)

    persistMasksAndWarnGrowth(masks)
  } finally {
    rmSync(scratchDir, { recursive: true, force: true })
    await harness.close()
  }
  return convicted
}

/** T-07 wire-edge probes + one unknown-route probe — all target `health`
 * (a harmless, side-effect-free op) except the route itself for the last
 * one, so the probes exercise envelope-validation edges rather than any
 * particular operation's business logic. The 4 T-07 probes carry
 * `modeOverride: 'wire-edge'` (Fable rev 3.4 hygiene fix): they are wire-
 * envelope edge probes, not `health`-op fingerprint checks, even though they
 * ride the native-fingerprint computation branch (see front-door.ts's
 * `DifferentialCheckResult.mode` doc comment) — label only, no behavior
 * change. The unknown-route probe is NOT relabeled: it targets a bogus
 * operation name, is not one of the "4 T-07" probes, and its `mode` already
 * computes as `'proxied-byte-equal'` (the derived op is not in the native
 * list) — untouched. */
function buildWireEdgeProbes(): Array<{ label: string; path: string; body: string; modeOverride?: 'wire-edge' }> {
  const oversized = JSON.stringify({
    apiVersion: API_VERSION,
    operation: 'health',
    // MAX_JSON_BYTES in src/daemon/server.ts is 1MB — 2MB deliberately over.
    params: { padding: 'x'.repeat(2 * 1024 * 1024) },
    requestId: randomUUID(),
  })
  const unknownKey = JSON.stringify({
    apiVersion: API_VERSION,
    operation: 'health',
    params: { thisKeyDoesNotExistInTheSchema: true },
    requestId: randomUUID(),
  })
  const badApiVersion = JSON.stringify({ apiVersion: 999, operation: 'health', params: {}, requestId: randomUUID() })
  const missingRequestId = JSON.stringify({ apiVersion: API_VERSION, operation: 'health', params: {} })
  const unknownRoute = JSON.stringify({ apiVersion: API_VERSION, operation: 'health', params: {}, requestId: randomUUID() })

  return [
    { label: 'T-07 oversized body (>MAX_JSON_BYTES)', path: '/api/v1/health', body: oversized, modeOverride: 'wire-edge' },
    { label: 'T-07 unknown param key', path: '/api/v1/health', body: unknownKey, modeOverride: 'wire-edge' },
    { label: 'T-07 bad apiVersion', path: '/api/v1/health', body: badApiVersion, modeOverride: 'wire-edge' },
    { label: 'T-07 missing requestId', path: '/api/v1/health', body: missingRequestId, modeOverride: 'wire-edge' },
    { label: 'unknown-route probe', path: '/api/v1/spectraDoesNotExistOp', body: unknownRoute },
  ]
}

interface FlatTestResult {
  fullName: string
  status: string
}

/** Runs vitest with the JSON reporter and flattens its report into
 * `{fullName, status}` pairs — verified against the installed vitest 4.1.1
 * binary's actual `--reporter=json --outputFile=` shape (Jest-compatible:
 * `testResults[].assertionResults[]`), not assumed from memory. vitest exits
 * nonzero whenever any test fails — that is the EXPECTED case here (T-02c
 * compares result sets, it does not require either run to be all-green), so
 * only a MISSING output file (a real crash, not a test failure) is treated
 * as fatal. */
function runVitestJson(files: string[], env: NodeJS.ProcessEnv, outFile: string, extraArgs: string[] = []): FlatTestResult[] {
  try {
    // --no-file-parallelism: every runVitestJson call drives a shared EXTERNAL daemon
    // (SPECTRA_DAEMON_SOCKET), and conformance.test.ts + corpus.test.ts both mutate the
    // same daemon-side state (e.g. recordLlmUsage's incrementing usage counter in
    // golden-corpus.json). vitest's default file-level parallelism runs them as concurrent
    // workers against that one socket → nondeterministic counter interleaving → the
    // recordLlmUsage corpus assertion flakes direct-pass/proxy-fail (GV-2 finding; not a
    // proxy defect). Serializing the files makes each run deterministic, so result-set
    // equality is stable (both pass, or both fail → excluded-set — never a spurious
    // direct-pass/proxy-fail). Individual tests within a file already run sequentially.
    execFileSync(vitestBin, ['run', ...files, '--no-file-parallelism', '--reporter=json', `--outputFile=${outFile}`, ...extraArgs], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  } catch {
    // Nonzero exit from failing tests is expected — see doc comment above.
  }
  if (!existsSync(outFile)) {
    throw new Error(`vitest did not write a JSON report to ${outFile} (files: ${files.join(', ')})`)
  }
  const report = JSON.parse(readFileSync(outFile, 'utf8')) as {
    testResults: Array<{ assertionResults: Array<{ fullName: string; status: string }> }>
  }
  return report.testResults.flatMap((tr) => tr.assertionResults.map((ar) => ({ fullName: ar.fullName, status: ar.status })))
}

// ─── GV-1 (Fable rev 3.4) — corpus-arm vs conformance-arm classification ───
//
// The B-e2e suite runs TWO test files, whose vitest fullNames are
// distinguishable by their outermost `describe` text alone (verified against
// tests/conformance/conformance.test.ts:88 and
// tests/conformance/corpus/corpus.test.ts:55):
//   corpus-arm:       "dual-run corpus diff — replaying the recorded corpus
//                      against a live daemon {op} [{payloadLabel}] — …"
//   conformance-arm:  "conformance oracle — socket-level contract
//                      conformance (all 30 ops) operation: {op} …"
// GV-1 excludes ONLY the corpus-arm tests for the 5 natively-routed ops
// (health, getPermissions, requestPermissions, listWindows, library) from
// the T-02c equality basis — the corpus is a TS-recorded byte fixture; a
// from-scratch Swift reimplementation legitimately diverges on it (same
// basis error as the Gate-A corpus drop). The conformance-arm tests for
// those SAME ops are contract-level/server-agnostic and stay in the basis —
// this classifier only ever matches the corpus-arm prefix, so it can never
// accidentally swallow a conformance-arm test.
const CORPUS_ARM_PREFIX = 'dual-run corpus diff — replaying the recorded corpus against a live daemon '

/** Returns the matched op name if `testFullName` is a corpus-arm test for a
 * NATIVELY-ROUTED op (per `isNativeOp()` — the SAME production-routing-config
 * source Router.swift routes on, never a second independently-maintained
 * list), else `undefined`. */
function corpusArmNativeOp(testFullName: string): string | undefined {
  if (!testFullName.startsWith(CORPUS_ARM_PREFIX)) return undefined
  const rest = testFullName.slice(CORPUS_ARM_PREFIX.length)
  const bracket = rest.indexOf(' [')
  if (bracket === -1) return undefined
  const op = rest.slice(0, bracket)
  return isNativeOp(op) ? op : undefined
}

/** Whether `testFullName` is a corpus-arm test specifically for
 * `recordLlmUsage` — GV-2's target. `recordLlmUsage` is PROXIED in the real
 * production routing config (front-door.ts's `PRODUCTION_ROUTING_CONFIG`
 * only natives the 5 GV-1 ops), so it is deliberately NOT caught by
 * `corpusArmNativeOp` above — it needs the decisive order-swap probe, not a
 * plausibility exclusion. */
function isRecordLlmUsageCorpusArm(testFullName: string): boolean {
  return testFullName.startsWith(`${CORPUS_ARM_PREFIX}recordLlmUsage [`)
}

// Advisor ruling 2 §Amendment 1 (docs/plans/m3-g2-vb-advisor-ruling-2.md;
// g2-chain3.log:1011) — SECOND authorized scope-pinned gateBE2E amendment.
// createSession launches a REAL headless Chrome per leg (~5s) against an
// unreachable fixture URL; launch/nav is non-deterministic, so a leg can
// split direct-pass/proxy-fail on a Chrome flake and false-RED B-e2e
// (line ~900). Both conformance-arm and corpus-arm createSession rows are a
// real-Chrome launch outcome, NOT an implementation-comparable basis — so
// they enter the excluded set UNCONDITIONALLY (basis-exclusion, same argument
// as GV-1's native-route-corpus-basis; GV-2 order-swap NOT triggered). The
// surviving floor lives elsewhere: B-diff fingerprint + T-24 target-split
// arms (routing), 29 other proxied-op byte-diffs + matched-okness createSession
// diff (tunnel fidelity), V-A (shape).
const CONFORMANCE_ARM_CREATESESSION_PREFIX =
  'conformance oracle — socket-level contract conformance (all 30 ops) operation: createSession '
function isRealChromeCreateSessionRow(testFullName: string): boolean {
  return (
    testFullName.startsWith(`${CORPUS_ARM_PREFIX}createSession [`) ||
    testFullName.startsWith(CONFORMANCE_ARM_CREATESESSION_PREFIX)
  )
}

// ─── GV-2 (Fable rev 3.4) — recordLlmUsage leg-order-swap falsifier ────────
//
// Both B-e2e legs (direct + proxy) run against the SAME shared backend (the
// front door proxies to the harness's own backend socket) — direct runs
// FIRST today, proxy SECOND, in the normal gateBE2E() order below. For a
// STATEFUL accumulating op like recordLlmUsage (each call appends a
// usage-log entry the response echoes back), whichever leg runs SECOND
// observes the OTHER leg's already-appended state. That is indistinguishable
// from a real proxy bug using pass/fail alone — this probe swaps the run
// order (proxy leg first, direct leg second) against a FRESH harness/backend
// and checks whether the failure now follows the SECOND leg (proves
// state-order-sensitivity, acquits the proxy) or still sticks to the proxy
// leg regardless of position (convicts it — a real proxy-fidelity finding).
async function gv2RecordLlmUsageOrderSwapProbe(): Promise<{
  proxyFirst: Map<string, string>
  directSecond: Map<string, string>
}> {
  console.log('\n=== GV-2 — recordLlmUsage leg-order-swap probe (proxy FIRST, direct SECOND; falsifier, not optional) ===')
  const harness = await startFrontDoorHarness()
  const resultsDir = mkdtempSync(join(tmpdir(), 'spectra-flip-gv2-results-'))
  try {
    // Fidelity note: this MUST run the SAME suiteFiles (both conformance.test.ts
    // AND corpus.test.ts, no `-t` narrowing) as the normal gateBE2E() legs
    // below — an earlier version of this probe filtered to `-t recordLlmUsage`
    // alone and dropped conformance.test.ts, which under-reproduced the real
    // leg's total call volume against the shared backend (conformance.test.ts's
    // own per-op sweep, plus corpus.test.ts's other 29 ops, all touch the same
    // backend before/around the recordLlmUsage assertions) and came back
    // falsely clean (both orders passed in isolation) — a probe that isn't
    // faithful to the real magnitude cannot be decisive. Only the recordLlmUsage
    // rows are extracted from the full JSON report afterward, for the verdict.
    const suiteFiles = ['tests/conformance/conformance.test.ts', 'tests/conformance/corpus/corpus.test.ts']
    const proxyFirstOut = join(resultsDir, 'proxy-first.json')
    const directSecondOut = join(resultsDir, 'direct-second.json')

    // SWAPPED order: proxy leg (through the front door, same shared backend)
    // FIRST — sees a FRESH backend, same as direct normally does.
    const proxyFirstResults = runVitestJson(
      suiteFiles,
      {
        ...process.env,
        SPECTRA_DAEMON_SOCKET: harness.frontDoorSocketPath,
        SPECTRA_CONFORMANCE_PROXY_FIDELITY: '1',
      },
      proxyFirstOut,
    )
    // ...then DIRECT leg SECOND — now sees whatever state the proxy leg's
    // FULL suite run already appended to the shared backend.
    const directSecondResults = runVitestJson(
      suiteFiles,
      {
        ...process.env,
        SPECTRA_DAEMON_SOCKET: harness.backendSocketPath,
        SPECTRA_CONFORMANCE_PROXY_FIDELITY: '1',
      },
      directSecondOut,
    )

    const proxyFirstRecordLlmUsage = proxyFirstResults.filter((r) => isRecordLlmUsageCorpusArm(r.fullName))
    const directSecondRecordLlmUsage = directSecondResults.filter((r) => isRecordLlmUsageCorpusArm(r.fullName))

    console.log('  · swapped order — PROXY ran FIRST (recordLlmUsage corpus-arm rows):')
    for (const r of proxyFirstRecordLlmUsage) console.log(`      ${r.status === 'passed' ? '✔' : '✗'} ${r.fullName} [${r.status}]`)
    console.log('  · swapped order — DIRECT ran SECOND (recordLlmUsage corpus-arm rows):')
    for (const r of directSecondRecordLlmUsage) console.log(`      ${r.status === 'passed' ? '✔' : '✗'} ${r.fullName} [${r.status}]`)

    return {
      proxyFirst: new Map(proxyFirstResults.map((r) => [r.fullName, r.status])),
      directSecond: new Map(directSecondResults.map((r) => [r.fullName, r.status])),
    }
  } finally {
    rmSync(resultsDir, { recursive: true, force: true })
    await harness.close()
  }
}

// ─── Gate B-e2e — measured-equality end-to-end (T-02c, rev 3) ─────────────
async function gateBE2E(): Promise<void> {
  console.log('\n=== Gate B-e2e — measured-equality end-to-end (T-02c) ===')
  const harness = await startFrontDoorHarness()
  try {
    assertSocketMode0600(harness.backendSocketPath)
    record('Gate B-e2e: backend socket mode 0600 (moved from the old Gate B)', true)
  } catch (error) {
    record('Gate B-e2e: backend socket mode 0600', false, error instanceof Error ? error.message : String(error))
  }

  const resultsDir = mkdtempSync(join(tmpdir(), 'spectra-flip-bE2e-results-'))
  try {
    const directOut = join(resultsDir, 'direct.json')
    const proxyOut = join(resultsDir, 'proxy.json')
    const suiteFiles = ['tests/conformance/conformance.test.ts', 'tests/conformance/corpus/corpus.test.ts']

    // Both legs set SPECTRA_CONFORMANCE_PROXY_FIDELITY=1 — "external mode
    // OFF, full assertions" (per T-02c's spec text) is achieved via the SAME
    // widening flag T-02's front-door.ts caller uses: the harness backend is
    // the fully-fixture-seeded TS daemon, not a generically-unknown external
    // daemon, so the external skip-list has no reason to fire on either leg.
    const directResults = runVitestJson(
      suiteFiles,
      {
        ...process.env,
        SPECTRA_DAEMON_SOCKET: harness.backendSocketPath,
        SPECTRA_CONFORMANCE_PROXY_FIDELITY: '1',
      },
      directOut,
    )
    const proxyResults = runVitestJson(
      suiteFiles,
      {
        ...process.env,
        SPECTRA_DAEMON_SOCKET: harness.frontDoorSocketPath,
        SPECTRA_CONFORMANCE_PROXY_FIDELITY: '1',
      },
      proxyOut,
    )

    const directByName = new Map(directResults.map((r) => [r.fullName, r.status]))
    const proxyByName = new Map(proxyResults.map((r) => [r.fullName, r.status]))
    const allNames = new Set([...directByName.keys(), ...proxyByName.keys()])

    const failures: string[] = []
    const excludedSet: Array<{ test: string; directStatus: string; proxyStatus: string; class: string; corroborated_by?: string }> = []
    // GV-2 candidates: recordLlmUsage corpus-arm names whose NORMAL-order
    // statuses are exactly direct-pass/proxy-fail — the one pattern that
    // cannot enter the excluded set on plausibility (per the handoff) and
    // instead requires the decisive leg-order-swap falsifier below.
    const gv2Candidates: Array<{ name: string; directStatus: string; proxyStatus: string }> = []

    for (const name of allNames) {
      const d = directByName.get(name)
      const p = proxyByName.get(name)
      if (d === undefined || p === undefined) {
        failures.push(`"${name}" present in only one run's result set (direct=${d ?? '<missing>'}, proxy=${p ?? '<missing>'})`)
        continue
      }

      // GV-1: corpus-arm tests for the 5 natively-routed ops are excluded
      // from the basis UNCONDITIONALLY (not conditioned on pass/fail — a
      // TS-recorded corpus replayed through a from-scratch Swift
      // reimplementation is not a valid comparison regardless of outcome).
      // Conformance-arm tests for these same ops are NOT matched by this
      // classifier (see corpusArmNativeOp's doc comment) and fall through to
      // the ordinary rule below, per GV-1's explicit "stay in the basis"
      // requirement.
      const nativeCorpusOp = corpusArmNativeOp(name)
      if (nativeCorpusOp !== undefined) {
        excludedSet.push({ test: name, directStatus: d, proxyStatus: p, class: 'native-route-corpus-basis' })
        continue
      }

      // Advisor ruling 2 §Amendment 1: createSession (real-Chrome/stateful) —
      // excluded UNCONDITIONALLY, both arms, regardless of pass/fail outcome.
      if (isRealChromeCreateSessionRow(name)) {
        excludedSet.push({ test: name, directStatus: d, proxyStatus: p, class: 'real-chrome-stateful' })
        continue
      }

      const directPass = d === 'passed'
      const proxyPass = p === 'passed'
      if (directPass && !proxyPass) {
        if (isRecordLlmUsageCorpusArm(name)) {
          // GV-2: defer the verdict to the decisive order-swap probe — do
          // NOT admit to the excluded set on plausibility, and do NOT record
          // as a failure yet (see the GV-2 resolution pass below).
          gv2Candidates.push({ name, directStatus: d, proxyStatus: p })
        } else {
          failures.push(`"${name}": direct PASSED but proxy FAILED (${p}) — proxy bug`)
        }
      } else if (!directPass && !proxyPass) {
        excludedSet.push({ test: name, directStatus: d, proxyStatus: p, class: 'backend-capability' })
      }
      // direct-fail + proxy-pass, or both-pass: not a failure mode per Ruling 1/T-02c.
    }

    // ─── GV-2 resolution: recordLlmUsage leg-order-swap falsifier ─────────
    let gv2Verdict: 'acquitted' | 'convicted' | 'inconclusive' | 'no-candidates' = 'no-candidates'
    const gv2Evidence: {
      normalOrder: Array<{ name: string; directStatus: string; proxyStatus: string }>
      swappedOrder: { proxyFirst: Record<string, string>; directSecond: Record<string, string> } | null
      perTestVerdict: Array<{ name: string; verdict: 'acquitted' | 'convicted' | 'inconclusive' }>
    } = { normalOrder: gv2Candidates, swappedOrder: null, perTestVerdict: [] }

    if (gv2Candidates.length > 0) {
      const swapped = await gv2RecordLlmUsageOrderSwapProbe()
      gv2Evidence.swappedOrder = {
        proxyFirst: Object.fromEntries(swapped.proxyFirst),
        directSecond: Object.fromEntries(swapped.directSecond),
      }
      let anyConvicted = false
      let anyAcquitted = false
      let anyInconclusive = false
      for (const candidate of gv2Candidates) {
        const swappedProxyStatus = swapped.proxyFirst.get(candidate.name)
        const swappedDirectStatus = swapped.directSecond.get(candidate.name)
        const proxyPassesWhenFirst = swappedProxyStatus === 'passed'
        const directFailsWhenSecond = swappedDirectStatus !== undefined && swappedDirectStatus !== 'passed'

        if (proxyPassesWhenFirst && directFailsWhenSecond) {
          // Failure follows whichever leg runs SECOND, regardless of which
          // backend it is — order-sensitivity proven, the proxy is acquitted.
          gv2Evidence.perTestVerdict.push({ name: candidate.name, verdict: 'acquitted' })
          excludedSet.push({
            test: candidate.name,
            directStatus: candidate.directStatus,
            proxyStatus: candidate.proxyStatus,
            class: 'dual-leg-state-order',
            corroborated_by: 'B-diff masked byte-transparency pass (result.entries is the weakest mask on record — rev 3.2 standing note)',
          })
          anyAcquitted = true
        } else if (!proxyPassesWhenFirst) {
          // The proxy leg still fails even when it runs FIRST (fresh state)
          // — sticks to the proxy regardless of order. REAL finding: kept in
          // `failures`, never excluded, explicitly named for an S1 dispatch.
          gv2Evidence.perTestVerdict.push({ name: candidate.name, verdict: 'convicted' })
          failures.push(
            `"${candidate.name}": direct PASSED but proxy FAILED (${candidate.proxyStatus}) — GV-2 REAL FINDING: ` +
              `proxy still fails when run FIRST (swapped-order proxy status: ${String(swappedProxyStatus)}) — ` +
              `proxy-fidelity bug, NOT excludable; route to S1.`,
          )
          anyConvicted = true
        } else {
          // Neither clean pattern observed (e.g. both legs passed once
          // swapped) — GV-2 requires PROOF to exclude; absence of proof means
          // do not exclude. Conservative: treat as a real, unexplained
          // finding rather than silently dropping it.
          gv2Evidence.perTestVerdict.push({ name: candidate.name, verdict: 'inconclusive' })
          failures.push(
            `"${candidate.name}": direct PASSED but proxy FAILED (${candidate.proxyStatus}) — GV-2 INCONCLUSIVE: ` +
              `swapped-order did not reproduce the clean order-sensitivity pattern (proxy-first=${String(swappedProxyStatus)}, ` +
              `direct-second=${String(swappedDirectStatus)}) — not excludable without proof; route to S1 for investigation.`,
          )
          anyInconclusive = true
        }
      }
      gv2Verdict = anyConvicted ? 'convicted' : anyInconclusive ? 'inconclusive' : anyAcquitted ? 'acquitted' : 'no-candidates'
    }

    const evidenceDir = join(repoRoot, '.build-loop', 'flip-evidence')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(join(evidenceDir, 'gv2-recordllmusage-order-swap.json'), JSON.stringify({ verdict: gv2Verdict, ...gv2Evidence }, null, 2))

    record(
      'Gate B-e2e: result-set equality (direct-pass/proxy-fail is the only failure mode)',
      failures.length === 0,
      failures.length
        ? failures.slice(0, 20).join(' | ') + (failures.length > 20 ? ` … +${failures.length - 20} more` : '')
        : `${allNames.size} tests compared, ${excludedSet.length} in the excluded set (see below)`,
    )

    const excludedSetPath = join(evidenceDir, 'gate-b-e2e-excluded-set.json')
    writeFileSync(excludedSetPath, JSON.stringify(excludedSet, null, 2))
    console.log(
      `\n--- Gate B-e2e excluded-set report (backend-capability + native-route-corpus-basis + dual-leg-state-order — ` +
        `NOT gate failures; ${excludedSet.length} entries; written to ${excludedSetPath} for the Fable verdict review) ---`,
    )
    for (const e of excludedSet) {
      console.log(`  · [${e.class}] ${e.test} — direct:${e.directStatus} proxy:${e.proxyStatus}${e.corroborated_by ? ` (corroborated_by: ${e.corroborated_by})` : ''}`)
    }
  } finally {
    rmSync(resultsDir, { recursive: true, force: true })
    await harness.close()
  }
}

// ─── Gate B2 — fail-closed routing config (T-02b, rev 3 falsifiers) ───────
//
// rev 3 replaces the old single RED/GREEN mutation with the three explicit
// falsifiers from the S1 delta (docs/plans/m3-g1-flip-plan.handoff.md's
// "S1 delta" acceptance list): (i) proves the standalone opt-in flag NEVER
// weakens the with-backend case (the double-misconfig fix); (ii) proves
// absence of a backend is not, by itself, treated as intent; (iii) is the
// Gate A/C regression recipe re-exercised in isolation here too.
async function gateB2(bin: string): Promise<void> {
  console.log('\n=== Gate B2 — fail-closed routing config (T-02b) ===')
  const home = mkdtempSync(join(tmpdir(), 'spectra-flip-gateB2-home-'))
  const sock = join(home, 'daemon.sock')

  // Mutation: production config, but `getSession` (representative of the 6
  // session-coupled ops) moved into `native:[]`.
  const mutated = productionRoutingConfig()
  mutated.native.push('getSession')
  const mutatedPath = join(home, 'routing-config.mutated.json')
  writeFileSync(mutatedPath, JSON.stringify(mutated, null, 2))
  const dummyBackend = join(home, 'nonexistent-backend.sock') // deliberately unbound

  // Base env with BOTH env vars this gate toggles explicitly deleted first —
  // guards against an ambient shell already exporting either one and
  // silently corrupting a falsifier's precondition (e.g. a "no backend" case
  // that isn't actually backend-free because the calling shell had
  // SPECTRA_PROXY_BACKEND_SOCKET set for an unrelated reason).
  function baseEnv(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...overrides, HOME: home, SPECTRA_HOME: home }
    delete env.SPECTRA_PROXY_BACKEND_SOCKET
    delete env.SPECTRA_STANDALONE_SESSION_OPS
    if (overrides.SPECTRA_PROXY_BACKEND_SOCKET !== undefined) env.SPECTRA_PROXY_BACKEND_SOCKET = overrides.SPECTRA_PROXY_BACKEND_SOCKET
    if (overrides.SPECTRA_STANDALONE_SESSION_OPS !== undefined) env.SPECTRA_STANDALONE_SESSION_OPS = overrides.SPECTRA_STANDALONE_SESSION_OPS
    return env
  }

  async function expectRefuse(label: string, env: NodeJS.ProcessEnv): Promise<void> {
    const boot = await bootDaemon(bin, sock, env, 10_000)
    if (boot.bound) {
      await stopDaemon(boot.proc)
      record(label, false, 'daemon bound its socket instead of refusing — the fail-closed denylist did not bite')
    } else if (boot.exitCode === 0) {
      record(label, false, `daemon exited 0 (should be nonzero) without binding; stderr: ${boot.stderr()}`)
    } else {
      record(label, true, `exit ${String(boot.exitCode)}, stderr non-empty: ${boot.stderr().length > 0}`)
    }
  }

  async function expectBoot(label: string, env: NodeJS.ProcessEnv): Promise<void> {
    const boot = await bootDaemon(bin, sock, env)
    if (boot.bound) {
      record(label, true)
      await stopDaemon(boot.proc)
    } else {
      record(label, false, `exit ${String(boot.exitCode)}; stderr: ${boot.stderr()}`)
    }
  }

  // (i) backend configured + STANDALONE_SESSION_OPS=1 + session op native →
  // still REFUSES — the flag never weakens the with-backend case.
  await expectRefuse(
    'Gate B2 (i): backend + flag set + session-op-native → still refuses',
    baseEnv({
      SPECTRA_DAEMON_SOCKET: sock,
      SPECTRA_PROXY_BACKEND_SOCKET: dummyBackend,
      SPECTRA_ROUTING_CONFIG: mutatedPath,
      SPECTRA_STANDALONE_SESSION_OPS: '1',
    }),
  )

  // (ii) no backend + NO flag + session op native → refuses (today's
  // default — absence of a backend is not, by itself, intent).
  await expectRefuse(
    'Gate B2 (ii): no backend + no flag + session-op-native → refuses',
    baseEnv({
      SPECTRA_DAEMON_SOCKET: sock,
      SPECTRA_ROUTING_CONFIG: mutatedPath,
    }),
  )

  // (iii) no backend + flag set → BOOTS (the Gate A/C regression recipe,
  // re-exercised here in isolation from the full Gate A/C boot sequence).
  await expectBoot(
    'Gate B2 (iii): no backend + flag → boots (regression recipe)',
    baseEnv({
      SPECTRA_DAEMON_SOCKET: sock,
      SPECTRA_ROUTING_CONFIG: mutatedPath,
      SPECTRA_STANDALONE_SESSION_OPS: '1',
    }),
  )

  // m1 control case (unchanged): the untouched production config still boots
  // green with a backend configured and no session ops native.
  const validPath = join(home, 'routing-config.valid.json')
  writeFileSync(validPath, JSON.stringify(productionRoutingConfig(), null, 2))
  await expectBoot(
    'Gate B2 GREEN: valid production config boots (backend configured, no session ops native)',
    baseEnv({
      SPECTRA_DAEMON_SOCKET: sock,
      SPECTRA_PROXY_BACKEND_SOCKET: dummyBackend,
      SPECTRA_ROUTING_CONFIG: validPath,
    }),
  )

  rmSync(home, { recursive: true, force: true })
}

// ─── Gate C — capability gate external, native routing (T-04) ─────────────
async function gateC(bin: string): Promise<void> {
  console.log('\n=== Gate C — capability gate external, native routing (T-04) ===')
  const home = mkdtempSync(join(tmpdir(), 'spectra-flip-gateC-home-'))
  const sock = join(home, 'daemon.sock')
  const routingConfigPath = join(home, 'routing-config.json')
  writeFileSync(routingConfigPath, JSON.stringify(ALL_11_NATIVE_ROUTING_CONFIG, null, 2))

  const boot = await bootDaemon(bin, sock, {
    ...process.env,
    SPECTRA_DAEMON_SOCKET: sock,
    SPECTRA_CONFORMANCE_SEED: '1',
    SPECTRA_ROUTING_CONFIG: routingConfigPath,
    SPECTRA_CONFORMANCE_UNIX_CAPS: JSON.stringify(['daemon:read']),
    // rev 3: see Gate A's identical note — Router.swift's backend-aware
    // fail-closed rule requires this harness-only opt-in for an all-11-native
    // standalone boot (no backend configured here either).
    SPECTRA_STANDALONE_SESSION_OPS: '1',
    HOME: home,
    SPECTRA_HOME: home,
  })
  if (!boot.bound) {
    record('Gate C: Swift daemon boot (restricted caps, all-11-native)', false, `exit ${String(boot.exitCode)}; stderr: ${boot.stderr()}`)
    rmSync(home, { recursive: true, force: true })
    return
  }
  record('Gate C: Swift daemon boot (restricted caps, all-11-native)', true)

  try {
    runVitest(
      ['tests/conformance/capability-gate.test.ts'],
      {
        ...process.env,
        SPECTRA_DAEMON_SOCKET: sock,
        SPECTRA_CONFORMANCE_EXTERNAL_CAPS_HONORED: '1',
        SPECTRA_CONFORMANCE_SEED_SESSION: SEED_SESSION,
      },
      'Gate C: capability-gate.test.ts vs Swift (health allowed, all else capability_denied)',
    )
  } finally {
    await stopDaemon(boot.proc)
    rmSync(home, { recursive: true, force: true })
  }
}

/** Second harness-robustness gap found once the T-02/Gate-B-diff EPIPE crash
 * (see front-door.ts) no longer masks it by killing the process first:
 * `bootDaemon()`'s "bound" signal is `existsSync(sock)` — true as soon as the
 * daemon's `bind()` call creates the socket FILE, which is not the same
 * instant the daemon is actually calling `listen()`/accepting connections.
 * Gate D's `callOperation()` calls (immediately after a "bound" boot) hit
 * that TOCTOU window directly and, when they lose the race, threw an
 * uncaught `ECONNREFUSED` rejection that crashed the whole process before
 * Gate D (and T-10) ever finished — the exact same class of "harness bug
 * kills the whole chain" failure as the EPIPE crash, just a different socket
 * and a different gate. Fixed here by (a) a few short-backoff retries to
 * absorb the genuine race rather than false-failing Gate D on it, and (b) a
 * catch that converts any residual connection failure into a normal FAILED
 * `record(...)` result — never an unhandled rejection — matching how every
 * other gate in this file already reports its own failures.
 */
async function callOperationResilient(
  args: Parameters<typeof callOperation>[0],
): Promise<{ ok: true; response: Awaited<ReturnType<typeof callOperation>> } | { ok: false; error: string }> {
  const attempts = 5
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return { ok: true, response: await callOperation(args) }
    } catch (error) {
      lastError = error
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 100))
    }
  }
  return { ok: false, error: lastError instanceof Error ? lastError.message : String(lastError) }
}

// ─── Gate D — mutation spot-checks (T-03) ──────────────────────────────────
async function gateD(bin: string): Promise<void> {
  console.log('\n=== Gate D — mutation spot-checks (T-03) ===')
  const home = mkdtempSync(join(tmpdir(), 'spectra-flip-gateD-home-'))
  const sock = join(home, 'daemon.sock')
  const dummyBackend = join(home, 'nonexistent-backend.sock')

  // (1) Routing-table-bites: mark `health` NOT native, with no reachable
  // backend — the live call must go RED (an error envelope, not the normal
  // health success shape), proving the routing table actually gates dispatch
  // rather than being decorative.
  const healthProxiedConfig = {
    version: 1,
    native: productionRoutingConfig().native.filter((op) => op !== 'health'),
  }
  const mutatedPath = join(home, 'routing-config.health-proxied.json')
  writeFileSync(mutatedPath, JSON.stringify(healthProxiedConfig, null, 2))

  const redBoot = await bootDaemon(bin, sock, {
    ...process.env,
    SPECTRA_DAEMON_SOCKET: sock,
    SPECTRA_PROXY_BACKEND_SOCKET: dummyBackend,
    SPECTRA_ROUTING_CONFIG: mutatedPath,
    HOME: home,
    SPECTRA_HOME: home,
  })
  if (!redBoot.bound) {
    record('Gate D RED: health demoted to proxy, no backend', false, `daemon did not bind: exit ${String(redBoot.exitCode)}; stderr: ${redBoot.stderr()}`)
  } else {
    try {
      const attempt = await callOperationResilient({ socketPath: sock, operation: 'health', params: {} })
      if (!attempt.ok) {
        record('Gate D RED: health demoted to proxy, no backend → error envelope (not the normal success shape)', false, `connection failed: ${attempt.error}`)
      } else {
        const envelope = apiResponseEnvelopeSchema.safeParse(attempt.response.body)
        const isRed = envelope.success && !envelope.data.ok
        record(
          'Gate D RED: health demoted to proxy, no backend → error envelope (not the normal success shape)',
          isRed,
          envelope.success ? JSON.stringify(envelope.data) : `envelope invalid: ${envelope.error.message}`,
        )
      }
    } finally {
      await stopDaemon(redBoot.proc)
    }
  }

  // Restore: health back in `native:[]` (the real production config) → GREEN.
  const validPath = join(home, 'routing-config.valid.json')
  writeFileSync(validPath, JSON.stringify(productionRoutingConfig(), null, 2))
  const greenBoot = await bootDaemon(bin, sock, {
    ...process.env,
    SPECTRA_DAEMON_SOCKET: sock,
    SPECTRA_PROXY_BACKEND_SOCKET: dummyBackend,
    SPECTRA_ROUTING_CONFIG: validPath,
    HOME: home,
    SPECTRA_HOME: home,
  })
  if (!greenBoot.bound) {
    record('Gate D GREEN: health restored to native → healthy', false, `daemon did not bind: exit ${String(greenBoot.exitCode)}; stderr: ${greenBoot.stderr()}`)
  } else {
    try {
      const attempt = await callOperationResilient({ socketPath: sock, operation: 'health', params: {} })
      if (!attempt.ok) {
        record('Gate D GREEN: health restored to native → healthy', false, `connection failed: ${attempt.error}`)
      } else {
        const envelope = apiResponseEnvelopeSchema.safeParse(attempt.response.body)
        const isGreen = envelope.success && envelope.data.ok
        record(
          'Gate D GREEN: health restored to native → healthy',
          isGreen,
          envelope.success ? '' : `envelope invalid: ${envelope.error.message}`,
        )
      }
    } finally {
      await stopDaemon(greenBoot.proc)
    }
  }

  rmSync(home, { recursive: true, force: true })

  // (2) CapabilityPolicy-call-removal — NOT automated here. Router.swift is
  // S1-owned (pin-protected); this agent must not edit it, even transiently.
  record(
    'Gate D MANUAL: remove CapabilityPolicy.shared.assert(...) call in Router.swift, confirm T-04 RED, revert, confirm GREEN',
    'manual',
    'requires editing S1-owned Router.swift — Opus/S1 coordinated, not scriptable from an S4-owned file',
  )
}

// ─── T-10 — bootstrap rogue-spawn guard (§G3, Q-01) ────────────────────────
// Pure-TS check, no Swift binary involved — src/client/bootstrap.ts's
// `spawnDaemonBootstrap` guard. Not one of the lettered gates (A-D); grouped
// with them here because this agent owns both the guard and this orchestrator
// and T-10 has no other assigned home.
async function gateT10(): Promise<void> {
  console.log('\n=== T-10 — bootstrap rogue-spawn guard (§G3) ===')
  // A fake DaemonClient — only `isUp()` is ever called, and only on the path
  // where the guard does NOT decline (pre-flip), where it must always report
  // "not up" so bootstrap() falls through to its own timeout/false path
  // instead of hanging on a real health probe.
  const fakeClient = { isUp: async () => false } as unknown as Parameters<typeof spawnDaemonBootstrap>[0]

  // Harmless daemon-entry stub: exists, exits immediately, never becomes
  // healthy — lets the PRE-EXISTING spawn+poll code path run to completion
  // exactly as it did before this guard existed, without leaving a real
  // process behind.
  const stubDir = mkdtempSync(join(tmpdir(), 'spectra-flip-t10-stub-'))
  const stubEntry = join(stubDir, 'fake-daemon-entry.js')
  writeFileSync(stubEntry, 'process.exit(0);\n')

  // ── Pre-flip (no dev.spectra.daemon-ts plist): behavior BYTE-IDENTICAL ──
  const preFlipHome = mkdtempSync(join(tmpdir(), 'spectra-flip-t10-preflip-'))
  const preFlipBootstrap = spawnDaemonBootstrap(fakeClient, {
    daemonEntry: stubEntry,
    readyTimeoutMs: 300,
    pollIntervalMs: 50,
    flipGuardHomeDir: preFlipHome,
  })
  const preFlipStart = Date.now()
  const preFlipResult = await preFlipBootstrap()
  const preFlipElapsed = Date.now() - preFlipStart
  record(
    'T-10 pre-flip: no dev.spectra.daemon-ts plist → guard does not fire (spawn+poll runs as before)',
    preFlipResult === false && preFlipElapsed >= 250,
    `result=${String(preFlipResult)}, elapsed=${preFlipElapsed}ms (expected ~300ms of polling, not an instant decline)`,
  )

  // ── Post-flip (dev.spectra.daemon-ts plist present): guard declines ─────
  const postFlipHome = mkdtempSync(join(tmpdir(), 'spectra-flip-t10-postflip-'))
  const plistPath = resolveFlipTopologyPlistPath(postFlipHome)
  mkdirSync(dirname(plistPath), { recursive: true })
  writeFileSync(plistPath, '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict/></plist>')

  const postFlipBootstrap = spawnDaemonBootstrap(fakeClient, {
    daemonEntry: stubEntry,
    readyTimeoutMs: 300,
    pollIntervalMs: 50,
    flipGuardHomeDir: postFlipHome,
  })
  let stderrCaptured = ''
  const originalWrite = process.stderr.write.bind(process.stderr)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stderr.write = ((chunk: any, ...rest: any[]) => {
    stderrCaptured += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    return originalWrite(chunk, ...rest)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
  const postFlipStart = Date.now()
  let postFlipResult: boolean
  try {
    postFlipResult = await postFlipBootstrap()
  } finally {
    process.stderr.write = originalWrite
  }
  const postFlipElapsed = Date.now() - postFlipStart
  record(
    'T-10 post-flip: dev.spectra.daemon-ts plist present → guard declines (false, no spawn/poll delay, actionable stderr)',
    postFlipResult === false && postFlipElapsed < 250 && /kickstart/i.test(stderrCaptured),
    `result=${String(postFlipResult)}, elapsed=${postFlipElapsed}ms, stderr="${stderrCaptured.trim()}"`,
  )

  rmSync(stubDir, { recursive: true, force: true })
  rmSync(preFlipHome, { recursive: true, force: true })
  rmSync(postFlipHome, { recursive: true, force: true })
}

async function main(): Promise<void> {
  const { bin, binDir } = compileSwiftBinary()
  // rev 3.2 (handoff.md "Suite behavior (pinned)"): the rev-3 conviction
  // stop-early rule is RETIRED. It was a one-time instrument for the
  // tunnel-bug question (does a T-02 conviction mean an S1 ProxyClient bug
  // exists before B-e2e/C/D are worth running?) — that question is answered
  // and fixed. All gates now run continue-on-fail: A → B-diff → B2 → B-e2e →
  // C → D, unconditionally, with per-gate results recorded in one report and
  // an aggregate nonzero exit if any gate failed (computed from `results`
  // below — unchanged).
  try {
    await gateA(bin)
    const convicted = await gateBDiff()
    if (convicted) {
      console.log(
        '\n*** T-02 CONVICTION NOTED: a proxy-synthesized internal_error or a latency-parity blowout was ' +
          'detected in Gate B-diff (see the failing op(s) above). Per rev 3.2 continue-on-fail: NOT stopping — ' +
          'running all remaining gates (B2 → B-e2e → C → D) regardless. ***',
      )
    }
    await gateB2(bin)
    await gateBE2E()
    await gateC(bin)
    await gateD(bin)
  } finally {
    rmSync(binDir, { recursive: true, force: true })
  }
  await gateT10()

  console.log('\n=== verify-flip-suite summary ===')
  for (const r of results) {
    const marker = r.ok === 'manual' ? '○ MANUAL' : r.ok ? '✔' : '✗'
    console.log(`  ${marker} ${r.gate}${r.detail ? ' — ' + r.detail : ''}`)
  }
  const failed = results.filter((r) => r.ok === false)
  if (failed.length > 0) {
    console.log(`\n${failed.length} gate(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('\nAll automated gates passed (Gate D#2 is MANUAL — see above; Gate E is the live launchd soak, run separately).')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
