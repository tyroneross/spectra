// tests/conformance/capability-gate.test.ts
//
// M2B D4 — capability-gate conformance probe. The enriched spec carries an
// op→capability map (H2, sourced from wire.ts operationCapabilities), but until
// now NO conformance code exercised it: the harness daemon grants the unix
// caller ALL capabilities, so the default-deny gate (src/daemon/security.ts
// assertOperationAllowed) was never observed denying anything over the wire.
//
// This probe starts a daemon that grants the caller ONLY `daemon:read`, then —
// driven directly by the frozen spec's `capabilities` array for every one of
// the 30 ops — asserts the wire contract: an op whose required capabilities are
// NOT all granted returns `ok:false` with `error.code === 'capability_denied'`;
// an op whose capabilities ARE all granted (only `health`, under this grant) is
// NOT capability-denied. A future Swift daemon must replicate this exact
// default-deny behavior to pass — that's the parity guarantee H2 exists for.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EnrichedContractSpec } from '../../src/contract/enriched-spec.js'
import type { Capability } from '../../src/contract/wire.js'
import { apiResponseEnvelopeSchema } from '../../src/contract/schemas.js'
import { startConformanceDaemon, type DaemonEndpoint } from './lib/daemon-endpoint.js'
import { callOperation } from './lib/socket-client.js'
import { validPayloads, type GeneratorContext } from './lib/payload-generator.js'
import { buildFixtureContext, withSessionOverride } from './lib/fixture-context.js'

const here = dirname(fileURLToPath(import.meta.url))
const specPath = join(here, '..', '..', 'src', 'contract', 'contract.spec.json')
const spec = JSON.parse(readFileSync(specPath, 'utf8')) as EnrichedContractSpec

// Grant a single, minimal capability so exactly one op (`health`) is fully
// covered and every other op is missing at least one required capability.
const GRANTED: Capability[] = ['daemon:read']

let endpoint: DaemonEndpoint
let scratchDir: string
let genCtx: GeneratorContext

beforeAll(async () => {
  endpoint = await startConformanceDaemon({ capabilities: GRANTED })
  scratchDir = mkdtempSync(join(tmpdir(), 'spectra-conformance-capgate-'))
  genCtx = await buildFixtureContext(endpoint, scratchDir)
}, 30_000)

afterAll(async () => {
  await endpoint?.close()
  if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
})

const operationNames = Object.keys(spec.operations).sort()

describe('capability gate (H2) — default-deny is enforced per the op→capability map', () => {
  it('the grant leaves exactly one op fully covered (health) — the rest must be denied', () => {
    const covered = operationNames.filter((op) =>
      spec.operations[op].capabilities.every((c) => GRANTED.includes(c)),
    )
    expect(covered).toEqual(['health'])
  })

  for (const operation of operationNames) {
    const required = spec.operations[operation].capabilities
    const fullyGranted = required.every((c) => GRANTED.includes(c))

    it(`${operation} (needs ${required.join(', ')}) is ${fullyGranted ? 'ALLOWED' : 'capability_denied'}`, async () => {
      const payload = validPayloads(spec.operations[operation].params, genCtx)[0]
      const params = withSessionOverride(operation, genCtx, payload.params)
      const response = await callOperation({ socketPath: endpoint.socketPath, operation, params })

      const envelope = apiResponseEnvelopeSchema.parse(response.body)

      if (fullyGranted) {
        // Must NOT be denied on capability grounds (it may still be ok:true, or
        // fail for an unrelated reason — but never capability_denied).
        if (!envelope.ok) {
          expect(envelope.error.code).not.toBe('capability_denied')
        }
      } else {
        expect(envelope.ok, `${operation} should be denied but returned ok:true`).toBe(false)
        if (!envelope.ok) {
          expect(envelope.error.code).toBe('capability_denied')
        }
      }
    }, 30_000)
  }
})
