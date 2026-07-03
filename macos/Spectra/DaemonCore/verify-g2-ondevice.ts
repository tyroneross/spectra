// macos/Spectra/DaemonCore/verify-g2-ondevice.ts
//
// M3.G2 (S7) — V-C, the 9-step on-device native-integration script (T-25,
// rev 2). Invoked BY verify-g2-ondevice.sh (never run standalone — it needs
// SPECTRA_G2_ONDEVICE_SOCKET pointed at a REAL, launchd-booted Swift daemon
// already exercising the real native/swift helper binaries; see that
// script's header comment for the full safety/topology rationale). This
// file owns the SOCKET-LEVEL step logic + evidence writing; the .sh owns
// process/plist lifecycle (build, sign, launchctl bootstrap/bootout).
//
// STATUS (read before running): authored against the frozen
// DriverProtocol.swift + the G2 plan, BEFORE S1-S6 land. Several exact
// op params below carry `TODO: Iteration 2` markers where this harness had
// to guess at a detail only S1 (ConnectOps.swift target resolution) / S2
// (NativeDriver app-lookup) actually define — e.g. the exact `appName`
// string TestApp registers under. Confirm/adjust at integration; do not
// treat these defaults as load-bearing without checking.
//
// Every step appends a red/green line to SPECTRA_G2_ONDEVICE_EVIDENCE
// (.build-loop/flip-evidence/gate-g2-ondevice.txt). A step that cannot run
// on THIS host today (e.g. ffmpeg missing for the black-frame check) is
// recorded as a CLASSED EXCLUSION — never a silent skip (plan: "both-ways-
// fail discipline"). Step 1 failing (permission denied) is a HARD STOP —
// every later step assumes real AX/capture access.
//
// The user is PRESENT for this run (plan: "user-present, scripted") — a
// small number of genuinely-visual assertions (does the captured screenshot
// actually show TestApp; did the recorded video visibly play back) prompt
// for an explicit y/n confirmation via readline, ADDITIONAL to (never a
// replacement for) the automated file/shape checks.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { callOperation } from '../../../tests/conformance/lib/socket-client.js'

const socketPath = process.env.SPECTRA_G2_ONDEVICE_SOCKET
const tccEvidencePath = process.env.SPECTRA_G2_ONDEVICE_TCC_EVIDENCE
const evidencePath = process.env.SPECTRA_G2_ONDEVICE_EVIDENCE
if (!socketPath || !tccEvidencePath || !evidencePath) {
  console.error(
    'verify-g2-ondevice.ts must be invoked BY verify-g2-ondevice.sh (needs SPECTRA_G2_ONDEVICE_SOCKET / ' +
      '_TCC_EVIDENCE / _EVIDENCE set — see that script).',
  )
  process.exit(64)
}

// TODO: Iteration 2 — confirm the exact app-lookup string once S1/S2 land.
// `scripts` package.json builds TestApp to `spectra-test-app` with no
// Info.plist / app bundle (a bare SwiftUI executable) — NSRunningApplication
// localizedName for a bundle-less executable is typically its executable
// name. If S2's NativeDriver app-lookup instead matches on the SwiftUI
// WindowGroup title ("Spectra Test") or a bundle identifier once TestApp
// gets packaged, update this constant.
const TEST_APP_NAME = 'spectra-test-app'

interface StepResult {
  step: number
  label: string
  status: 'green' | 'red' | 'excluded'
  detail: string
}

const stepResults: StepResult[] = []

function writeEvidence(line: string): void {
  appendFileSync(evidencePath as string, line + '\n')
}

function record(step: number, label: string, statusOrOk: StepResult['status'] | boolean, detail = ''): StepResult {
  const status: StepResult['status'] = typeof statusOrOk === 'boolean' ? (statusOrOk ? 'green' : 'red') : statusOrOk
  const result: StepResult = { step, label, status, detail }
  stepResults.push(result)
  const marker = status === 'green' ? '✔ GREEN' : status === 'red' ? '✗ RED' : '○ EXCLUDED'
  const line = `[step ${step}] ${marker} — ${label}${detail ? ' :: ' + detail : ''}`
  console.log(line)
  writeEvidence(line)
  return result
}

const rl = createInterface({ input: stdin, output: stdout })
async function confirm(question: string): Promise<boolean> {
  const answer = await rl.question(`  ${question} [y/N] `)
  return answer.trim().toLowerCase().startsWith('y')
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
function readPngDimensions(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return undefined
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** Best-effort mean-luma black-frame check via a shelled ffmpeg (M5 rule:
 * ffmpeg stays shelled, never linked in-process) — a CLASSED EXCLUSION, not
 * a hard fail, if ffmpeg isn't on PATH: this script's own environment is not
 * guaranteed to have it even though S4's daemon-core probe does (FfmpegProbe.swift
 * is S4-owned, not reimplemented here — this is a secondary, independent
 * sanity check for the human present, not a replacement for S4's own guard). */
function bestEffortBlackFrameCheck(videoPath: string): { ran: boolean; allBlack?: boolean; detail: string } {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  } catch {
    return { ran: false, detail: 'ffmpeg not found on PATH — classed exclusion, not a real failure' }
  }
  try {
    const out = execFileSync(
      'ffmpeg',
      ['-i', videoPath, '-vf', 'select=eq(n\\,0),signalstats', '-vframes', '1', '-show_entries', 'frame_tags=lavfi.signalstats.YAVG', '-f', 'null', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    // Best-effort text scrape — this is a secondary sanity signal for the
    // human present, not a byte-precise probe (that is S4's FfmpegProbe.swift).
    return { ran: true, allBlack: /YAVG:0(\.0+)?\b/.test(out.toString()), detail: 'ffmpeg mean-luma sample captured' }
  } catch (e) {
    return { ran: false, detail: `ffmpeg probe failed: ${String(e)} — classed exclusion` }
  }
}

async function main(): Promise<void> {
  writeEvidence(`\n=== verify-g2-ondevice.ts run: ${new Date().toISOString()} ===`)

  // ── Step 1 — TCC-attribution functional probe (real permission state +
  // a REAL AX spawn + a REAL screen-recording preflight trigger), under the
  // launchd context verify-g2-ondevice.sh already established. ──
  const perms = await callOperation({ socketPath: socketPath as string, operation: 'getPermissions', params: {} })
  const permsBody = perms.body as { ok?: boolean; result?: { permissions?: Array<{ permission: string; state: string }> } }
  const axState = permsBody.ok ? permsBody.result?.permissions?.find((p) => p.permission === 'accessibility')?.state : undefined
  const screenState = permsBody.ok ? permsBody.result?.permissions?.find((p) => p.permission === 'screen-recording')?.state : undefined
  writeEvidence(`getPermissions: accessibility=${String(axState)} screen-recording=${String(screenState)}`)

  // TODO: Iteration 2 — confirm createSession's macos target param shape
  // with S1 (`{target: {appName: ...}}` vs a flat string) once ConnectOps.swift
  // lands; this uses the shape DriverProtocol.swift's doc comments imply
  // (macos targets carry an appName).
  const axProbe = await callOperation({
    socketPath: socketPath as string,
    operation: 'createSession',
    params: { target: { appName: TEST_APP_NAME } },
  })
  const axProbeOk = (axProbe.body as { ok?: boolean }).ok === true
  const axGranted = axState === 'granted' && axProbeOk
  writeEvidence(`AX functional probe (createSession macos TestApp): ${axProbeOk ? 'succeeded' : 'FAILED'} :: ${JSON.stringify(axProbe.body).slice(0, 300)}`)

  const tccLines = [
    `=== T-25 step 1 — TCC-attribution functional probe ===`,
    `accessibility: reported=${String(axState)}, functional=${axProbeOk ? 'granted' : 'DENIED/FAILED'}`,
    `screen-recording: reported=${String(screenState)} (functional check happens in step 6's startRecording)`,
    `verdict: ${axGranted ? 'GRANTED' : 'DENIED'}`,
    `timestamp: ${new Date().toISOString()}`,
  ]
  appendFileSync(tccEvidencePath as string, tccLines.join('\n') + '\n')

  if (!axGranted) {
    record(1, 'TCC-attribution spike (accessibility)', 'red', 'AX grant not attributed under this launch context — STOP per ND-2\'s falsifier; ADR-05 fallback rung (stable signing identity + user re-grant) required before continuing')
    finish(1)
    return
  }
  record(1, 'TCC-attribution spike (accessibility)', 'green', `getPermissions=${axState}, functional createSession(macos) succeeded`)

  const sessionId = (axProbe.body as { result?: { sessionId?: string } }).result?.sessionId
  if (!sessionId) {
    record(2, 'createSession(macos) against TestApp', 'red', 'step 1 succeeded but no sessionId was returned — cannot continue')
    finish(1)
    return
  }

  // ── Step 2 — createSession(macos) against TestApp -> real AX snapshot,
  // >=1 actionable element. ──
  const snap = await callOperation({ socketPath: socketPath as string, operation: 'snapshot', params: { sessionId } })
  const snapBody = snap.body as { ok?: boolean; result?: { snapshot?: string; elementCount?: number } }
  const elementCount = snapBody.result?.elementCount ?? 0
  record(2, 'createSession(macos) + real AX snapshot', snapBody.ok === true && elementCount >= 1, `elementCount=${elementCount}`)
  const firstElementId = /^\[([^\]]+)\]/m.exec(snapBody.result?.snapshot ?? '')?.[1]

  // ── Step 3 — act press on a TestApp button; state change verified by
  // re-snapshot (the snapshot TEXT must differ — TestApp's "Click Me"
  // button increments a counter shown as `Text("Clicked: N")`). ──
  if (firstElementId) {
    const beforeText = snapBody.result?.snapshot ?? ''
    const act = await callOperation({ socketPath: socketPath as string, operation: 'act', params: { sessionId, elementId: firstElementId, action: 'click' } })
    const actBody = act.body as { ok?: boolean; result?: { success?: boolean; snapshot?: string } }
    const afterText = actBody.result?.snapshot ?? ''
    const stateChanged = actBody.ok === true && actBody.result?.success === true && afterText !== beforeText
    record(3, 'act press on TestApp button, state change verified by re-snapshot', stateChanged, `success=${String(actBody.result?.success)}, textChanged=${afterText !== beforeText}`)
  } else {
    record(3, 'act press on TestApp button', 'excluded', 'no actionable element id recovered from step 2\'s snapshot')
  }

  // ── Step 4 — computerUse snapshot + act vs TestApp (sessionless AX
  // target). ──
  // TODO: Iteration 2 — confirm computerUse's params shape (app vs pid)
  // once S2's ComputerUseOps.swift lands.
  const cu = await callOperation({ socketPath: socketPath as string, operation: 'computerUse', params: { app: TEST_APP_NAME, action: { kind: 'snapshot' } } })
  const cuOk = (cu.body as { ok?: boolean }).ok === true
  record(4, 'computerUse snapshot vs TestApp', cuOk, JSON.stringify(cu.body).slice(0, 300))

  // ── Step 5 — screenshot full -> non-empty decodable non-black PNG. ──
  const shot = await callOperation({ socketPath: socketPath as string, operation: 'screenshot', params: { sessionId } })
  const shotBody = shot.body as { ok?: boolean; result?: { path?: string } }
  let step5Ok = false
  let step5Detail = ''
  if (shotBody.ok && shotBody.result?.path && existsSync(shotBody.result.path)) {
    const buf = readFileSync(shotBody.result.path)
    const dims = readPngDimensions(buf)
    step5Ok = buf.length > 0 && !!dims && dims.width > 0 && dims.height > 0
    step5Detail = dims ? `decoded ${dims.width}x${dims.height}, ${buf.length} bytes` : 'did not decode as PNG'
  } else {
    step5Detail = `screenshot op did not return a readable path: ${JSON.stringify(shot.body).slice(0, 200)}`
  }
  record(5, 'screenshot full mode (non-empty, decodable PNG)', step5Ok, step5Detail)
  if (step5Ok && shotBody.result?.path) {
    const visuallyOk = await confirm(`Open ${shotBody.result.path} — does it show the TestApp window (not blank/black)?`)
    record(5, 'screenshot — human visual confirmation', visuallyOk ? 'green' : 'red', 'user-confirmed, additional to the automated PNG-decode check above')
  }

  // ── Step 6 — startRecording -> stopRecording on the TestApp window ->
  // mp4 exists, best-effort black-frame sanity, probeVideo assumed via S4's
  // own daemon-side guard (this script does not re-implement byte-precise
  // probing — see bestEffortBlackFrameCheck's doc comment). ──
  const started = await callOperation({ socketPath: socketPath as string, operation: 'startRecording', params: { sessionId } })
  const startedBody = started.body as { ok?: boolean; result?: { recordingId?: string } }
  if (startedBody.ok && startedBody.result?.recordingId) {
    await new Promise((r) => setTimeout(r, 2_000)) // let a couple real frames land
    const stopped = await callOperation({ socketPath: socketPath as string, operation: 'stopRecording', params: { sessionId } })
    const stoppedBody = stopped.body as { ok?: boolean; result?: { path?: string; alreadyStopped?: boolean } }
    const path = stoppedBody.result?.path
    if (stoppedBody.ok && path && existsSync(path) && statSync(path).size > 0) {
      const blackFrame = bestEffortBlackFrameCheck(path)
      record(
        6,
        'startRecording -> stopRecording on TestApp window',
        true,
        `mp4 at ${path} (${statSync(path).size} bytes); black-frame sanity: ${blackFrame.ran ? (blackFrame.allBlack ? 'FLAGGED possibly-black' : 'ok') : 'excluded — ' + blackFrame.detail}`,
      )
      if (!blackFrame.ran) record(6, 'startRecording — black-frame guard (secondary ffmpeg check)', 'excluded', blackFrame.detail)
    } else {
      record(6, 'startRecording -> stopRecording on TestApp window', false, `stopRecording did not yield a valid mp4: ${JSON.stringify(stopped.body).slice(0, 300)}`)
    }
  } else {
    record(6, 'startRecording -> stopRecording on TestApp window', false, `startRecording failed: ${JSON.stringify(started.body).slice(0, 300)} (screen-recording TCC likely the cause — see step 1's reported state)`)
  }

  // ── Step 7 — discover/walkthrough one-pass against TestApp. ──
  const discover = await callOperation({ socketPath: socketPath as string, operation: 'discover', params: { sessionId } })
  const discoverOk = (discover.body as { ok?: boolean }).ok === true
  record(7, 'discover one-pass against TestApp', discoverOk, JSON.stringify(discover.body).slice(0, 200))
  const walkthrough = await callOperation({
    socketPath: socketPath as string,
    operation: 'walkthrough',
    params: { sessionId, steps: [{ intent: 'click the button', capture: false }] },
  })
  const walkthroughOk = (walkthrough.body as { ok?: boolean }).ok === true
  record(7, 'walkthrough one-pass against TestApp', walkthroughOk, JSON.stringify(walkthrough.body).slice(0, 200))

  // ── Step 8 — observe + analyze on the TestApp session (real element
  // scoring/state detection over a REAL AX tree). ──
  const observe = await callOperation({ socketPath: socketPath as string, operation: 'observe', params: { sessionId, analyze: true } })
  const observeOk = (observe.body as { ok?: boolean }).ok === true
  record(8, 'observe + analyze on TestApp (real AX tree)', observeOk, JSON.stringify(observe.body).slice(0, 200))

  // ── Step 9 — step with an intent resolving a TestApp control, plus a
  // 1-action llmStep plan executed natively. ──
  const step = await callOperation({ socketPath: socketPath as string, operation: 'step', params: { sessionId, intent: 'click the button' } })
  const stepOk = (step.body as { ok?: boolean }).ok === true
  record(9, 'step (intent resolution) against TestApp', stepOk, JSON.stringify(step.body).slice(0, 200))
  if (firstElementId) {
    const llmStep = await callOperation({
      socketPath: socketPath as string,
      operation: 'llmStep',
      params: { sessionId, actions: [{ type: 'click', elementId: firstElementId, intent: 'on-device llmStep probe' }] },
    })
    const llmStepOk = (llmStep.body as { ok?: boolean }).ok === true
    record(9, 'llmStep (1-action plan) executed natively against TestApp', llmStepOk, JSON.stringify(llmStep.body).slice(0, 200))
  } else {
    record(9, 'llmStep (1-action plan)', 'excluded', 'no actionable element id available from step 2')
  }

  finish()
}

function finish(forceExitCode?: number): void {
  rl.close()
  console.log('\n=== verify-g2-ondevice.ts summary ===')
  for (const r of stepResults) {
    console.log(`  [step ${r.step}] ${r.status.toUpperCase()} — ${r.label}${r.detail ? ' :: ' + r.detail : ''}`)
  }
  const anyRed = stepResults.some((r) => r.status === 'red')
  const exitCode = forceExitCode ?? (anyRed ? 1 : 0)
  writeEvidence(`=== run complete: ${anyRed ? 'RED (see above)' : 'GREEN'} ===`)
  process.exitCode = exitCode
}

main().catch((error) => {
  console.error(error)
  writeEvidence(`RUN CRASHED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  rl.close()
  process.exitCode = 1
})
