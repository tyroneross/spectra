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
import { SWIFT_G1_VERIFIABLE_OPS } from './lib/external-mode.js'

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

// The capability gate spins up a RESTRICTED-capability daemon
// (startConformanceDaemon({capabilities})) — a control the harness only has over
// a daemon it spawns. Against an EXTERNAL daemon (SPECTRA_DAEMON_SOCKET), the
// capability restriction is ignored (daemon-endpoint.ts) and the daemon grants
// all caps by default, so these assertions can't hold — UNLESS the external
// daemon was booted OUTSIDE this harness with its own restriction already
// applied (the Swift daemon-core now has a capability-restriction hook,
// `SPECTRA_CONFORMANCE_UNIX_CAPS`, set directly on ITS process by the caller
// that spawned it — see macos/Spectra/DaemonCore/verify-flip-suite.ts's Gate
// C). `SPECTRA_CONFORMANCE_EXTERNAL_CAPS_HONORED=1` [env contract,
// docs/plans/m3-g1-flip-plan.md] is the caller's attestation that the external
// daemon it pointed `SPECTRA_DAEMON_SOCKET` at was booted that way — an
// explicit, named opt-in rather than an implicit assumption, so a plain
// external run (no attestation) still skips exactly as before (byte-identical
// default behavior; this is additive, never a narrowing of the prior skip).
const externalCapsHonored = process.env.SPECTRA_CONFORMANCE_EXTERNAL_CAPS_HONORED === '1'
const isExternalDaemon = Boolean(process.env.SPECTRA_DAEMON_SOCKET)
const describeGate = isExternalDaemon && !externalCapsHonored ? describe.skip : describe

// M3.G1 flip (rev 3, Ruling 3 — the Gate C fix): against an external daemon
// whose capability restriction is attested (SPECTRA_CONFORMANCE_EXTERNAL_
// CAPS_HONORED=1), the milestone Swift daemon-core registers ONLY the
// extended G1 control-plane surface (SWIFT_G1_VERIFIABLE_OPS — derived, never
// hand-maintained here, see lib/external-mode.ts). The other 19 ops are
// UNREGISTERED at this milestone: the correct-and-safe wire response for an
// unregistered op is `not_found` (proves the op is unreachable at all —
// strictly stronger than a denial), never `capability_denied` (which would
// imply the daemon looked the op up, found it, and only THEN said no) and
// certainly never a served result. Asserting `capability_denied` for those 19
// ops was Gate C's real failure mode (real run: 19 FAILED — see the plan's
// "Gate redesign rev 3" trigger evidence). In-process (TS) mode is unchanged:
// every op is registered there, so the ORIGINAL strict pattern applies to all
// 30 (registeredOps below is the full 30-op set whenever isExternalDaemon is
// false).
const registeredOps: ReadonlySet<string> = isExternalDaemon
  ? new Set(operationNames.filter((op) => SWIFT_G1_VERIFIABLE_OPS.has(op)))
  : new Set(operationNames)

describeGate('capability gate (H2) — default-deny is enforced per the op→capability map', () => {
  it('the grant leaves exactly one op fully covered (health) — the rest must be denied', () => {
    const covered = operationNames.filter((op) =>
      spec.operations[op].capabilities.every((c) => GRANTED.includes(c)),
    )
    expect(covered).toEqual(['health'])
  })

  for (const operation of operationNames) {
    const required = spec.operations[operation].capabilities
    const fullyGranted = required.every((c) => GRANTED.includes(c))

    if (isExternalDaemon && !registeredOps.has(operation)) {
      it(`${operation} — unregistered externally (outside SWIFT_G1_VERIFIABLE_OPS): must be exactly not_found`, async () => {
        const payload = validPayloads(spec.operations[operation].params, genCtx)[0]
        const params = withSessionOverride(operation, genCtx, payload.params)
        const response = await callOperation({ socketPath: endpoint.socketPath, operation, params })

        const envelope = apiResponseEnvelopeSchema.parse(response.body)

        expect(envelope.ok, `${operation} is unregistered externally — must never succeed`).toBe(false)
        if (!envelope.ok) {
          expect(
            envelope.error.code,
            `${operation} is unregistered externally — must be EXACTLY not_found (never capability_denied ` +
              'or any other code), proving the op is unreachable rather than reachable-but-denied',
          ).toBe('not_found')
        }
      }, 30_000)
      continue
    }

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
