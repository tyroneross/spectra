// tests/conformance/conformance.test.ts
//
// M2B — THE parity oracle: a socket-level conformance suite that ANY daemon
// (TS today, Swift later) must pass over the real wire. For every one of the
// 30 contract operations (src/contract/contract.spec.json), generates valid +
// boundary request payloads from the enriched param schema, sends them over
// the REAL unix-domain socket to a running daemon, and validates the
// response: envelope shape (against the real zod envelope schemas), result
// shape (against the enriched RESULT descriptor, including nested fields),
// and error responses (against the op→error-code mapping).
//
// Daemon-agnostic: the socket path comes from startConformanceDaemon(), which
// honors SPECTRA_DAEMON_SOCKET (see daemon-endpoint.ts) — point it at a
// future Swift daemon's socket and this exact suite becomes the M3 cutover
// gate with zero changes.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { EnrichedContractSpec } from '../../src/contract/enriched-spec.js'
import { apiResponseEnvelopeSchema } from '../../src/contract/schemas.js'
import { startConformanceDaemon, type DaemonEndpoint } from './lib/daemon-endpoint.js'
import { callOperation } from './lib/socket-client.js'
import { invalidPayloads, validPayloads, type GeneratorContext } from './lib/payload-generator.js'
import { validateShape } from './lib/result-validator.js'
import { buildFixtureContext, withSessionOverride } from './lib/fixture-context.js'
import { orderedOperationNames } from './lib/op-order.js'
import { SWIFT_G1_VERIFIABLE_OPS, externalSkipReason } from './lib/external-mode.js'

const here = dirname(fileURLToPath(import.meta.url))
const specPath = join(here, '..', '..', 'src', 'contract', 'contract.spec.json')
const spec = JSON.parse(readFileSync(specPath, 'utf8')) as EnrichedContractSpec

let endpoint: DaemonEndpoint
let scratchDir: string
let genCtx: GeneratorContext

beforeAll(async () => {
  endpoint = await startConformanceDaemon()
  scratchDir = mkdtempSync(join(tmpdir(), 'spectra-conformance-fixtures-'))
  // buildFixtureContext wires genCtx.recordingId from the endpoint's
  // seeded-then-stopped recording (see daemon-runner.ts) — no live warm-up
  // call is needed; getRecording's success path is covered deterministically.
  genCtx = await buildFixtureContext(endpoint, scratchDir)
}, 30_000)

afterAll(async () => {
  await endpoint?.close()
  if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
})

// D1 fix: iterate ops so the SESSION-DESTROYING ops run LAST (shared ordering
// in lib/op-order.ts — the SAME order the corpus recorder uses, so the live
// suite and golden corpus can't drift). Both destroyers close the pre-seeded
// fake-driver fixture sessions the harness cannot re-create over the wire
// (createSession spawns a REAL driver — fixtures are injected in-process in
// daemon-runner.ts and are one-shot). Under the previous pure `.sort()`,
// closeAllSessions ran early and destroyed the fixtures, so ~14 session-
// dependent ops only exercised the session_not_found ERROR path — a broken
// daemon's SUCCESS-shape went untested. The D1 guard test below is the DURABLE
// protection: it fails if any succeedable op regresses to error-only.
const operationNames = process.env.SPECTRA_CONFORMANCE_BREAK_ORDER
  ? // TEMP proof toggle (not set by any committed runner): pure alphabetical —
    // reintroduces the D1 defect so the guard test can be shown to bite.
    Object.keys(spec.operations).sort()
  : orderedOperationNames(spec.operations)

// M3 external-daemon gating (lib/external-mode.ts). Read directly from the
// env var — NOT `endpoint.external` — because `describe`/`it` registration
// below happens SYNCHRONOUSLY at collection time, before `beforeAll` (which
// resolves `endpoint`) has run; the env var is the same condition
// daemon-endpoint.ts's `startConformanceDaemon` itself branches on, so this
// stays in lockstep with what `endpoint.external` will be at runtime.
const isExternalDaemon = Boolean(process.env.SPECTRA_DAEMON_SOCKET)

// Populated by the per-op valid-payload test as it runs: the set of ops that
// produced at least one ok:true (success-shape) response against the fake-
// seeded reference daemon. Consumed by the sessionDestroyerGuard test.
const succeededOps = new Set<string>()

describe('conformance oracle — socket-level contract conformance (all 30 ops)', () => {
  it('the enriched spec covers exactly the 30 documented contract operations', () => {
    expect(operationNames).toHaveLength(30)
  })

  for (const operation of operationNames) {
    describe(`operation: ${operation}`, () => {
      // G1 external gate: the SWIFT G1 milestone daemon implements only the
      // control-plane ops in SWIFT_G1_VERIFIABLE_OPS — everything else is
      // skipped (never false-RED) when talking to an external daemon.
      const skipExternally = isExternalDaemon && !SWIFT_G1_VERIFIABLE_OPS.has(operation)
      const test = skipExternally ? it.skip : it
      const skipSuffix = skipExternally ? ` — SKIPPED: ${externalSkipReason(operation)}` : ''

      test(`valid payloads produce a spec-conformant envelope + result/error shape${skipSuffix}`, async () => {
        const opSpec = spec.operations[operation]
        const payloads = validPayloads(opSpec.params, genCtx)
        expect(payloads.length).toBeGreaterThan(0)

        const failures: string[] = []
        for (const payload of payloads) {
          const params = withSessionOverride(operation, genCtx, payload.params)
          const response = await callOperation({ socketPath: endpoint.socketPath, operation, params })

          const envelopeCheck = apiResponseEnvelopeSchema.safeParse(response.body)
          if (!envelopeCheck.success) {
            failures.push(`[${payload.label}] envelope invalid: ${envelopeCheck.error.message}`)
            continue
          }
          const envelope = envelopeCheck.data

          if (envelope.ok) {
            succeededOps.add(operation)
            const shapeCheck = validateShape(opSpec.result, envelope.result)
            if (!shapeCheck.ok) {
              failures.push(
                `[${payload.label}] result shape mismatch: ${shapeCheck.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
              )
            }
          } else {
            if (!opSpec.errorCodes.includes(envelope.error.code)) {
              failures.push(
                `[${payload.label}] error code "${envelope.error.code}" not in declared errorCodes ${JSON.stringify(opSpec.errorCodes)}`,
              )
            }
          }
        }

        expect(failures, failures.join('\n')).toEqual([])
      }, 30_000)

      test(`malformed (missing-required-field) payloads never escape the declared error taxonomy${skipSuffix}`, async () => {
        const opSpec = spec.operations[operation]
        const payloads = invalidPayloads(opSpec.params, genCtx)
        if (payloads.length === 0) return // op has no required fields to strip

        const failures: string[] = []
        for (const payload of payloads) {
          const params = withSessionOverride(operation, genCtx, payload.params)
          const response = await callOperation({ socketPath: endpoint.socketPath, operation, params })

          const envelopeCheck = apiResponseEnvelopeSchema.safeParse(response.body)
          if (!envelopeCheck.success) {
            failures.push(`[${payload.label}] envelope invalid: ${envelopeCheck.error.message}`)
            continue
          }
          const envelope = envelopeCheck.data
          // The daemon now VALIDATES params server-side at the dispatch boundary
          // (server.ts validateOperationParams, against operationParamSchemas —
          // the same schemas the enriched spec is generated from). A missing
          // required field therefore returns a deterministic `bad_request`
          // (400), not a lucky success or an internal_error catch-all — and it
          // no longer reaches the handler to mutate session state (which is why
          // the malformed-`act` pollution the readonly fixture guards against is
          // now prevented at the source too). The assertion below still only
          // requires the code be WITHIN the declared errorCodes taxonomy
          // (`bad_request` is universal), so it holds regardless; a genuine
          // finding is an envelope that fails schema validation, or an error
          // code outside errorCodes.
          if (!envelope.ok && !opSpec.errorCodes.includes(envelope.error.code)) {
            failures.push(
              `[${payload.label}] error code "${envelope.error.code}" not in declared errorCodes ${JSON.stringify(opSpec.errorCodes)}`,
            )
          }
        }

        expect(failures, failures.join('\n')).toEqual([])
      }, 30_000)
    })
  }

  // ─── D1 GUARD: every succeedable op MUST have exercised its success path ───
  //
  // This is the DURABLE protection against the D1 defect class (a
  // session-destroying op running early and silently reducing downstream ops to
  // error-only, so a broken daemon's success-shape goes untested). It asserts
  // that every one of the 30 ops produced at least one ok:true response during
  // the valid-payload loop above — EXCEPT ops explicitly allowlisted as
  // genuinely-unable-to-succeed under the fakes.
  //
  // The allowlist is EMPIRICALLY EMPTY: with the seeded fixtures (clean macos
  // session for start/stop-recording, seeded recording for getRecording,
  // pristine readonly session for getSession/getRun, staged .cast/.mp4 fixtures
  // for replayTerminal/library) all 30 ops reach a success path. If a future
  // op legitimately cannot succeed under the fakes, add it here WITH a one-line
  // justification — never to paper over a real ordering/fixture regression. If
  // this test goes red, an op that used to succeed now only sees the error path:
  // investigate the ordering/fixtures, do NOT allowlist it away.
  const EXPECTED_ERROR_ONLY_OPS = new Set<string>([])

  it('D1 guard: every succeedable op exercised its success (ok:true) path', () => {
    // In external mode, ops outside SWIFT_G1_VERIFIABLE_OPS were it.skip()-ed
    // above and never ran at all — excluded here so the guard checks only the
    // ops that actually executed, not the ones deliberately gated off.
    const checkedOps = isExternalDaemon
      ? operationNames.filter((op) => SWIFT_G1_VERIFIABLE_OPS.has(op))
      : operationNames
    const regressed = checkedOps.filter(
      (op) => !succeededOps.has(op) && !EXPECTED_ERROR_ONLY_OPS.has(op),
    )
    expect(
      regressed,
      `these ops only ever produced error responses (success-shape UNTESTED — likely a ` +
        `session-ordering/fixture regression, the D1 defect class): ${regressed.join(', ')}`,
    ).toEqual([])

    // Also guard the allowlist itself against rot: an allowlisted op that has
    // started succeeding should be removed from the allowlist so its success
    // path stays gated.
    const staleAllowlist = [...EXPECTED_ERROR_ONLY_OPS].filter((op) => succeededOps.has(op))
    expect(
      staleAllowlist,
      `these ops are allowlisted as error-only but DID succeed — remove them from ` +
        `EXPECTED_ERROR_ONLY_OPS so their success path stays gated: ${staleAllowlist.join(', ')}`,
    ).toEqual([])
  })
})
