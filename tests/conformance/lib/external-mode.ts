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
// M3.G2 (S7, env-gated, additive — plan §Verification design, V-A):
// `SPECTRA_CONFORMANCE_MILESTONE` [ASSUMED name, reversible] is read ONLY at
// module load, same widen-only pattern as `SPECTRA_CONFORMANCE_PROXY_FIDELITY`
// above. When set to the literal string `"g2"`, `SWIFT_G1_VERIFIABLE_OPS`
// resolves to `SWIFT_G2_VERIFIABLE` (the G1 control-plane set UNION the 13
// headless-verifiable G2 ops — see that export's doc comment) instead of the
// historical G1-only set. **Pin P4 (SG-2/SG-5): the export NAME and the
// derived-skip-set semantics (`EXTERNAL_ONLY_SKIP_OPS`, `externalSkipReason`)
// are UNCHANGED** — every one of the 4 allowlist-importer test files
// (conformance.test.ts, capability-gate.test.ts, external-mode.test.ts,
// corpus/corpus.test.ts) keeps importing exactly `SWIFT_G1_VERIFIABLE_OPS` /
// `externalSkipReason` and needs ZERO edits; they simply observe a wider set
// when the caller (macos/Spectra/DaemonCore/verify-g2-suite.ts, this
// milestone's V-A runner) sets the env var before spawning them. Unset
// (every other caller, including every existing G1 gate and `npm test`),
// this is a no-op: `SWIFT_G1_VERIFIABLE_OPS` is byte-identical to the
// historical G1-only allowlist — verified by `git diff` showing zero changes
// to the 4 importer files (Q-criterion, "Importer-file freeze"). Precedence:
// `SPECTRA_CONFORMANCE_PROXY_FIDELITY=1` still wins over this flag if both
// are ever set (full op set is a superset of the g2-widened set) — the two
// flags are not expected to co-occur in practice (proxy-fidelity is a Gate-B
// tunnel-fidelity concern; milestone is a standalone-daemon-capability
// concern), but ordering the checks this way keeps the "only ever widens,
// never narrows" invariant true regardless.
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

/** M3.G2 (S7): read ONLY at module load (same rule as `proxyFidelityMode`
 * above) — `"g2"` is the one recognized value today; anything else
 * (including unset) leaves `SWIFT_G1_VERIFIABLE_OPS` at its historical G1
 * value. */
const milestoneG2 = process.env.SPECTRA_CONFORMANCE_MILESTONE === 'g2'

/** M3.G2 (S7): the 13 additional operations the G2-milestone Swift daemon
 * (ADR-06's FakeDriver seam + a real native `createSession`) can be verified
 * against HEADLESSLY, per docs/plans/m3-g2-plan.md §Verification design (V-A):
 * `createSession snapshot observe act step llmStep walkthrough analyze
 * discover screenshot getRecording recordTerminal replayTerminal`.
 * `startRecording`/`stopRecording`/`computerUse` are DELIBERATELY excluded —
 * their SUCCESS path needs real ScreenCaptureKit/AX (V-C, on-device only);
 * they still gain dedicated headless error-taxonomy coverage inside
 * conformance.test.ts's own per-op cases, which is orthogonal to this
 * allowlist (an op absent from this set is simply always skipped in
 * external mode, never partially covered by it). */
const SWIFT_G2_HEADLESS_OPS: ReadonlySet<string> = new Set([
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
  'getRecording',
  'recordTerminal',
  'replayTerminal',
])

/** M3.G2 (S7) — exported so `verify-g2-suite.ts` (V-A/V-B) can enumerate the
 * milestone's own op set directly rather than re-deriving it from the env
 * var a second, independently-fragile way. The G1 control-plane set UNION
 * the 13 headless G2 ops above — this is what `SWIFT_G1_VERIFIABLE_OPS`
 * resolves to when `SPECTRA_CONFORMANCE_MILESTONE=g2` (see below); it is a
 * SEPARATE, additively-named export precisely so the pinned
 * `SWIFT_G1_VERIFIABLE_OPS` name/semantics stay untouched (SG-5). */
export const SWIFT_G2_VERIFIABLE: ReadonlySet<string> = new Set([
  ...SWIFT_G1_CONTROL_PLANE_OPS,
  ...SWIFT_G2_HEADLESS_OPS,
])

/** Every contract operation this harness will exercise against an external
 * daemon. Identical to the historical G1 control-plane allowlist UNLESS
 * `SPECTRA_CONFORMANCE_PROXY_FIDELITY=1` (full live operation set) or
 * `SPECTRA_CONFORMANCE_MILESTONE=g2` (the `SWIFT_G2_VERIFIABLE` set above) —
 * see the module doc comment for both flags. Both are widen-only relative to
 * the unset default; proxy-fidelity takes precedence if both are ever set
 * (its set is a superset of the g2-widened set). **Default (both env vars
 * unset) is byte-identical to the historical G1-only allowlist — the exact
 * invariant the 4 allowlist-importer test files depend on needing ZERO
 * edits (SG-5).** */
export const SWIFT_G1_VERIFIABLE_OPS: ReadonlySet<string> = proxyFidelityMode
  ? new Set(allOperationNames())
  : milestoneG2
    ? SWIFT_G2_VERIFIABLE
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
