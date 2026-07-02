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
 * without assuming it has a driver at all. */
export const SWIFT_G1_VERIFIABLE_OPS: ReadonlySet<string> = new Set([
  'health',
  'getPermissions',
  'requestPermissions',
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

/** Every contract operation NOT in `SWIFT_G1_VERIFIABLE_OPS` — computed from
 * the live contract spec (not hardcoded) so it never drifts from the actual
 * 30-op surface. Includes ops that need a driver the Swift G1 daemon does not
 * implement (act, snapshot, observe, step, llmStep, walkthrough, analyze,
 * discover, computerUse, createSession, screenshot, listWindows), ops that
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
