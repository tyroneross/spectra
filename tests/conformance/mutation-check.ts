// tests/conformance/mutation-check.ts
//
// M2B acceptance requirement — prove the oracle bites. Runs the conformance
// checks TWICE against the REAL TS daemon:
//   1. Clean run (SPECTRA_CONFORMANCE_MUTATE unset) — expected GREEN.
//   2. Mutated run (daemon-runner.ts's opt-in mutateOp hook enabled via env
//      vars SPECTRA_CONFORMANCE_MUTATE_OP/_KIND — see lib/daemon-endpoint.ts's
//      `mutate` option) — a response-shape drift (dropped or renamed result
//      field) is introduced INSIDE the harness-owned ConformanceCoreApi
//      wrapper (tests/conformance/lib/fakes.ts), never inside src/daemon/
//      core-impl.ts (read-only per the M2B ownership boundary) — expected RED.
//
// This does not touch daemon SOURCE at all; it wraps the REAL response the
// real daemon produces and mutates it one layer up, at the wire boundary —
// which is exactly what the conformance suite's envelope/result validators
// observe, so it is an equally valid proof that the SHAPE VALIDATOR (not the
// daemon) actually rejects drift. A parallel M3 exercise (seeding a mutation
// inside a ported Swift op-group's own source) is the same proof one layer
// deeper once Swift code exists to mutate.
//
// Run: npx tsx tests/conformance/mutation-check.ts
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EnrichedContractSpec } from '../../src/contract/enriched-spec.js'
import { apiResponseEnvelopeSchema } from '../../src/contract/schemas.js'
import { startConformanceDaemon } from './lib/daemon-endpoint.js'
import { callOperation } from './lib/socket-client.js'
import { validPayloads } from './lib/payload-generator.js'
import { buildFixtureContext, withSessionOverride } from './lib/fixture-context.js'
import { validateShape } from './lib/result-validator.js'

const here = dirname(fileURLToPath(import.meta.url))
const specPath = join(here, '..', '..', 'src', 'contract', 'contract.spec.json')
const spec = JSON.parse(readFileSync(specPath, 'utf8')) as EnrichedContractSpec

interface CheckOutcome {
  pass: boolean
  detail: string
}

/** Run one operation against a freshly-spawned daemon (optionally with the
 * result-mutation hook enabled) and report whether its SUCCESS shape validated.
 * Generalized from health-only so the oracle can be proven to bite on a CORE
 * session-dependent op (snapshot/startRecording), not just a void-param one. */
async function runOpCheck(
  operation: string,
  mutate?: { operation: string; kind: 'drop-field' | 'rename-field' },
): Promise<CheckOutcome> {
  const endpoint = await startConformanceDaemon({ mutate })
  const scratchDir = mkdtempSync(join(tmpdir(), 'spectra-conformance-mutation-check-'))
  try {
    const genCtx = await buildFixtureContext(endpoint, scratchDir)

    // stopRecording only reaches its COMPLETED union branch (the one with
    // required fields) when the target session has an ACTIVE recording. The
    // fresh daemon seeds its recording on a dedicated session and leaves the
    // macos fixture (where stopRecording is routed) clean — which would hit the
    // minimal `alreadyStopped` branch whose first key is the optional `preset`,
    // so the generic drop-first-key mutation wouldn't violate anything. Start a
    // recording on macos first so the mutation lands on the completed branch's
    // required `recordingId` and is caught. (Not mutated — the mutate hook is
    // scoped to `operation`, i.e. stopRecording, not this setup call.)
    if (operation === 'stopRecording') {
      await callOperation({
        socketPath: endpoint.socketPath,
        operation: 'startRecording',
        params: { sessionId: genCtx.macosSessionId },
      })
    }

    const opSpec = spec.operations[operation]
    const payload = validPayloads(opSpec.params, genCtx)[0]
    const params = withSessionOverride(operation, genCtx, payload.params)
    const response = await callOperation({ socketPath: endpoint.socketPath, operation, params })

    const envelopeCheck = apiResponseEnvelopeSchema.safeParse(response.body)
    if (!envelopeCheck.success) {
      return { pass: false, detail: `envelope invalid: ${envelopeCheck.error.message}` }
    }
    const envelope = envelopeCheck.data
    if (!envelope.ok) {
      return { pass: false, detail: `expected ok:true, got error ${envelope.error.code}` }
    }
    const shapeCheck = validateShape(opSpec.result, envelope.result)
    if (!shapeCheck.ok) {
      return { pass: false, detail: `result shape mismatch: ${shapeCheck.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}` }
    }
    return { pass: true, detail: `${operation} result matched its declared shape` }
  } finally {
    await endpoint.close()
    rmSync(scratchDir, { recursive: true, force: true })
  }
}

// The ops proven to bite: `health` (void-param baseline) + CORE session-
// dependent ops whose result shape a drop-first-key mutation violates:
// snapshot (required `snapshot`), getSession (required `session`), startRecording
// (required recordingId/startedAt/fps/codec/bitrate; single success path), and —
// now that their results are DISCRIMINATED UNIONS (Completed|AlreadyStopped;
// Image|SoftError) — stopRecording and screenshot (a mutated completed/image
// result matches neither union member → caught). All 6 red-before/green-after.
const PROOF_OPS = ['health', 'snapshot', 'getSession', 'startRecording', 'stopRecording', 'screenshot'] as const

async function main(): Promise<void> {
  console.log('=== M2B mutation check: does the conformance oracle actually bite? ===\n')

  let allProved = true
  for (const operation of PROOF_OPS) {
    console.log(`--- operation: ${operation} ---`)

    const baseline = await runOpCheck(operation)
    console.log(`  [baseline, expect PASS]  -> ${baseline.pass ? 'PASS' : 'FAIL'}: ${baseline.detail}`)

    const dropped = await runOpCheck(operation, { operation, kind: 'drop-field' })
    console.log(`  [drop-field, expect FAIL] -> ${dropped.pass ? 'PASS' : 'FAIL'}: ${dropped.detail}`)

    const renamed = await runOpCheck(operation, { operation, kind: 'rename-field' })
    console.log(`  [rename-field, expect FAIL] -> ${renamed.pass ? 'PASS' : 'FAIL'}: ${renamed.detail}`)

    const reverted = await runOpCheck(operation)
    console.log(`  [reverted, expect PASS]  -> ${reverted.pass ? 'PASS' : 'FAIL'}: ${reverted.detail}`)

    const proved = baseline.pass && !dropped.pass && !renamed.pass && reverted.pass
    console.log(`  => ${operation} bites: ${proved ? 'YES (red-before/green-after)' : 'NO'}\n`)
    allProved = allProved && proved
  }

  console.log(
    `=== Oracle bites on all proof ops (${PROOF_OPS.join(', ')}): ${allProved ? 'YES — red-before/green-after confirmed' : 'NO — see detail above'} ===`,
  )
  process.exit(allProved ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
