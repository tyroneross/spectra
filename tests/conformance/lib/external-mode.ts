// tests/conformance/lib/external-mode.ts
//
// M3 — external-daemon verifiable-op gating (docs/plans/m3-external-daemon-
// seeding.md, Tier-2 option (B): "external-mode op-skip list"). Tier-1 wire
// seeding (lib/fixture-context.ts's `seedExternalSessions`) makes the
// web/AX-read ops wire-seedable, but a real external (Swift) daemon cannot be
// driven headlessly through ops that need native capture permission, a
// booted simulator/real Chrome, or a pre-seeded recording — attempting those
// against an unknown external daemon would false-RED on fixture gaps that
// have nothing to do with the daemon's actual conformance.
//
// Modeled as an ALLOWLIST (`SWIFT_G1_VERIFIABLE_OPS`), not a hand-maintained
// skip list, and deliberately fail-safe: `EXTERNAL_ONLY_SKIP_OPS` is the
// complement of the allowlist against the LIVE set of operation names in
// contract.spec.json, so a future op the milestone allowlist hasn't been
// updated for defaults to SKIPPED in external mode (safe — no false-RED)
// rather than silently attempted (unsafe — could false-RED on a gap this
// harness never seeded for). When the Swift daemon's milestone grows past G1
// (e.g. adds AX-read support), extend `SWIFT_G1_VERIFIABLE_OPS` — never edit
// `EXTERNAL_ONLY_SKIP_OPS` directly, it is derived.
//
// M3.G1 flip (S4, additive): `listWindows` joins the allowlist below
// (shape-only — the window list itself is host-volatile, but the envelope +
// result shape is exactly as verifiable externally as the other G1
// control-plane ops; see docs/plans/m3-g1-flip-plan.md's plan-correction #3).
//
// M3.G1 flip (S4, env-gated, additive): `SPECTRA_CONFORMANCE_PROXY_FIDELITY`
// [ASSUMED name, reversible] is read ONLY at module load, and ONLY widens
// (never narrows) `SWIFT_G1_VERIFIABLE_OPS` to the full live operation set.
// This exists for exactly one caller: tests/conformance/lib/front-door.ts's
// proxy-mode harness (T-02, Gate B), which points the suite's
// `SPECTRA_DAEMON_SOCKET` at the Swift front door while its PROXY BACKEND is
// the harness's own fully-seeded TS daemon — i.e. every fixture seam a direct
// TS run has is available through the tunnel too, so the reason the skip-list
// exists (an external daemon might not implement a driver) does not apply and
// skipping would UNDER-test the exact proxy-fidelity path T-02 exists to
// prove. Unset (every other caller, including T-01's Gate-A run and the
// default `npm test`), this is a no-op: `SWIFT_G1_VERIFIABLE_OPS` is
// byte-identical to the historical 10(+listWindows)-op allowlist. This is a
// STRICTER default, never weaker: proxy-fidelity mode only ever ADDS
// coverage relative to the unset case.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EnrichedContractSpec } from '../../../src/contract/enriched-spec.js'

const here = dirname(fileURLToPath(import.meta.url))
const specPath = join(here, '..', '..', '..', 'src', 'contract', 'contract.spec.json')

/** The SWIFT G1 milestone daemon implements ONLY control-plane ops — no
 * driver (web/AX/native), no capture pipeline, no simulator. These are the
 * only ops this harness can verify against an arbitrary external daemon
 * without assuming it has a driver at all. `listWindows` is shape-only (the
 * live window list is host-volatile; boundary-value tests still apply). */
const SWIFT_G1_CONTROL_PLANE_OPS: ReadonlySet<string> = new Set([
  'health',
  'getPermissions',
  'requestPermissions',
  'listWindows',
  'listSessions',
  'getSession',
  'getRun',
  'closeSession',
  'closeAllSessions',
  'recordLlmUsage',
  'library',
])

function allOperationNames(): string[] {
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as EnrichedContractSpec
  return Object.keys(spec.operations)
}

/** Env-gated widening flag for the proxy-fidelity harness (see the doc
 * comment above `SWIFT_G1_VERIFIABLE_OPS`). Read once at module load — this
 * module is always freshly imported in a new process/worker per conformance
 * run (vitest per-file isolation / a fresh `tsx` child process), so a
 * long-lived process mutating the env var after import is not a supported
 * use case. */
const proxyFidelityMode = process.env.SPECTRA_CONFORMANCE_PROXY_FIDELITY === '1'

/** Every contract operation this harness will exercise against an external
 * daemon. Identical to the historical G1 control-plane allowlist UNLESS
 * `SPECTRA_CONFORMANCE_PROXY_FIDELITY=1`, in which case it is the full live
 * operation set (see the module doc comment — proxy-fidelity mode only ever
 * widens coverage, never narrows it). */
export const SWIFT_G1_VERIFIABLE_OPS: ReadonlySet<string> = proxyFidelityMode
  ? new Set(allOperationNames())
  : SWIFT_G1_CONTROL_PLANE_OPS

/** Every contract operation NOT in `SWIFT_G1_VERIFIABLE_OPS` — computed from
 * the live contract spec (not hardcoded) so it never drifts from the actual
 * 30-op surface. Includes ops that need a driver the Swift G1 daemon does not
 * implement (act, snapshot, observe, step, llmStep, walkthrough, analyze,
 * discover, computerUse, createSession, screenshot), ops that
 * need native capture / a real capture host (startRecording, stopRecording,
 * getRecording, recordComposite), and demo/terminal ops that drive a real
 * process or filesystem watcher this harness cannot guarantee headlessly on
 * an unknown external daemon (demo, autoRampDemo, recordTerminal,
 * replayTerminal). */
export const EXTERNAL_ONLY_SKIP_OPS: ReadonlySet<string> = new Set(
  allOperationNames().filter((op) => !SWIFT_G1_VERIFIABLE_OPS.has(op)),
)

/** Human-readable reason attached to `it.skip()` calls in conformance.test.ts
 * and corpus/corpus.test.ts when `endpoint.external` is true and the
 * operation is not in `SWIFT_G1_VERIFIABLE_OPS`. */
export function externalSkipReason(operation: string): string {
  return (
    `SPECTRA_DAEMON_SOCKET external mode: "${operation}" is not in the SWIFT G1 ` +
    'control-plane allowlist (lib/external-mode.ts SWIFT_G1_VERIFIABLE_OPS) — ' +
    'skipped rather than false-RED against a daemon that may not implement a ' +
    'driver/capture pipeline yet. See docs/plans/m3-external-daemon-seeding.md.'
  )
}
