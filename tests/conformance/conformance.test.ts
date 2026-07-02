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
      it('valid payloads produce a spec-conformant envelope + result/error shape', async () => {
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

      it('malformed (missing-required-field) payloads never escape the declared error taxonomy', async () => {
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
          // NOTE (finding, see tests/conformance/README.md): the real daemon
          // does NOT schema-validate params server-side today — validation
          // lives client-side in src/client/daemon-client.ts. So a missing
          // required field does not reliably produce `bad_request`; it may
          // succeed (if the handler tolerates `undefined`) or surface as
          // `internal_error` via the server.ts catch-all. Either is
          // contract-conformant (internal_error is universal); the ONLY
          // thing that would be a genuine finding is an envelope that fails
          // schema validation, or (for an error) a code outside errorCodes.
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
    const regressed = operationNames.filter(
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
