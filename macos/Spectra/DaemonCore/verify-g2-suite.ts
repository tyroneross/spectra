// macos/Spectra/DaemonCore/verify-g2-suite.ts
//
// M3.G2 (S7) — the G2 gate harness: V-A headless contract conformance (T-20)
// + V-B differential semantic parity (T-21/T-22/T-24/T-27) + the T-23 v2
// loader fail-closed invariants, per docs/plans/m3-g2-plan.md's "##
// Verification design (the G2 gate — three classes)" and its pre-ruled "###
// G2 volatile-field map". V-C (T-25, on-device, user-present) is a SEPARATE
// scripted scaffold — see verify-g2-ondevice.sh/.ts, which this file does
// NOT invoke (V-C is run once, manually, with the user present, not as part
// of this headless gate).
//
// STATUS (read before running): this script is authored against the FROZEN
// DriverProtocol.swift + the G2 plan/handoff, BEFORE S1-S6's Swift
// implementations land (S7 is a parallel, independent implementer in the
// same wave). It will not boot a real daemon until S1-S6's owned files
// compile. Opus/the orchestrator runs this at integration once S1-S6 land —
// see the handoff's "Acceptance sequence". Several design points below are
// flagged `[S7 ASSUMPTION]` or `[S7 FLAG]` where this harness had to make a
// judgment call the plan does not pin down byte-for-byte; each is called out
// so integration can confirm or correct it rather than silently trusting it.
//
// Run: npx tsx macos/Spectra/DaemonCore/verify-g2-suite.ts
//
// Gates covered here (T-IDs per the plan's F-Criteria table):
//   T-23 — v2 routing-config loader fail-closed (boot-refusal invariants +
//          v1-config-still-boots rollback proof).
//   T-22/T-24/T-27 — route fingerprint + store-presence routing (both
//          directions) + merge/fanout determinism, all via ONE two-daemon
//          front-door harness boot (front-door.ts's `startFrontDoorHarness`,
//          using this milestone's new `routingConfig`/`extraEnv` options —
//          SG-2's append-only widening).
//   T-26 — printed as an explicit MANUAL gate (mirrors G1 Gate D's
//          CapabilityPolicy-removal mutation): it requires transiently
//          editing CapabilityPolicy.swift, a pin-protected S1/S6-owned file
//          this agent must never edit. Never silently skipped.
//   T-20 (V-A) — spawns the EXISTING 4 allowlist-importer vitest files
//          (conformance.test.ts, external-mode.test.ts,
//          capability-gate.test.ts, corpus/corpus.test.ts) against a
//          standalone Swift daemon with `SPECTRA_CONFORMANCE_MILESTONE=g2`
//          set — this is the "vitest external-mode" grader the plan names
//          for T-20; this script does NOT reimplement conformance logic, it
//          orchestrates the real suite against the widened allowlist.
//   T-21 (V-B) — THIS script's own differential comparator: two independent,
//          directly-booted daemons (TS in-process-seeded via
//          `startConformanceDaemon()`, Swift standalone via
//          `SPECTRA_CONFORMANCE_SEED=1`) driven with equivalent fixture
//          inputs, compared op-by-op against the pre-ruled G2 volatile-field
//          map. This is NOT a byte-transparency-through-a-tunnel check (that
//          is what G1's Gate B-diff proves, and IS one of this chain's own
//          sub-steps below) — it is a semantic-parity check between two
//          INDEPENDENT contract-conformant implementations, which is why the
//          comparison model differs from front-door.ts's tunnel-fidelity
//          rev-3.5 machinery (reused here only for its pure, already-exported
//          primitives: `diffVolatilePaths`/`maskPaths`/`canonicalJson`).
//   "G1 31/31 arm" — every V-B chain below also runs the FULL
//          `verify-flip-suite.ts` as a subprocess (Gates A/B-diff/B2/B-e2e/
//          C/D + T-10), per the handoff's "3 consecutive fully-green chains
//          (each incl. the G1 31/31 arm + B-e2e)". [S7 FLAG]: this reuses the
//          WHOLE G1 flip suite rather than isolating just Gate B-diff's
//          31-check count / Gate B-e2e, because neither is exported/callable
//          in isolation from that file (not owned by this agent — must not
//          edit it to add a narrower entry point). A coarser but faithful
//          non-regression proof: if the whole G1 flip suite is green, its
//          Gate B-diff (31/31) and Gate B-e2e sub-steps are green too.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { execFileSync, spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable } from 'node:stream'
import { callOperation, type WireCallResult } from '../../../tests/conformance/lib/socket-client.js'
import { startConformanceDaemon, type DaemonEndpoint } from '../../../tests/conformance/lib/daemon-endpoint.js'
import {
  startFrontDoorHarness,
  resolveDaemonCoreDir,
  diffVolatilePaths,
  maskPaths,
  canonicalJson,
} from '../../../tests/conformance/lib/front-door.js'
import { FAKE_ELEMENT_ID } from '../../../tests/conformance/lib/fakes.js'

// ─── Narrow EPIPE/ECONNRESET teardown backstop ─────────────────────────────
// Same rationale + same narrow scope as verify-flip-suite.ts's own backstop
// (see that file's doc comment for the full postmortem): this script spawns/
// kills several daemon subprocesses across its own gates, so a benign
// teardown-phase socket error must not crash the whole run. Never widen this
// beyond EPIPE/ECONNRESET on a write/read — anything else still crashes, as
// before.
function isBenignTeardownError(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException
  return !!e && (e.code === 'EPIPE' || e.code === 'ECONNRESET')
}
process.on('uncaughtException', (err) => {
  if (isBenignTeardownError(err)) {
    console.warn('[verify-g2-suite] backstop: ignoring benign teardown-phase socket error.')
    return
  }
  console.error(err)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  if (isBenignTeardownError(reason)) {
    console.warn('[verify-g2-suite] backstop: ignoring benign teardown-phase unhandled rejection.')
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
const FIXTURES_SRC_DIR = join(repoRoot, 'tests', 'conformance', 'fixtures')
const MASKS_EVIDENCE_PATH = join(repoRoot, '.build-loop', 'flip-evidence', 'g2-t21-masks.json')
const TCC_SPIKE_EVIDENCE_PATH = join(repoRoot, '.build-loop', 'flip-evidence', 'gate-g2-tcc-spike.txt')

// ─── The exact G2 op set (plan §"The exact G2 op set — counted, not
// trusted") — 16 ops, verified against contract.spec.json's 30-op surface
// minus G1's 11 minus G4's 3. Hardcoded here (not re-derived from
// external-mode.ts's SWIFT_G2_VERIFIABLE, which ALSO includes the 11 G1
// ops) so this file's own differential loop iterates EXACTLY the 16-op
// scope the plan defines for V-B, no more/less. ─────────────────────────
const G2_OPS = [
  'createSession',
  'snapshot',
  'observe',
  'act',
  'step',
  'llmStep',
  'walkthrough',
  'analyze',
  'discover',
  'screenshot',
  'computerUse',
  'startRecording',
  'stopRecording',
  'getRecording',
  'recordTerminal',
  'replayTerminal',
] as const

/** rev-3.5's closed six-op class-pattern set, carried over verbatim into the
 * G2 pre-ruled map's first row (`act/observe/snapshot/step/llmStep/
 * walkthrough | ... | rev-3.5 classes UNCHANGED`). */
const SIX_OPS: ReadonlySet<string> = new Set(['act', 'observe', 'snapshot', 'step', 'llmStep', 'walkthrough'])

/** Ops whose SUCCESS path needs real ScreenCaptureKit/AX (plan: "headless
 * legs = error-taxonomy arms only"). V-B drives these with a payload/session
 * combination BOTH legs are expected to reject the SAME way (byte-equal on
 * error code+status only — message stays free-text/unmasked-but-uncompared). */
const ERROR_TAXONOMY_ONLY_OPS: ReadonlySet<string> = new Set(['startRecording', 'stopRecording', 'computerUse'])

// ─── Routing config v2 for the G2 flip (plan §"Routing at the G2 flip",
// verbatim op-bucket lists) ─────────────────────────────────────────────
const G2_V2_ROUTING_CONFIG = {
  version: 2,
  native: ['health', 'getPermissions', 'requestPermissions', 'listWindows', 'library', 'recordTerminal', 'replayTerminal', 'computerUse'],
  affinity: [
    'createSession',
    'snapshot',
    'observe',
    'act',
    'step',
    'llmStep',
    'walkthrough',
    'screenshot',
    'analyze',
    'discover',
    'startRecording',
    'stopRecording',
    'getSession',
    'getRun',
    'closeSession',
    'recordLlmUsage',
    'getRecording',
  ],
  merge: ['listSessions'],
  fanout: ['closeAllSessions'],
}

const ALL_11_NATIVE_V1_ROUTING_CONFIG = {
  version: 1,
  native: [
    'health', 'getPermissions', 'requestPermissions', 'listWindows', 'library',
    'listSessions', 'getSession', 'getRun', 'closeSession', 'closeAllSessions', 'recordLlmUsage',
  ],
}

// ─── report plumbing (same shape as verify-flip-suite.ts's `record()`) ────
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

// ─── compile + boot helpers (self-contained copies — verify-flip-suite.ts's
// equivalents are not exported and that file is out of this agent's owned
// set) ───────────────────────────────────────────────────────────────────
function compileSwiftBinary(): { bin: string; binDir: string } {
  const swiftFiles = execFileSync('bash', ['-c', `ls ${daemonCoreDir}/*.swift`]).toString().trim().split('\n')
  const binDir = mkdtempSync(join(tmpdir(), 'spectra-g2-suite-bin-'))
  const bin = join(binDir, 'spectra-daemon-core')
  console.log('· compiling the Swift daemon-core…')
  execFileSync('swiftc', [...swiftFiles, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'] })
  console.log('  ✔ compiled')
  return { bin, binDir }
}

type DaemonProc = ChildProcessByStdio<null, Readable, Readable>

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

function bootEnvFor(sock: string, home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    SPECTRA_DAEMON_SOCKET: sock,
    HOME: home,
    SPECTRA_HOME: home,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// T-23 — v2 loader fail-closed invariants
// ═══════════════════════════════════════════════════════════════════════════
async function gateT23(bin: string): Promise<void> {
  console.log('\n=== T-23 — v2 routing-config loader fail-closed ===')

  const invalidConfigs: Array<{ label: string; config: unknown }> = [
    { label: 'unknown version (3)', config: { version: 3, native: [] } },
    {
      label: 'list overlap (op in both native and affinity)',
      config: { ...G2_V2_ROUTING_CONFIG, native: [...G2_V2_ROUTING_CONFIG.native, 'createSession'] },
    },
    {
      label: 'session-scoped op in plain native:[]',
      config: { version: 2, native: ['createSession'], affinity: [], merge: [], fanout: [] },
    },
    {
      label: 'affinity op with no registered handler',
      config: { version: 2, native: [], affinity: ['thisOpDoesNotExist'], merge: [], fanout: [] },
    },
    { label: 'malformed JSON', config: undefined },
  ]

  for (const { label, config } of invalidConfigs) {
    const home = mkdtempSync(join(tmpdir(), 'spectra-g2-t23-home-'))
    const sock = join(home, 'daemon.sock')
    const routingConfigPath = join(home, 'routing-config.json')
    if (config === undefined) {
      writeFileSync(routingConfigPath, '{ this is not valid json')
    } else {
      writeFileSync(routingConfigPath, JSON.stringify(config, null, 2))
    }
    const boot = await bootDaemon(
      bin,
      sock,
      bootEnvFor(sock, home, {
        SPECTRA_CONFORMANCE_SEED: '1',
        SPECTRA_ROUTING_CONFIG: routingConfigPath,
        SPECTRA_STANDALONE_SESSION_OPS: '1',
      }),
      8_000,
    )
    if (boot.bound) {
      record(`T-23: boot-refusal — ${label}`, false, 'daemon BOUND its socket instead of refusing to boot')
      await stopDaemon(boot.proc)
    } else {
      record(`T-23: boot-refusal — ${label}`, true, `exit ${String(boot.exitCode)}`)
    }
    rmSync(home, { recursive: true, force: true })
  }

  // Positive controls: a valid v2 config boots, AND a v1 config still boots
  // verbatim (the rollback target, T-28's <2min drill precondition).
  for (const [label, config, extraEnv] of [
    ['valid v2 config boots', G2_V2_ROUTING_CONFIG, { SPECTRA_CONFORMANCE_SEED: '1', SPECTRA_STANDALONE_SESSION_OPS: '1' }] as const,
    ['v1 config still boots (rollback path)', ALL_11_NATIVE_V1_ROUTING_CONFIG, { SPECTRA_CONFORMANCE_SEED: '1', SPECTRA_STANDALONE_SESSION_OPS: '1' }] as const,
  ]) {
    const home = mkdtempSync(join(tmpdir(), 'spectra-g2-t23-home-'))
    const sock = join(home, 'daemon.sock')
    const routingConfigPath = join(home, 'routing-config.json')
    writeFileSync(routingConfigPath, JSON.stringify(config, null, 2))
    const boot = await bootDaemon(bin, sock, bootEnvFor(sock, home, { ...extraEnv, SPECTRA_ROUTING_CONFIG: routingConfigPath }))
    record(`T-23: ${label}`, boot.bound, boot.bound ? '' : `exit ${String(boot.exitCode)}; stderr: ${boot.stderr()}`)
    if (boot.bound) await stopDaemon(boot.proc)
    rmSync(home, { recursive: true, force: true })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// T-22 (route fingerprint) + T-24 (store-presence routing, both directions)
// + T-27 (merge/fanout determinism) — one two-daemon front-door harness boot,
// using this milestone's own append-only FrontDoorHarnessOptions widening
// (routingConfig override + extraEnv) so the G2 topology boots through the
// SAME harness Gate B's G1 regression uses, without touching that gate's own
// default path (SG-2).
// ═══════════════════════════════════════════════════════════════════════════
async function gateRoutingAndMergeFanout(): Promise<void> {
  console.log('\n=== T-22/T-24/T-27 — route fingerprint + store-presence + merge/fanout ===')
  const harness = await startFrontDoorHarness({
    routingConfig: G2_V2_ROUTING_CONFIG,
    extraEnv: { SPECTRA_CONFORMANCE_SEED: '1' },
  })
  record('T-22/24/27: front-door harness boot (v2 config, backend configured)', true)
  try {
    // T-24 arm 1 — Swift-created (fake:) session -> served NATIVELY: no
    // `caller`/`deliveryPath` in the response envelope (WireProtocol.swift
    // never emits them; see gateT22T24's route-fingerprint rationale in
    // front-door.ts's own DifferentialCheckResult.mode doc comment).
    const created = await callOperation({
      socketPath: harness.frontDoorSocketPath,
      operation: 'createSession',
      params: { target: 'fake:conformance-seed' },
    })
    const createdBody = created.body as { ok?: boolean; result?: { sessionId?: string } }
    if (!createdBody.ok || !createdBody.result?.sessionId) {
      record('T-24: native createSession(fake:) via front door', false, JSON.stringify(created.body))
    } else {
      const swiftSessionId = createdBody.result.sessionId
      record('T-24: native createSession(fake:) via front door', true)
      const snap = await callOperation({ socketPath: harness.frontDoorSocketPath, operation: 'snapshot', params: { sessionId: swiftSessionId } })
      const snapBody = snap.body as Record<string, unknown>
      const nativeFingerprint = !('caller' in snapBody) && !('deliveryPath' in snapBody)
      record('T-22: native fingerprint on Swift-owned session (no caller/deliveryPath)', nativeFingerprint, JSON.stringify(snapBody).slice(0, 300))
    }

    // T-24 arm (h), missing web-target createSession target-split arm
    // (Item 5 adjacent / fix-work-list (h)): the ADR-06 fake seam keys
    // ONLY on the `fake:` target prefix — any OTHER target (a real web URL)
    // must tunnel to the TS backend, never be served natively by the
    // standalone Swift fake seam. Asserted via the same route fingerprint
    // T-22/T-24 already use: caller/deliveryPath PRESENT means it tunneled;
    // their absence would mean Swift silently served a web target natively
    // (the ND-3/target-split violation the adjacent finding names).
    const webCreated = await callOperation({
      socketPath: harness.frontDoorSocketPath,
      operation: 'createSession',
      params: { target: 'http://127.0.0.1:1/g2-t24-web-target-split' },
    })
    const webCreatedBody = webCreated.body as Record<string, unknown>
    const webTunneled = 'caller' in webCreatedBody && 'deliveryPath' in webCreatedBody
    record(
      'T-24: web-target createSession tunnels through front door (not served native)',
      webTunneled,
      JSON.stringify(webCreated.body).slice(0, 300),
    )

    // T-24 arm 2 — backend(TS)-created session, addressed through the front
    // door -> store-MISS on Swift -> byte-tunneled: `caller`/`deliveryPath`
    // PRESENT (TS's own envelope, passed through unmodified).
    if (harness.backendSessionIds) {
      const tunneled = await callOperation({
        socketPath: harness.frontDoorSocketPath,
        operation: 'snapshot',
        params: { sessionId: harness.backendSessionIds.web },
      })
      const tunneledBody = tunneled.body as Record<string, unknown>
      const tunneledFingerprint = 'caller' in tunneledBody && 'deliveryPath' in tunneledBody
      record('T-24: backend-owned session tunneled (caller/deliveryPath present)', tunneledFingerprint, JSON.stringify(tunneledBody).slice(0, 300))
    } else {
      record('T-24: backend-owned session tunneled', false, 'harness.backendSessionIds was undefined — cannot exercise this arm')
    }

    // T-24 arm 3 — unknown sessionId -> PASSTHROUGH PARITY (Item 8 / (g)):
    // the plan's original "TS answers not_found for a truly unknown id" was
    // falsified by the log evidence (TS actually answers `internal_error`,
    // and `not_found` is not even in the declared errorCodes for this op) —
    // Advisor plan-text correction, ADR-04. The `error.code === 'not_found'`
    // literal is REMOVED; the assertion is now that the front-door response
    // byte-equals a TS-DIRECT call with the SAME id (modulo requestId/
    // timestamp — compareG2Op's standard normalization), AND that
    // caller/deliveryPath are PRESENT on the front-door leg (tunnel
    // fingerprint) — proving the routing behavior T-24 exists to prove
    // (byte-transparent tunnel on store-miss) actually held, whatever TS's
    // own error taxonomy happens to answer.
    const unknownParams = { sessionId: 'g2-t24-unknown-session-id' }
    const [unknown, tsDirectUnknown] = await Promise.all([
      callOperation({ socketPath: harness.frontDoorSocketPath, operation: 'snapshot', params: unknownParams }),
      callOperation({ socketPath: harness.backendSocketPath, operation: 'snapshot', params: unknownParams }),
    ])
    const unknownBody = unknown.body as Record<string, unknown>
    const tunnelFingerprint = 'caller' in unknownBody && 'deliveryPath' in unknownBody
    const passthroughCmp = compareG2Op('snapshot', tsDirectUnknown.body, unknown.body, new Map())
    const unknownOk = tunnelFingerprint && passthroughCmp.ok
    record(
      'T-24: unknown sessionId — passthrough parity vs TS-direct (+ tunnel fingerprint)',
      unknownOk,
      [passthroughCmp.detail, tunnelFingerprint ? '' : 'caller/deliveryPath missing on front-door response'].filter(Boolean).join(' | '),
    )

    // T-27 — listSessions deterministic merge (Swift-owned first, then
    // backend, each sorted createdAt/id) x5 for order stability; run TWICE
    // in a row and assert byte-identical ordering both times.
    let mergeStable = true
    let lastOrder: string[] = []
    for (let i = 0; i < 5; i++) {
      const listed = await callOperation({ socketPath: harness.frontDoorSocketPath, operation: 'listSessions', params: {} })
      const body = listed.body as { ok?: boolean; result?: { sessions?: Array<{ id?: string }> } }
      const order = body.ok ? (body.result?.sessions ?? []).map((s) => String(s.id)) : []
      if (i > 0 && JSON.stringify(order) !== JSON.stringify(lastOrder)) mergeStable = false
      lastOrder = order
    }
    record('T-27: listSessions merge order-stable x5', mergeStable, `last order: ${JSON.stringify(lastOrder)}`)

    // T-27 — closeAllSessions fans out to both sides; aggregate counts,
    // both sides proven closed (a subsequent snapshot on either leg's
    // session id now 404s / tunnels-to-not_found).
    const closedAll = await callOperation({ socketPath: harness.frontDoorSocketPath, operation: 'closeAllSessions', params: {} })
    const closedOk = (closedAll.body as { ok?: boolean }).ok === true
    record('T-27: closeAllSessions fanout succeeds', closedOk, JSON.stringify(closedAll.body).slice(0, 300))
  } finally {
    await harness.close()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// T-26 — capability-gate mutation. MANUAL, per G1 Gate D's own precedent:
// requires transiently editing CapabilityPolicy.swift (S1/S6-owned,
// pin-protected) — never automated from this agent's owned files.
// ═══════════════════════════════════════════════════════════════════════════
function gateT26Manual(): void {
  record(
    'T-26: capability-gate mutation (MANUAL — GV-4a style)',
    'manual',
    'Opus/S1 must, once at integration: (1) remove one CapabilityPolicy assertion for a G2 op in ' +
      'CapabilityPolicy.swift, rebuild, confirm the op now RED (capability_denied) under a restricted-capability ' +
      'caller, (2) restore the assertion, rebuild, confirm GREEN again. Evidence -> ' +
      '.build-loop/flip-evidence/gate-g2-capability-mutation.txt (mirrors gate-d-manual-mutation.txt\'s format).',
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// V-A (T-20) — headless contract conformance via the REAL 4 allowlist-
// importer vitest files, pointed at a standalone Swift daemon with
// SPECTRA_CONFORMANCE_MILESTONE=g2. Also asserts the DEFAULT (milestone
// unset) run stays byte-identical / the importer files show zero diff
// (Q-criterion "Importer-file freeze").
// ═══════════════════════════════════════════════════════════════════════════
function runVitest(files: string[], env: NodeJS.ProcessEnv, label: string): void {
  try {
    execFileSync(vitestBin, ['run', ...files], { cwd: repoRoot, env, stdio: ['ignore', 'inherit', 'inherit'] })
    record(label, true)
  } catch (error) {
    record(label, false, error instanceof Error ? error.message : String(error))
  }
}

function assertImporterFilesUnedited(): void {
  const importerFiles = [
    'tests/conformance/conformance.test.ts',
    'tests/conformance/capability-gate.test.ts',
    'tests/conformance/external-mode.test.ts',
    'tests/conformance/corpus/corpus.test.ts',
  ]
  try {
    const diff = execFileSync('git', ['diff', '--stat', 'HEAD', '--', ...importerFiles], { cwd: repoRoot }).toString().trim()
    record('Q-criterion: importer-file freeze (git diff empty)', diff.length === 0, diff.length === 0 ? '' : diff)
  } catch (error) {
    record('Q-criterion: importer-file freeze (git diff empty)', false, `git diff failed: ${error instanceof Error ? error.message : String(error)} (not a git repo? check manually)`)
  }
}

async function gateVA(bin: string): Promise<void> {
  console.log('\n=== V-A (T-20) — headless contract conformance, milestone-widened allowlist ===')
  assertImporterFilesUnedited()

  const home = mkdtempSync(join(tmpdir(), 'spectra-g2-va-home-'))
  const sock = join(home, 'daemon.sock')
  const routingConfigPath = join(home, 'routing-config.json')
  writeFileSync(routingConfigPath, JSON.stringify(G2_V2_ROUTING_CONFIG, null, 2))

  // [S7 ASSUMPTION]: the G1 rev-3 backend-aware fail-closed rule
  // (`SPECTRA_STANDALONE_SESSION_OPS=1` required to boot a session-coupled-
  // native config with no proxy backend) is assumed to generalize to v2's
  // affinity/merge/fanout buckets too — Router.swift v2 is S6's own file,
  // not frozen by W0 down to this exact env-var behavior. If S6's v2 loader
  // uses a different opt-in (or none), this boot step needs updating at
  // integration — flagged here rather than silently assumed correct.
  const boot = await bootDaemon(
    bin,
    sock,
    bootEnvFor(sock, home, {
      SPECTRA_CONFORMANCE_SEED: '1',
      SPECTRA_ROUTING_CONFIG: routingConfigPath,
      SPECTRA_STANDALONE_SESSION_OPS: '1',
    }),
  )
  if (!boot.bound) {
    record('V-A: Swift daemon boot (g2 v2 config, standalone)', false, `exit ${String(boot.exitCode)}; stderr: ${boot.stderr()}`)
    rmSync(home, { recursive: true, force: true })
    return
  }
  record('V-A: Swift daemon boot (g2 v2 config, standalone)', true)

  try {
    // Advisor ruling 2 (docs/plans/m3-g2-vb-advisor-ruling-2.md, Item 2) —
    // split off corpus/corpus.test.ts into its OWN vitest invocation,
    // byte-mirroring Gate A's proven-green corpus recipe: `milestone=g2`
    // widens conformance/external-mode/capability-gate's allowlist (that
    // widening is intentional and correct — its own V-A shape+success check
    // covers createSession under `fake:`), but it also un-skips corpus's
    // recorded WEB-target createSession row, which is regenerated under a
    // DIFFERENT (fake:) target by payload-generator.ts and compared against
    // an original recording whose outcome is itself real-Chrome
    // non-deterministic — not a valid comparison on its own terms (see the
    // ruling's Item 2 grounding). Running corpus WITHOUT the milestone env
    // restores its ORIGINAL G1 `externalSkipReason` skip for createSession
    // and loses nothing else (every other corpus entry is governed by the
    // swift-native-corpus rule regardless of the allowlist).
    const milestoneWidenedFiles = [
      'tests/conformance/conformance.test.ts',
      'tests/conformance/external-mode.test.ts',
      'tests/conformance/capability-gate.test.ts',
    ]
    runVitest(
      milestoneWidenedFiles,
      { ...process.env, SPECTRA_DAEMON_SOCKET: sock, SPECTRA_CONFORMANCE_MILESTONE: 'g2' },
      'V-A: 3 allowlist-importer files vs Swift (SPECTRA_CONFORMANCE_MILESTONE=g2 — 24-op widened allowlist)',
    )

    const corpusEnv: NodeJS.ProcessEnv = { ...process.env, SPECTRA_DAEMON_SOCKET: sock, SPECTRA_CONFORMANCE_SEED_SESSION: 'conformance-seed' }
    // `{...process.env}` INHERITS a set `SPECTRA_CONFORMANCE_MILESTONE` from
    // the parent process — deleting the key (not merely leaving it unset)
    // is required so this arm byte-mirrors Gate A's corpus recipe exactly,
    // per the ruling's explicit instruction ("DELETED from the child env,
    // not merely un-set").
    delete corpusEnv.SPECTRA_CONFORMANCE_MILESTONE
    runVitest(
      ['tests/conformance/corpus/corpus.test.ts'],
      corpusEnv,
      'V-A: corpus/corpus.test.ts vs Swift (Gate-A corpus recipe — milestone unset, SPECTRA_CONFORMANCE_SEED_SESSION=conformance-seed)',
    )
  } finally {
    await stopDaemon(boot.proc)
    rmSync(home, { recursive: true, force: true })
  }

  // Default-mode regression floor: re-run conformance.test.ts with the
  // milestone env UNSET against the SAME binary — must behave exactly like a
  // G1-only daemon (only the 11 control-plane ops verified; the other 19
  // skipped). This is the literal T-20 falsifier: "default-mode behavior
  // change".
  const home2 = mkdtempSync(join(tmpdir(), 'spectra-g2-va-default-home-'))
  const sock2 = join(home2, 'daemon.sock')
  const routingConfigPath2 = join(home2, 'routing-config.json')
  writeFileSync(routingConfigPath2, JSON.stringify(ALL_11_NATIVE_V1_ROUTING_CONFIG, null, 2))
  const boot2 = await bootDaemon(
    bin,
    sock2,
    bootEnvFor(sock2, home2, { SPECTRA_CONFORMANCE_SEED: '1', SPECTRA_ROUTING_CONFIG: routingConfigPath2, SPECTRA_STANDALONE_SESSION_OPS: '1' }),
  )
  if (boot2.bound) {
    try {
      runVitest(
        ['tests/conformance/conformance.test.ts'],
        {
          ...process.env,
          SPECTRA_DAEMON_SOCKET: sock2, // SPECTRA_CONFORMANCE_MILESTONE deliberately UNSET
          // Item (i) DIAGNOSIS + FIX (fix-work-list): this arm was RED —
          // "getRun, getSession only ever produced error responses (D1
          // guard)" — even though SessionOps.swift's getSession/getRun
          // handlers unconditionally call `ensureConformanceSeed` before
          // their not-found check, so the fixed `conformance-seed` session
          // DOES exist Swift-side. Root-caused by diffing this boot/env
          // against the GREEN verify-flip-suite.ts Gate A recipe (same
          // binary, green there): Gate A sets
          // `SPECTRA_CONFORMANCE_SEED_SESSION=conformance-seed` (its
          // `SEED_SESSION` const) so `buildFixtureContext`
          // (tests/conformance/lib/fixture-context.ts:233-241) takes the
          // "Tier-2 option A" branch and points getSession/getRun's fixture
          // sessionId straight at that KNOWN seeded id. THIS arm never set
          // that env var, so `buildFixtureContext` fell through to "Tier-1
          // wire seeding" (`seedExternalSessions` -> a LIVE createSession
          // call) — but createSession is NOT in the v1
          // ALL_11_NATIVE_V1_ROUTING_CONFIG boot this arm uses (v1 is
          // control-plane-only by design), so that live call always fails
          // and `createExternalSession` degrades to the literal string
          // 'unavailable' as the "sessionId" — an always-not_found probe.
          // VERDICT: harness bug (S7), NOT an S1 Swift seed-hook regression
          // — the seed hook itself is unconditional and correct; this arm's
          // env was simply missing the one var Gate A's recipe always sets.
          // Fixed here to match Gate A's recipe exactly (the milestone=g2
          // v2-config V-A run above is deliberately left WITHOUT this var —
          // it intentionally exercises Tier-1 LIVE createSession/
          // DriverRegistry seeding instead, per seedExternalSessions's own
          // doc comment, which is stronger coverage for that arm and must
          // not be weakened).
          SPECTRA_CONFORMANCE_SEED_SESSION: 'conformance-seed',
        },
        'V-A: default-mode (milestone unset) stays byte-identical to G1 behavior',
      )
    } finally {
      await stopDaemon(boot2.proc)
    }
  } else {
    record('V-A: default-mode boot (all-11-native v1 config)', false, `exit ${String(boot2.exitCode)}`)
  }
  rmSync(home2, { recursive: true, force: true })
}

// ═══════════════════════════════════════════════════════════════════════════
// G1 31/31 arm — reuse the WHOLE verify-flip-suite.ts as a subprocess (see
// this file's header comment for why: it is not owned by this agent and
// exposes no narrower per-gate entry point).
// ═══════════════════════════════════════════════════════════════════════════
function runG1Arm(chainLabel: string): void {
  try {
    execFileSync(tsxBin, [join(daemonCoreDir, 'verify-flip-suite.ts')], { cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'] })
    record(`${chainLabel}: G1 31/31 arm (verify-flip-suite.ts full run, incl. Gate B-diff 31/31 + Gate B-e2e)`, true)
  } catch (error) {
    record(`${chainLabel}: G1 31/31 arm (verify-flip-suite.ts full run)`, false, error instanceof Error ? error.message : String(error))
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// V-B (T-21) comparator primitives — the pre-ruled G2 volatile-field map,
// implemented locally. Reuses ONLY the pure, already-exported utilities from
// front-door.ts (diffVolatilePaths/maskPaths/canonicalJson) — the rev-3.5
// class-pattern internals there are private and this agent's front-door.ts
// edits are scoped append-only (SG-2), so the (small) per-class logic below
// is a fresh, G2-scoped implementation, not a copy-with-export.
// ═══════════════════════════════════════════════════════════════════════════

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

type JsonPathToken = { kind: 'key'; key: string } | { kind: 'index'; index: number }

function tokenizePath(path: string): JsonPathToken[] {
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

function getByPath(value: unknown, path: string): { present: boolean; value: unknown } {
  let cur: unknown = value
  for (const token of tokenizePath(path)) {
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

function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Element-id-shaped strings never survive byte-comparison across legs by
 * construction: W0's frozen Driver protocol mandates Swift's snapshot()
 * assign SEQUENTIAL `e1..eN` ids every call, while TS's fakes.ts fixes
 * literal `el-1`/`el-2` ids. [S7 FLAG]: this divergence is NOT explicitly
 * named in the plan's pre-ruled G2 volatile-field map (only
 * `createSession.result.sessionId` is called a "generated-id"); it is
 * treated here BY ANALOGY because the W0 freeze makes it structurally
 * inevitable, not a defect. If this fires for real at integration it should
 * be confirmed/ratified by the Advisor rather than silently relied upon
 * (flagged in this run's console output + the persisted ledger). */
const ELEMENT_ID_PATTERNS = [/^e\d+$/, /^el-\d+$/]
// Deliberately NOT a `v is string` type predicate: every call site already
// narrows `v` to `string` first (via `typeof v === 'string'`), and a
// predicate that can't narrow any further than the already-known type
// forces TS to infer the negative (else) branch as `never` — exactly the
// footgun this plain-boolean signature avoids.
function isElementIdLike(v: string): boolean {
  return ELEMENT_ID_PATTERNS.some((re) => re.test(v))
}

/** Normalizes BOTH (a) known generated session/recording ids (via exact
 * whole-string match against `knownIds`) and (b) FakeDriver element ids
 * (both the whole-string form AND the `[e1]`/`[el-1]`-bracketed form
 * embedded inline in serialized snapshot text — src/core/serialize.ts's
 * `[${id}] ${role} "${label}"...` line format) to POSITIONAL tokens, scoped
 * to walking `value` (one leg's own response tree) so token numbering is
 * per-leg-consistent (both legs' first element -> `<ELEM_1>`, regardless of
 * whether the underlying literal id was `e1` or `el-1`). */
function normalizeVolatileIds(value: unknown, knownIds: ReadonlyMap<string, string>): unknown {
  const elementIdTokens = new Map<string, string>()
  let elementCounter = 0
  const tokenFor = (id: string): string => {
    if (!elementIdTokens.has(id)) elementIdTokens.set(id, `<ELEM_${++elementCounter}>`)
    return elementIdTokens.get(id) as string
  }
  function walk(v: unknown): unknown {
    if (typeof v === 'string') {
      if (knownIds.has(v)) return knownIds.get(v)
      if (isElementIdLike(v)) return tokenFor(v)
      let out = v
      for (const [raw, token] of knownIds) out = out.split(raw).join(token)
      out = out.replace(/\[(e\d+)\]/g, (_m, id: string) => `[${tokenFor(id)}]`)
      out = out.replace(/\[(el-\d+)\]/g, (_m, id: string) => `[${tokenFor(id)}]`)
      return out
    }
    if (Array.isArray(v)) return v.map(walk)
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v)) out[k] = walk(val)
      return out
    }
    return v
  }
  return walk(value)
}

type G2Class = 'duration' | 'embedded-content' | 'temp-path' | 'stateful-read-timestamp' | 'error-metadata'

const DURATION_LEAF_KEYS: ReadonlySet<string> = new Set(['duration', 'durationMs', 'duration_ms'])
const STATEFUL_TIMESTAMP_LEAF_KEYS: ReadonlySet<string> = new Set(['createdAt', 'updatedAt', 'startedAt'])

/** The G2 pre-ruled map, resolved per-op (plan §"G2 volatile-field map"). */
function classifyG2LeafPath(op: string, path: string): G2Class | undefined {
  if (path === 'result.snapshot' || path === 'result.finalSnapshot') return 'embedded-content'
  const tokens = tokenizePath(path)
  if (tokens.length < 2 || tokens[0].kind !== 'key' || tokens[0].key !== 'result') return undefined
  const last = tokens[tokens.length - 1]
  if (last.kind !== 'key') return undefined
  if (SIX_OPS.has(op)) {
    if (DURATION_LEAF_KEYS.has(last.key)) return 'duration'
    if (last.key === 'screenshotPath') return 'temp-path'
  }
  if (op === 'recordTerminal') {
    if (last.key === 'castFile') return 'temp-path'
    if (last.key === 'duration') return 'duration'
  }
  // getRecording success arm (fix-work-list item 5, harness-consume half):
  // `result.recording.outPath`/`.path` is a fresh per-leg temp path (session
  // dir under each leg's own temp HOME) — `temp-path`-classed, same treatment
  // as the six-op class's `screenshotPath`. `recordingId`/nested `sessionId`
  // are NOT classified here — they are resolved to byte-identical sentinels
  // upstream via the call-site's extended `knownIds` map (generated-id
  // normalization), so no residual divergence reaches this classifier for
  // them at all.
  if (op === 'getRecording') {
    if (last.key === 'outPath' || last.key === 'path') return 'temp-path'
  }
  // `stateful-read-timestamp` (CONDITIONALLY pre-approved, auto-applies on
  // first observed flake — see the plan's map row) is scoped to any op whose
  // result carries a createdAt/updatedAt/startedAt leaf, which for G2's own
  // 16-op set is realistically only getRecording's nested `recording` record.
  if (STATEFUL_TIMESTAMP_LEAF_KEYS.has(last.key)) return 'stateful-read-timestamp'
  return undefined
}

function classPatternGuardFailure(cls: G2Class, value: unknown): string | undefined {
  if (cls === 'duration') {
    if (typeof value !== 'number' || Number.isNaN(value)) return `expected a JSON number, got ${jsonTypeOf(value)}`
    if (value < 0) return `expected a number >= 0, got ${value}`
    return undefined
  }
  if (cls === 'stateful-read-timestamp') {
    if (typeof value === 'number' && value > 0) return undefined
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return undefined
    return `expected a number > 0 or an ISO timestamp string, got ${jsonTypeOf(value)} (${JSON.stringify(value)})`
  }
  // embedded-content / temp-path: a non-empty string.
  if (typeof value !== 'string') return `expected a non-empty string, got ${jsonTypeOf(value)}`
  if (value.length === 0) return 'expected a non-empty string, got ""'
  return undefined
}

/** Fields that are ALWAYS excluded from the byte compare, for reasons that
 * are NOT the pre-ruled volatility map (they are envelope-mechanical, not
 * semantic): `requestId`/`timestamp` differ per call by construction (two
 * SEPARATE calls to two SEPARATE daemons, unlike G1's tunnel-fidelity model
 * where the SAME request is replayed) and `caller`/`deliveryPath` are TS's
 * OWN envelope fields (src/daemon/envelope.ts) that Swift's WireProtocol.swift
 * never emits AT ALL (verified: `successEnvelope`/`errorEnvelope` there build
 * exactly `{apiVersion, ok, result|error, timestamp, requestId?}`) — their
 * absence on the Swift leg is an EXPECTED, DOCUMENTED structural asymmetry
 * between two independent envelope implementations, not a hidden divergence
 * a mask is covering up. */
const ALWAYS_EXCLUDED_PATHS: ReadonlySet<string> = new Set(['requestId', 'timestamp', 'caller', 'deliveryPath'])

/** Advisor ruling Item 7 / fix-work-list (a): the two documented envelope-
 * metadata keys (`caller`/`deliveryPath`) must be DELETED, not value-masked.
 * `maskPaths` only replaces the VALUE at a path that exists on both trees —
 * it cannot resolve a key that is PRESENT on one leg (TS's own envelope) and
 * ABSENT on the other (Swift's WireProtocol.swift never emits them), because
 * `diffVolatilePaths` flags key-presence mismatches (`!(k in a) || !(k in
 * b)`) independently of value-masking. `dropKeys` removes the key outright
 * (recursively — the two names are envelope-only, but recursing is harmless)
 * on BOTH legs before the residual diff runs, so an asymmetric present/absent
 * pair can never surface as a false "NAMED DIVERGENCE". */
const ENVELOPE_DROP_KEYS: ReadonlySet<string> = new Set(['caller', 'deliveryPath'])
function dropKeys(value: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => dropKeys(v, keys))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (keys.has(k)) continue
      out[k] = dropKeys(v, keys)
    }
    return out
  }
  return value
}

/** Addendum (2026-07-03) — "New class — error-envelope optional metadata":
 * `error.code` (+ the HTTP status the transport carries) is the ONLY thing
 * error comparison asserts; `error.message`/`error.details`/`error.retryable`
 * are masked. Grounded per the ruling: (1) `message` is pre-ruled free-text
 * (plan §Verification) — TS's `apiErrorBody` (src/daemon/envelope.ts:47-56)
 * emits verbose wording, Swift's `WireProtocol.swift:126` emits terser
 * wording for the SAME code, so the value differs even when the classification
 * is identical; (2) `details`/`retryable` are `.optional()` contract fields
 * (src/contract/schemas.ts:573-576 `apiErrorBodySchema`) — TS's envelope
 * builder always emits `retryable` (default `false`) + `details`, Swift's
 * error envelope emits only `{code, message}` (WireProtocol.swift:126), so
 * these two are a KEY-PRESENCE asymmetry, not just a differing value — the
 * exact same shape as Item 7's caller/deliveryPath, which is why they need
 * path-exact deletion (not `maskPaths` value-substitution: that cannot
 * resolve a key present on one leg and wholly absent on the other, since
 * `diffVolatilePaths` flags key-presence mismatches independently of value
 * masking — see `dropKeys`'s own doc comment for the identical mechanism).
 * Scoped by EXACT PATH (not bare key name) so an unrelated `message`/
 * `details`/`retryable` field elsewhere in a result body is never
 * accidentally masked — none currently exist in the G2 op set's success
 * bodies (verified: no such keys in fakes.ts/src/core's result shapes), but
 * exact-path scoping keeps that true by construction rather than by luck.
 * Making Swift emit `details`/`retryable` is "optional envelope metadata
 * emission" — the identical §Out-of-scope clause that rejected doing the
 * same for caller/deliveryPath (Item 7, option (c)). Floor preserved:
 * `error.code` is NOT in this set and stays fully compared — a wrong code is
 * still a REAL FAIL, never masked. */
const ERROR_METADATA_PATHS: ReadonlySet<string> = new Set(['error.message', 'error.details', 'error.retryable'])
function dropExactPaths(value: unknown, paths: ReadonlySet<string>, prefix = ''): unknown {
  if (Array.isArray(value)) {
    return value.map((v, i) => dropExactPaths(v, paths, prefix ? `${prefix}[${i}]` : `[${i}]`))
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const childPrefix = prefix ? `${prefix}.${k}` : k
      if (paths.has(childPrefix)) continue
      out[k] = dropExactPaths(v, paths, childPrefix)
    }
    return out
  }
  return value
}

/** Ported verbatim (rationale + implementation) from front-door.ts:774's
 * `isUnderResultTimeline` — that function is not exported and front-door.ts
 * is out of this agent's owned set (SG-2 append-only scope), so this is a
 * fresh, G2-scoped copy, not a re-export. Whether `path` (a
 * `diffVolatilePaths`-shaped JSON path) names `result.timeline` itself or
 * something nested under it — recordTerminal judges this subtree
 * STRUCTURALLY (see `validateRecordTerminalTimelineShape`'s G2 analog below),
 * never by byte-compare (Advisor ruling Item 3 / fix-work-list (c)). */
function isUnderResultTimeline(path: string): boolean {
  return path === 'result.timeline' || path.startsWith('result.timeline.') || path.startsWith('result.timeline[')
}

/** Advisor ruling Item 2 / fix-work-list (d): both V-B legs run under
 * INDEPENDENT temp HOMEs (`spectra-conformance-home-*` for the TS leg,
 * `spectra-g2-vb*-home-*` for the Swift leg), both created via
 * `mkdtempSync(join(tmpdir(), <prefix>))` — i.e. each is a single path
 * segment placed DIRECTLY under `os.tmpdir()`. Home-root normalization
 * therefore does not need either leg's own literal home-dir string (TS's is
 * not even exposed by `DaemonEndpoint`): strip `tmpdir()` plus exactly the
 * NEXT path segment (the mkdtemp'd home dir itself) and replace it with the
 * sentinel `<HOME>` — the remaining SUFFIX (e.g. `.spectra/sessions/<id>/…`
 * vs `sessions/<id>/…`) stays byte-compared, which is what must keep
 * convicting today's missing-`.spectra/` divergence (S1) until that lands. */
function normalizeHomeRootPrefix(path: string): string {
  const tmp = tmpdir()
  if (!path.startsWith(tmp)) return path
  const rest = path.slice(tmp.length).replace(/^[/\\]/, '')
  const sepIdx = rest.indexOf('/')
  if (sepIdx === -1) return '<HOME>'
  return `<HOME>/${rest.slice(sepIdx + 1)}`
}

/** Applies `fn` to the named top-level `result.<field>` string leaves of a
 * response body, returning a shallow-cloned copy — used by the discover arm
 * (Item 2 / (d)) to home-root-normalize `manifestPath`/`outputDir` BEFORE
 * they reach `compareG2Op`'s byte compare, without mutating the original
 * response object (still available for logging on failure). */
function mapResultStringFields(body: unknown, fields: readonly string[], fn: (s: string) => string): unknown {
  if (!isPlainObject(body)) return body
  const result = body.result
  if (!isPlainObject(result)) return body
  const newResult: Record<string, unknown> = { ...result }
  for (const f of fields) {
    const v = newResult[f]
    if (typeof v === 'string') newResult[f] = fn(v)
  }
  return { ...body, result: newResult }
}

/** PC-4 structural floor (Minor B condition / fix-work-list (f)): parses one
 * leg's serialized snapshot text (src/core/serialize.ts's
 * `[<id>] role "label" prop1, prop2, …` line format, `serializeElement`) into
 * a per-element structural record. Only the properties PC-4 needs to assert
 * are extracted — anything else on the line (`focused`, `parent:`) is
 * ignored, not a divergence source. */
interface ParsedSnapshotElement {
  id: string
  role: string
  label: string
  hasValue: boolean
  hasEnabled: boolean
  enabled: boolean | undefined
  actions: string[] | undefined
  bounds: number[] | undefined
}

/** Splits a `serializeElement` property tail on top-level `, ` separators —
 * NOT a plain `.split(', ')`, because `actions:[click,type]` embeds commas
 * inside its own brackets that must not be treated as property boundaries. */
function splitTopLevelProps(tail: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < tail.length; i++) {
    const ch = tail[i]
    if (ch === '[') depth++
    if (ch === ']') depth--
    if (depth === 0 && tail.slice(i, i + 2) === ', ') {
      parts.push(cur)
      cur = ''
      i++ // skip the space
      continue
    }
    cur += ch
  }
  if (cur.length > 0) parts.push(cur)
  return parts
}

function parseSerializedSnapshot(text: string): ParsedSnapshotElement[] {
  const out: ParsedSnapshotElement[] = []
  const lineRe = /^\[([^\]]+)\]\s+(\S+)\s+"([^"]*)"(?:\s+(.*))?$/
  for (const line of text.split('\n')) {
    const m = lineRe.exec(line)
    if (!m) continue
    const [, id, role, label, tail] = m
    const el: ParsedSnapshotElement = { id, role, label, hasValue: false, hasEnabled: false, enabled: undefined, actions: undefined, bounds: undefined }
    if (tail) {
      for (const prop of splitTopLevelProps(tail)) {
        if (prop.startsWith('value="')) {
          el.hasValue = true
        } else if (prop === 'enabled' || prop === 'disabled') {
          el.hasEnabled = true
          el.enabled = prop === 'enabled'
        } else if (prop.startsWith('actions:[')) {
          const inner = prop.slice('actions:['.length, -1)
          el.actions = inner.length === 0 ? [] : inner.split(',')
        } else if (prop.startsWith('bounds:[')) {
          const inner = prop.slice('bounds:['.length, -1)
          el.bounds = inner.split(',').map(Number)
        }
      }
    }
    out.push(el)
  }
  return out
}

/** Strips element-id-like substrings from label text (bare, not just the
 * bracketed `[e1]`/`[el-1]` form `normalizeVolatileIds` already handles) so
 * two independently-generated-id label strings ("Fake Element el-1" vs
 * "Fake Element e1") compare equal post-normalization — the plan's
 * "labels-after-id-normalization" floor clause. */
function normalizeLabelForComparison(label: string): string {
  return label.replace(/\bel-\d+\b/g, '<ELEM_ID>').replace(/\be\d+\b/g, '<ELEM_ID>')
}

/** The PC-4 structural floor itself: element count, role sequence, labels
 * (post id-normalization), bounds numeric 4-tuples (non-negative w/h),
 * enabled/actions TYPE parity (presence + typed-shape, not value equality —
 * two independent fixtures are not expected to carry identical booleans/
 * members), and value-presence parity. Returns a non-empty failures array on
 * ANY violation — per the standing rule, a floor violation is a REAL FAIL,
 * never folded back into the embedded-content mask. */
function pc4StructuralFloor(tsSnapshotText: unknown, swiftSnapshotText: unknown): string[] {
  const failures: string[] = []
  if (typeof tsSnapshotText !== 'string' || typeof swiftSnapshotText !== 'string') {
    failures.push('PC-4 structural floor: snapshot text missing/non-string on one leg')
    return failures
  }
  const tsEls = parseSerializedSnapshot(tsSnapshotText)
  const swiftEls = parseSerializedSnapshot(swiftSnapshotText)
  if (tsEls.length !== swiftEls.length) {
    failures.push(`PC-4: element count mismatch ts=${tsEls.length} swift=${swiftEls.length}`)
    return failures
  }
  for (let i = 0; i < tsEls.length; i++) {
    const t = tsEls[i]
    const s = swiftEls[i]
    if (t.role !== s.role) failures.push(`PC-4: role[${i}] mismatch ts=${t.role} swift=${s.role}`)
    const tLabel = normalizeLabelForComparison(t.label)
    const sLabel = normalizeLabelForComparison(s.label)
    if (tLabel !== sLabel) failures.push(`PC-4: label[${i}] mismatch (post id-normalization) ts="${tLabel}" swift="${sLabel}"`)
    for (const [leg, el] of [['ts', t] as const, ['swift', s] as const]) {
      if (el.bounds) {
        if (el.bounds.length !== 4 || el.bounds.some((n) => typeof n !== 'number' || Number.isNaN(n))) {
          failures.push(`PC-4: bounds[${i}] on ${leg} leg is not a numeric 4-tuple (${JSON.stringify(el.bounds)})`)
        } else {
          const [, , w, h] = el.bounds
          if (w < 0 || h < 0) failures.push(`PC-4: bounds[${i}] on ${leg} leg has negative w/h (${w},${h})`)
        }
      }
    }
    if (t.hasEnabled !== s.hasEnabled) {
      failures.push(`PC-4: enabled-presence[${i}] type parity mismatch ts=${t.hasEnabled} swift=${s.hasEnabled}`)
    }
    if (t.hasEnabled && typeof t.enabled !== 'boolean') failures.push(`PC-4: enabled[${i}] on ts leg is not boolean`)
    if (s.hasEnabled && typeof s.enabled !== 'boolean') failures.push(`PC-4: enabled[${i}] on swift leg is not boolean`)
    const tHasActions = Array.isArray(t.actions)
    const sHasActions = Array.isArray(s.actions)
    if (tHasActions !== sHasActions) {
      failures.push(`PC-4: actions-presence[${i}] type parity mismatch ts=${tHasActions} swift=${sHasActions}`)
    }
    if (tHasActions && !(t.actions as string[]).every((a) => typeof a === 'string')) failures.push(`PC-4: actions[${i}] on ts leg is not string[]`)
    if (sHasActions && !(s.actions as string[]).every((a) => typeof a === 'string')) failures.push(`PC-4: actions[${i}] on swift leg is not string[]`)
    if (t.hasValue !== s.hasValue) failures.push(`PC-4: value-presence[${i}] parity mismatch ts=${t.hasValue} swift=${s.hasValue}`)
  }
  return failures
}

interface G2CompareResult {
  op: string
  ok: boolean
  detail: string
  appliedMask: string[]
  classPattern: Array<{ path: string; class: G2Class }>
}

/** The core V-B comparator: normalizes generated/element ids, then applies
 * the G2 pre-ruled map with typed guards, exactly mirroring rev-3.5's
 * discipline (a hit that fails its typed guard is a REAL FAIL, never
 * silently masked; any residual divergence outside the map is a REAL FAIL,
 * never a mask). */
function compareG2Op(
  op: string,
  tsBody: unknown,
  swiftBody: unknown,
  knownIds: ReadonlyMap<string, string>,
  /** Item 3 / (c) hook: an op-specific predicate for paths that are judged
   * STRUCTURALLY elsewhere (recordTerminal's `result.timeline`) and must
   * never reach the ordinary class-pattern/byte-compare machinery below —
   * distinct from `classifyG2LeafPath`'s pre-ruled map because it is scoped
   * to a single call site, not a standing G2-wide rule. */
  structuralExclude?: (path: string) => boolean,
): G2CompareResult {
  const failures: string[] = []
  const appliedMask = new Set<string>(ALWAYS_EXCLUDED_PATHS)
  const classPattern: Array<{ path: string; class: G2Class }> = []

  const tsOk = isPlainObject(tsBody) ? (tsBody as { ok?: unknown }).ok : undefined
  const swiftOk = isPlainObject(swiftBody) ? (swiftBody as { ok?: unknown }).ok : undefined
  if (tsOk !== swiftOk) {
    failures.push(`ok mismatch: ts=${String(tsOk)} swift=${String(swiftOk)}`)
  }

  const tsNorm = normalizeVolatileIds(tsBody, knownIds)
  const swiftNorm = normalizeVolatileIds(swiftBody, knownIds)

  const rawDivergence = diffVolatilePaths(tsNorm, swiftNorm)
  for (const path of rawDivergence) {
    if (ALWAYS_EXCLUDED_PATHS.has(path)) continue
    if (structuralExclude?.(path)) {
      appliedMask.add(path)
      continue
    }
    if (ERROR_METADATA_PATHS.has(path)) {
      // Addendum error-envelope-optional-metadata class: `details`/
      // `retryable` are expected PRESENT-ON-TS-ONLY (key-presence asymmetry,
      // not a same-shape value difference), so this must be special-cased
      // BEFORE the ordinary class-pattern flow below — that flow's
      // both-legs-present check would otherwise wrongly REAL FAIL the exact
      // asymmetry this class exists to mask. `error.code` is never in this
      // set and is unaffected.
      appliedMask.add(path)
      classPattern.push({ path, class: 'error-metadata' })
      continue
    }
    const cls = classifyG2LeafPath(op, path)
    if (!cls) {
      failures.push(`unmasked divergence outside the pre-ruled G2 map: "${path}" — stop, Advisor ruling required`)
      continue
    }
    const tsVal = getByPath(tsNorm, path)
    const swiftVal = getByPath(swiftNorm, path)
    if (!tsVal.present || !swiftVal.present) {
      failures.push(`class-pattern (${cls}) path "${path}" missing on ${!tsVal.present ? 'ts' : 'swift'} leg — REAL FAIL, not masked`)
      continue
    }
    const tsGuardFail = classPatternGuardFailure(cls, tsVal.value)
    const swiftGuardFail = classPatternGuardFailure(cls, swiftVal.value)
    if (tsGuardFail || swiftGuardFail) {
      failures.push(`class-pattern (${cls}) path "${path}" failed its typed guard — ts: ${tsGuardFail ?? 'ok'}; swift: ${swiftGuardFail ?? 'ok'}`)
      continue
    }
    if (cls === 'embedded-content') {
      // Minor B condition / PC-4 structural floor (fix-work-list (f)): a
      // non-empty-string guard alone is not the mandated floor — parse +
      // assert count/roles/labels/bounds/enabled/actions/value-presence. A
      // floor violation is a REAL FAIL and is NEVER added to appliedMask.
      const pc4Failures = pc4StructuralFloor(tsVal.value, swiftVal.value)
      if (pc4Failures.length > 0) {
        failures.push(`PC-4 structural floor violation(s) for "${path}": ${pc4Failures.join(' | ')}`)
        continue
      }
    }
    appliedMask.add(path)
    classPattern.push({ path, class: cls })
  }

  // Item 7 / (a): drop-keys BEFORE the residual diff — see `dropKeys`'s doc
  // comment for why `maskPaths` alone cannot resolve an asymmetric present/
  // absent caller/deliveryPath pair. Addendum: `error.details`/
  // `error.retryable` are the SAME asymmetry (see `ERROR_METADATA_PATHS`'s
  // doc comment) — dropped by exact path (not bare key name) so an unrelated
  // same-named field elsewhere in a result body is never masked.
  const tsForResidual = dropExactPaths(dropKeys(maskPaths(tsNorm, appliedMask), ENVELOPE_DROP_KEYS), ERROR_METADATA_PATHS)
  const swiftForResidual = dropExactPaths(dropKeys(maskPaths(swiftNorm, appliedMask), ENVELOPE_DROP_KEYS), ERROR_METADATA_PATHS)
  const residual = diffVolatilePaths(tsForResidual, swiftForResidual)
  if (residual.size > 0) {
    failures.push(
      `NAMED DIVERGENCE (outside the applied mask) on [${[...residual].sort().join(', ')}]: ` +
        `ts=${canonicalJson(tsForResidual).slice(0, 300)} swift=${canonicalJson(swiftForResidual).slice(0, 300)}`,
    )
  }

  return { op, ok: failures.length === 0, detail: failures.join(' | '), appliedMask: [...appliedMask].sort(), classPattern }
}

/** Reads a PNG's IHDR width/height without any external dependency — the
 * `generated-image-content` artifact probe (screenshot's pre-ruled row):
 * "both legs' files decode, equal pixel dimensions, non-empty · bytes NOT
 * compared". */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
function readPngDimensions(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return undefined
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function extractFirstElementId(snapshotText: unknown): string | undefined {
  if (typeof snapshotText !== 'string') return undefined
  const m = /^\[([^\]]+)\]\s+\S+/m.exec(snapshotText)
  return m?.[1]
}

// ═══════════════════════════════════════════════════════════════════════════
// V-B (T-21) — one differential chain: boot a fresh TS backend (in-process
// seeded) + a fresh standalone Swift daemon, drive both through the 16 G2
// ops with equivalent fixture inputs, compare per compareG2Op above, persist
// the mask ledger, then run the G1 31/31 arm.
// ═══════════════════════════════════════════════════════════════════════════
function loadPreviousMasks(path: string): Record<string, { appliedMask: string[] }> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, { appliedMask: string[] }>
  } catch {
    return {}
  }
}

function persistMasksAndWarnGrowth(masks: Record<string, G2CompareResult>): void {
  const previous = loadPreviousMasks(MASKS_EVIDENCE_PATH)
  for (const [op, entry] of Object.entries(masks)) {
    const prevSet = new Set(previous[op]?.appliedMask ?? [])
    const grown = entry.appliedMask.filter((p) => !prevSet.has(p))
    if (prevSet.size > 0 && grown.length > 0) {
      console.log(`  ⚠ G2 mask GROWTH for "${op}": new masked path(s) [${grown.join(', ')}] — flagged for Fable review, not a gate failure`)
    }
  }
  mkdirSync(dirname(MASKS_EVIDENCE_PATH), { recursive: true })
  writeFileSync(MASKS_EVIDENCE_PATH, JSON.stringify(masks, null, 2))
  console.log(`--- V-B mask ledger written to ${MASKS_EVIDENCE_PATH} ---`)
}

async function gateVB(bin: string, chainIndex: number): Promise<boolean> {
  const chainLabel = `V-B chain ${chainIndex}`
  console.log(`\n=== ${chainLabel} — differential semantic parity (T-21) ===`)

  const tsEndpoint: DaemonEndpoint = await startConformanceDaemon()
  const home = mkdtempSync(join(tmpdir(), `spectra-g2-vb${chainIndex}-home-`))
  const sock = join(home, 'daemon.sock')
  const routingConfigPath = join(home, 'routing-config.json')
  writeFileSync(routingConfigPath, JSON.stringify(G2_V2_ROUTING_CONFIG, null, 2))
  const scratchDir = mkdtempSync(join(tmpdir(), `spectra-g2-vb${chainIndex}-scratch-`))

  const masks: Record<string, G2CompareResult> = {}
  let chainOk = true

  const boot = await bootDaemon(
    bin,
    sock,
    // [S7 ASSUMPTION] — see gateVA's identical note re SPECTRA_STANDALONE_SESSION_OPS.
    bootEnvFor(sock, home, { SPECTRA_CONFORMANCE_SEED: '1', SPECTRA_ROUTING_CONFIG: routingConfigPath, SPECTRA_STANDALONE_SESSION_OPS: '1' }),
  )
  if (!boot.bound) {
    record(`${chainLabel}: Swift daemon boot`, false, `exit ${String(boot.exitCode)}; stderr: ${boot.stderr()}`)
    await tsEndpoint.close()
    rmSync(home, { recursive: true, force: true })
    rmSync(scratchDir, { recursive: true, force: true })
    return false
  }
  record(`${chainLabel}: Swift daemon boot`, true)

  try {
    // Copy the committed input fixtures (a valid .cast) into the scratch dir,
    // same convention as fixture-context.ts's own D5 fix.
    try {
      const { cpSync } = await import('node:fs')
      cpSync(FIXTURES_SRC_DIR, scratchDir, { recursive: true })
    } catch {
      // Best-effort — replayTerminal's arm below degrades to an error-shape
      // comparison if the fixture file genuinely isn't present.
    }

    // ── createSession — Swift leg only, restructured per Advisor ruling
    // Items 1+5 / fix-work-list (b). The TS-leg cross-leg comparison is a
    // PERMANENT CLASSED EXCLUSION, not a degrade-on-failure branch: TS's real
    // createSession constructs a REAL CdpDriver (no in-process fake seam on
    // that path — verified, fakes.ts/daemon-runner.ts), so there is no
    // headless TS fake-createSession seam this harness can drive at all. The
    // former `http://127.0.0.1:1/…` probe is REMOVED (quarantined, not
    // silently dropped — the log line below documents why): real Chrome
    // resolves that address to its OWN network-error page rather than
    // failing, so the probe was comparing a live Chrome DOM against the
    // 2-element ADR-06 seed, which violates V-B's own premise ("both legs
    // drive identical deterministic fixtures") and produced the
    // elementCount 13-vs-2 false finding. The Swift leg is instead asserted
    // ABSOLUTELY against the ADR-06 seed spec (fakes.ts:73-76) — stronger
    // than cross-leg equality, and immune to the TS-side non-determinism
    // that defeated the old comparison. ──
    record(
      `${chainLabel}: createSession — TS-leg cross-comparison`,
      'manual' as unknown as boolean, // permanent classed exclusion (Item 1+5), not silently dropped
      'permanent classed exclusion: TS createSession has no headless fake-driver seam (real CdpDriver only) — ' +
        'every OTHER op below still compares against a real pre-seeded TS FakeDriver session; createSession ' +
        'itself is judged by the Swift-leg absolute assertion below instead.',
    )
    const swiftCreated = await callOperation({ socketPath: sock, operation: 'createSession', params: { target: 'fake:conformance-seed' } })
    const swiftCreatedBody = swiftCreated.body as {
      ok?: boolean
      result?: { sessionId?: string; platform?: string; elementCount?: number }
    }
    const swiftCreateFailures: string[] = []
    if (swiftCreatedBody.ok !== true) swiftCreateFailures.push(`expected ok:true, got ${String(swiftCreatedBody.ok)}`)
    if (swiftCreatedBody.result?.elementCount !== 2) {
      swiftCreateFailures.push(`expected result.elementCount===2 (ADR-06 seed), got ${String(swiftCreatedBody.result?.elementCount)}`)
    }
    if (swiftCreatedBody.result?.platform !== 'web') {
      swiftCreateFailures.push(`expected result.platform==='web' (ADR-06 seed), got ${String(swiftCreatedBody.result?.platform)}`)
    }
    const swiftGeneratedId = swiftCreatedBody.result?.sessionId
    if (typeof swiftGeneratedId !== 'string' || swiftGeneratedId.length === 0) {
      swiftCreateFailures.push(`expected a non-empty generated-id sessionId, got ${JSON.stringify(swiftGeneratedId)}`)
    }
    record(
      `${chainLabel}: createSession (Swift leg, absolute vs ADR-06 seed)`,
      swiftCreateFailures.length === 0,
      swiftCreateFailures.length === 0 ? `sessionId=${String(swiftGeneratedId)}` : swiftCreateFailures.join(' | '),
    )
    if (swiftCreateFailures.length > 0) chainOk = false
    const swiftSessionId = swiftCreatedBody.result?.sessionId
    const tsSessionId = tsEndpoint.sessionIds?.web

    if (!swiftSessionId || !tsSessionId) {
      record(`${chainLabel}: V-B per-op loop`, false, 'missing a bootstrapped sessionId on one leg — aborting the rest of this chain')
      chainOk = false
    } else {
      const knownIds = new Map<string, string>([
        [tsSessionId, '<SESSION>'],
        [swiftSessionId, '<SESSION>'],
      ])

      // Resolve a real, per-leg actionable element id via a snapshot call —
      // mirrors fixture-context.ts's own findActionableElementId, since the
      // two legs' fixed elements have DIFFERENT id formats by construction
      // (see normalizeVolatileIds's doc comment).
      const tsSnap = await callOperation({ socketPath: tsEndpoint.socketPath, operation: 'snapshot', params: { sessionId: tsSessionId } })
      const swiftSnap = await callOperation({ socketPath: sock, operation: 'snapshot', params: { sessionId: swiftSessionId } })
      const tsElementId = extractFirstElementId((tsSnap.body as { result?: { snapshot?: string } }).result?.snapshot) ?? FAKE_ELEMENT_ID
      const swiftElementId = extractFirstElementId((swiftSnap.body as { result?: { snapshot?: string } }).result?.snapshot) ?? 'e1'

      const perOpParams: Record<string, { ts: unknown; swift: unknown }> = {
        snapshot: { ts: { sessionId: tsSessionId }, swift: { sessionId: swiftSessionId } },
        observe: { ts: { sessionId: tsSessionId }, swift: { sessionId: swiftSessionId } },
        act: {
          ts: { sessionId: tsSessionId, elementId: tsElementId, action: 'click' },
          swift: { sessionId: swiftSessionId, elementId: swiftElementId, action: 'click' },
        },
        step: { ts: { sessionId: tsSessionId, intent: 'click the button' }, swift: { sessionId: swiftSessionId, intent: 'click the button' } },
        llmStep: {
          ts: { sessionId: tsSessionId, actions: [{ type: 'click', elementId: tsElementId, intent: 'seed' }] },
          swift: { sessionId: swiftSessionId, actions: [{ type: 'click', elementId: swiftElementId, intent: 'seed' }] },
        },
        walkthrough: {
          ts: { sessionId: tsSessionId, steps: [{ intent: 'click the button', capture: false }] },
          swift: { sessionId: swiftSessionId, steps: [{ intent: 'click the button', capture: false }] },
        },
        analyze: { ts: { sessionId: tsSessionId }, swift: { sessionId: swiftSessionId } },
        discover: { ts: { sessionId: tsSessionId }, swift: { sessionId: swiftSessionId } },
        screenshot: { ts: { sessionId: tsSessionId }, swift: { sessionId: swiftSessionId } },
        // Error-taxonomy-only arms (headless legs cannot reach the real
        // SUCCESS path — plan's own scoping): use a session type each leg's
        // OWN implementation is expected to reject the SAME way.
        startRecording: { ts: { sessionId: tsSessionId }, swift: { sessionId: swiftSessionId } }, // 'web' platform, not macos+appName -> recording_failed both legs
        stopRecording: { ts: { sessionId: tsSessionId }, swift: { sessionId: swiftSessionId } }, // no active recording -> not_found/conflict-class both legs
        computerUse: { ts: { app: 'Fake Conformance App', action: { kind: 'snapshot' } }, swift: { app: 'Fake Conformance App', action: { kind: 'snapshot' } } },
        getRecording: { ts: { recordingId: 'g2-vb-unknown-recording-id' }, swift: { recordingId: 'g2-vb-unknown-recording-id' } }, // see the documented gap below
        recordTerminal: { ts: { command: 'echo spectra-conformance' }, swift: { command: 'echo spectra-conformance' } },
        replayTerminal: { ts: { file: `${scratchDir}/fixture-recording.cast` }, swift: { file: `${scratchDir}/fixture-recording.cast` } },
      }

      for (const op of G2_OPS) {
        if (op === 'createSession') continue // handled above
        const params = perOpParams[op]
        if (!params) {
          record(`${chainLabel}: ${op}`, false, 'no fixture params defined for this op — harness gap, not a real finding')
          chainOk = false
          continue
        }
        const [tsCall, swiftCall] = await Promise.all([
          callOperation({ socketPath: tsEndpoint.socketPath, operation: op, params: params.ts }).catch(
            (e): WireCallResult => ({ status: 0, requestId: '', body: { ok: false, error: { code: 'harness_call_failed', message: String(e) } } }),
          ),
          callOperation({ socketPath: sock, operation: op, params: params.swift }).catch(
            (e): WireCallResult => ({ status: 0, requestId: '', body: { ok: false, error: { code: 'harness_call_failed', message: String(e) } } }),
          ),
        ])

        // getRecording — SUCCESS-path arm (fix-work-list item 5,
        // harness-consume half). FROZEN INTERFACE (RecordingOps.swift's
        // `conformanceSeedRecordingId`): under `SPECTRA_CONFORMANCE_SEED=1`
        // the Swift leg seeds one readable recording at the exact literal
        // `conformance-seed-recording`; the TS leg has its OWN real seeded
        // recording (daemon-runner.ts's `seededRecording`, left ACTIVE —
        // "Left active; torn down on shutdown" — so its `state` is
        // `'recording'`, matching Swift's seed, which is ALSO always
        // `'recording'` by construction), forwarded as `tsEndpoint.recordingId`.
        // The two recordingId (and nested sessionId) literals can never be
        // byte-equal by construction — a DIFFERENT generated id per leg, same
        // shape as createSession's sessionId — so both are generated-id
        // normalized via a knownIds map extended for this one call, exactly
        // like Item 1's createSession fix. `outPath` is `temp-path`-classed
        // (classifyG2LeafPath); `startedAt`/`updatedAt` are already
        // `stateful-read-timestamp`-classed op-agnostically. `kind`/`state`
        // stay fully byte-compared (both sides are provably `'single-window'`/
        // `'recording'` — a divergence there would be a REAL FAIL, per the
        // standing "never hide a semantic divergence" floor).
        if (op === 'getRecording') {
          if (!tsEndpoint.recordingId) {
            record(`${chainLabel}: getRecording (SUCCESS-path, seeded recordingId)`, false, 'tsEndpoint.recordingId was undefined — cannot exercise the success arm')
            chainOk = false
          } else {
            const [tsGot, swiftGot] = await Promise.all([
              callOperation({ socketPath: tsEndpoint.socketPath, operation: 'getRecording', params: { recordingId: tsEndpoint.recordingId } }),
              callOperation({ socketPath: sock, operation: 'getRecording', params: { recordingId: 'conformance-seed-recording' } }),
            ])
            const successKnownIds = new Map(knownIds)
            successKnownIds.set(tsEndpoint.recordingId, '<RECORDING>')
            successKnownIds.set('conformance-seed-recording', '<RECORDING>')
            const tsInnerSessionId = (tsGot.body as { result?: { recording?: { sessionId?: string } } }).result?.recording?.sessionId
            const swiftInnerSessionId = (swiftGot.body as { result?: { recording?: { sessionId?: string } } }).result?.recording?.sessionId
            if (typeof tsInnerSessionId === 'string' && typeof swiftInnerSessionId === 'string') {
              successKnownIds.set(tsInnerSessionId, '<RECORDING_SESSION>')
              successKnownIds.set(swiftInnerSessionId, '<RECORDING_SESSION>')
            }
            const successCmp = compareG2Op('getRecording', tsGot.body, swiftGot.body, successKnownIds)
            record(`${chainLabel}: getRecording (SUCCESS-path, seeded recordingId)`, successCmp.ok, successCmp.detail)
            masks['getRecording:success'] = successCmp
            if (!successCmp.ok) chainOk = false
          }
        }

        if (ERROR_TAXONOMY_ONLY_OPS.has(op) || op === 'getRecording') {
          // Minor A / fix-work-list (e): the arm used to assume the ONLY
          // reachable outcome is both-legs-errored, and fell through to a
          // forced FAIL whenever both legs actually returned ok:true (the
          // observed stopRecording case: both `{alreadyStopped:true, error:
          // "No active recording for session <own id>"}` — semantically
          // identical, just raw-JSON-order/embedded-id different). Fixed:
          // both-ok (or both-error) routes through the real structural
          // comparator (canonicalJson + knownIds normalization + item-7's
          // key-drop); only a genuinely MIXED ok/error split falls back to
          // bare error-code equality (which a mixed split fails anyway,
          // since one side has no error.code to compare).
          const tsOkFlag = isPlainObject(tsCall.body) && (tsCall.body as { ok?: unknown }).ok === true
          const swiftOkFlag = isPlainObject(swiftCall.body) && (swiftCall.body as { ok?: unknown }).ok === true
          if (tsOkFlag === swiftOkFlag) {
            const cmp = compareG2Op(op, tsCall.body, swiftCall.body, knownIds)
            record(`${chainLabel}: ${op} (error-taxonomy arm)`, cmp.ok, cmp.detail)
            masks[op] = cmp
            if (!cmp.ok) chainOk = false
          } else {
            const tsErr = (tsCall.body as { ok?: boolean; error?: { code?: string } }).ok === false ? (tsCall.body as { error: { code: string } }).error.code : undefined
            const swiftErr = (swiftCall.body as { ok?: boolean; error?: { code?: string } }).ok === false ? (swiftCall.body as { error: { code: string } }).error.code : undefined
            const codesMatch = tsErr !== undefined && swiftErr !== undefined && tsErr === swiftErr
            record(
              `${chainLabel}: ${op} (error-taxonomy arm, mixed ok/error)`,
              codesMatch,
              codesMatch ? `both legs: ${tsErr}` : `ts=${JSON.stringify(tsCall.body).slice(0, 200)} swift=${JSON.stringify(swiftCall.body).slice(0, 200)}`,
            )
            if (!codesMatch) chainOk = false
          }
          continue
        }

        // replayTerminal — rev 3.3's exclusion stands: FULL byte-equality
        // (fixed fixture, no volatility expected at all).
        if (op === 'replayTerminal') {
          const cmp = compareG2Op(op, tsCall.body, swiftCall.body, knownIds)
          const strictOk = cmp.ok && cmp.appliedMask.every((p) => ALWAYS_EXCLUDED_PATHS.has(p))
          record(`${chainLabel}: ${op} (fully byte-compared, no volatility expected)`, strictOk, cmp.detail)
          masks[op] = cmp
          if (!strictOk) chainOk = false
          continue
        }

        // recordTerminal — result.timeline judged STRUCTURALLY (array of
        // {time,source,event}), never byte-compared; outputSize/lines/
        // fileChanges/exitCode stay fully byte-compared (deterministic for
        // the fixed command — a flake there is a FINDING).
        if (op === 'recordTerminal') {
          const tsTimeline = getByPath(tsCall.body, 'result.timeline').value
          const swiftTimeline = getByPath(swiftCall.body, 'result.timeline').value
          const structuralFailures: string[] = []
          for (const [leg, tl] of [['ts', tsTimeline] as const, ['swift', swiftTimeline] as const]) {
            if (!Array.isArray(tl)) {
              structuralFailures.push(`result.timeline on ${leg} leg is not an array`)
              continue
            }
            tl.forEach((el: unknown, i: number) => {
              if (!isPlainObject(el) || typeof el.event !== 'string' || typeof el.time !== 'number') {
                structuralFailures.push(`result.timeline[${i}] on ${leg} leg is not a valid {time,source,event} entry`)
              }
            })
          }
          // Item 3 / (c): exclude `result.timeline` and everything under it
          // from the byte compare (ported `isUnderResultTimeline`) — the
          // structural check above is the ONLY judgment applied to it.
          // outputSize/lines/exitCode/fileChanges stay fully byte-compared.
          const cmp = compareG2Op(op, tsCall.body, swiftCall.body, knownIds, isUnderResultTimeline)
          const ok = cmp.ok && structuralFailures.length === 0
          record(`${chainLabel}: ${op}`, ok, [cmp.detail, ...structuralFailures].filter(Boolean).join(' | '))
          masks[op] = cmp
          if (!ok) chainOk = false
          continue
        }

        // discover — home-root normalization for `result.manifestPath`/
        // `result.outputDir` (Item 2 / fix-work-list (d)): each leg's own
        // temp-HOME prefix is replaced with `<HOME>` before the byte
        // compare, but the SUFFIX stays compared — this must keep convicting
        // today's missing-`.spectra/` layout divergence (S1) until that
        // lands; it is NOT a path exclusion.
        if (op === 'discover') {
          const tsNormalizedBody = mapResultStringFields(tsCall.body, ['manifestPath', 'outputDir'], normalizeHomeRootPrefix)
          const swiftNormalizedBody = mapResultStringFields(swiftCall.body, ['manifestPath', 'outputDir'], normalizeHomeRootPrefix)
          const cmp = compareG2Op(op, tsNormalizedBody, swiftNormalizedBody, knownIds)
          record(`${chainLabel}: ${op}`, cmp.ok, cmp.detail)
          masks[op] = cmp
          if (!cmp.ok) chainOk = false
          continue
        }

        // screenshot — the generated-image-content artifact probe: decode +
        // dimension-equal, bytes NOT compared. result.path itself is always
        // excluded from the byte compare (a fresh temp path per leg).
        if (op === 'screenshot') {
          const tsPath = getByPath(tsCall.body, 'result.path').value
          const swiftPath = getByPath(swiftCall.body, 'result.path').value
          const artifactFailures: string[] = []
          let tsDims: { width: number; height: number } | undefined
          let swiftDims: { width: number; height: number } | undefined
          try {
            if (typeof tsPath === 'string') tsDims = readPngDimensions(readFileSync(tsPath))
          } catch (e) {
            artifactFailures.push(`ts screenshot file unreadable: ${String(e)}`)
          }
          try {
            if (typeof swiftPath === 'string') swiftDims = readPngDimensions(readFileSync(swiftPath))
          } catch (e) {
            artifactFailures.push(`swift screenshot file unreadable: ${String(e)}`)
          }
          if (!tsDims) artifactFailures.push('ts screenshot did not decode as a PNG')
          if (!swiftDims) artifactFailures.push('swift screenshot did not decode as a PNG')
          if (tsDims && swiftDims && (tsDims.width !== swiftDims.width || tsDims.height !== swiftDims.height)) {
            artifactFailures.push(`dimension mismatch: ts=${JSON.stringify(tsDims)} swift=${JSON.stringify(swiftDims)}`)
          }
          const screenshotMask = new Set([...ALWAYS_EXCLUDED_PATHS, 'result.path'])
          const tsNorm = normalizeVolatileIds(tsCall.body, knownIds)
          const swiftNorm = normalizeVolatileIds(swiftCall.body, knownIds)
          // Item 7 / (a): same drop-keys fix as compareG2Op's own residual —
          // caller/deliveryPath must be DELETED, not value-masked, before the
          // residual diff (see `dropKeys`'s doc comment).
          const residual = diffVolatilePaths(
            dropKeys(maskPaths(tsNorm, screenshotMask), ENVELOPE_DROP_KEYS),
            dropKeys(maskPaths(swiftNorm, screenshotMask), ENVELOPE_DROP_KEYS),
          )
          const ok = artifactFailures.length === 0 && residual.size === 0
          record(
            `${chainLabel}: ${op} (generated-image-content artifact probe)`,
            ok,
            [...artifactFailures, residual.size > 0 ? `residual envelope divergence: [${[...residual].join(', ')}]` : ''].filter(Boolean).join(' | '),
          )
          masks[op] = { op, ok, detail: artifactFailures.join(' | '), appliedMask: [...screenshotMask], classPattern: [] }
          if (!ok) chainOk = false
          continue
        }

        // The general case (analyze/snapshot/observe/act/step/llmStep/
        // walkthrough — discover has its own home-root-normalized arm
        // above): full compareG2Op with the pre-ruled classes.
        const cmp = compareG2Op(op, tsCall.body, swiftCall.body, knownIds)
        record(`${chainLabel}: ${op}`, cmp.ok, cmp.detail)
        masks[op] = cmp
        if (!cmp.ok) chainOk = false
      }
    }
  } finally {
    await stopDaemon(boot.proc)
    await tsEndpoint.close()
    rmSync(home, { recursive: true, force: true })
    rmSync(scratchDir, { recursive: true, force: true })
  }

  persistMasksAndWarnGrowth(masks)
  runG1Arm(chainLabel)

  return chainOk
}

// ═══════════════════════════════════════════════════════════════════════════
// main
// ═══════════════════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  console.log(
    '[verify-g2-suite] NOTE: this harness targets S1-S6\'s Swift implementations, which do not exist yet in ' +
      'this wave — every boot step below is EXPECTED to fail until those land (see this file\'s header comment). ' +
      'Run again at integration.',
  )
  if (!existsSync(TCC_SPIKE_EVIDENCE_PATH)) {
    console.log(
      `[verify-g2-suite] NOTE: ${TCC_SPIKE_EVIDENCE_PATH} not found — the T-25 step-1 TCC spike (production launch ` +
        'context) has not run yet. That evidence file is produced by verify-g2-ondevice.sh, not this script.',
    )
  }

  const { bin, binDir } = compileSwiftBinary()
  try {
    await gateT23(bin)
    await gateRoutingAndMergeFanout()
    gateT26Manual()
    await gateVA(bin)

    const chainCount = Number(process.env.SPECTRA_G2_CHAIN_COUNT ?? 3)
    let allChainsGreen = true
    for (let i = 1; i <= chainCount; i++) {
      console.log(`\n########## V-B differential chain ${i}/${chainCount} ##########`)
      const ok = await gateVB(bin, i)
      if (!ok) allChainsGreen = false
    }
    if (!allChainsGreen) {
      console.log(`\n*** At least one of the ${chainCount} V-B chains was NOT fully green — acceptance requires ${chainCount} CONSECUTIVE fully-green chains. ***`)
    }
  } finally {
    rmSync(binDir, { recursive: true, force: true })
  }

  console.log('\n=== verify-g2-suite summary ===')
  for (const r of results) {
    const marker = r.ok === 'manual' ? '○ MANUAL' : r.ok ? '✔' : '✗'
    console.log(`  ${marker} ${r.gate}${r.detail ? ' — ' + r.detail : ''}`)
  }
  const failed = results.filter((r) => r.ok === false)
  if (failed.length > 0) {
    console.log(`\n${failed.length} gate(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('\nAll automated gates passed. T-26 is MANUAL (see above). T-25 (V-C) is a separate, user-present script — verify-g2-ondevice.sh.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
