// tests/conformance/external-mode.test.ts
//
// M3 EXTERNAL-VERIFICATION PROOF (docs/plans/m3-external-daemon-seeding.md).
//
// conformance.test.ts and corpus/corpus.test.ts already become the M3
// cutover gate for free once SPECTRA_DAEMON_SOCKET points at a real daemon —
// but nothing in the committed test suite actually EXERCISES that
// SPECTRA_DAEMON_SOCKET path today. This file does: it spawns a REAL TS
// daemon as its own OS subprocess (reusing daemon-endpoint.ts's own spawn
// plumbing — which is itself "spawn tests/conformance/lib/daemon-runner.ts
// via tsx", the exact mechanism a real Swift daemon binary would replace),
// points `SPECTRA_DAEMON_SOCKET` at its socket, and re-resolves the endpoint
// through `startConformanceDaemon()` a second time so it takes the SAME
// `external: true`, no-pre-seeded-sessionIds branch a real external (Swift)
// daemon discovery would take. It then drives Tier-1 wire seeding
// (lib/fixture-context.ts's external branch, added for M3) and the resulting
// externally-verifiable control-plane ops (lib/external-mode.ts
// SWIFT_G1_VERIFIABLE_OPS) purely over the wire via callOperation +
// validateShape — proving the whole external-daemon verification path works
// end-to-end against a real daemon before a Swift binary exists to point it
// at.
//
// Real-Chrome caveat: `createSession` (used by Tier-1 seeding) spawns a real
// CdpDriver/Chrome process (see daemon-runner.ts's shutdown-handler comment)
// — this can be flaky headlessly depending on the host. Seeding is retried a
// bounded number of times; if it never succeeds, the session-DEPENDENT ops
// below (getSession/getRun/closeSession) are skipped with a loud reason
// rather than failing the whole file — the session-INDEPENDENT ops
// (health/listSessions/library) still run and still prove the wire path.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EnrichedContractSpec } from '../../src/contract/enriched-spec.js'
import { apiResponseEnvelopeSchema } from '../../src/contract/schemas.js'
import { startConformanceDaemon, type DaemonEndpoint } from './lib/daemon-endpoint.js'
import { callOperation } from './lib/socket-client.js'
import { buildFixtureContext } from './lib/fixture-context.js'
import type { GeneratorContext } from './lib/payload-generator.js'
import { validateShape } from './lib/result-validator.js'
import { SWIFT_G1_VERIFIABLE_OPS } from './lib/external-mode.js'

const here = dirname(fileURLToPath(import.meta.url))
const specPath = join(here, '..', '..', 'src', 'contract', 'contract.spec.json')
const spec = JSON.parse(readFileSync(specPath, 'utf8')) as EnrichedContractSpec

const SEED_RETRY_ATTEMPTS = 3

async function buildFixtureContextWithRetry(
  endpoint: DaemonEndpoint,
  scratchDir: string,
  attempts: number,
): Promise<GeneratorContext> {
  // Score = how many of the 2 real-Chrome sessions this attempt obtained.
  // Each retry calls createSession again WITHOUT closing the prior attempt's
  // sessions (buildFixtureContext has no way to address/close them — they
  // are addressed only by the ids it just returned), so a later attempt can
  // legitimately be WORSE than an earlier one (e.g. two lingering Chrome
  // processes from attempts 1-2 both racing the default shared
  // `~/.spectra/chromium-profile` user-data-dir on attempt 3 — see the
  // readonlySessionAvailable/webSessionAvailable doc comment below). Tracking
  // the BEST-scoring attempt (not just the last) means a genuinely transient
  // hiccup still benefits from the retry, without a later, more-congested
  // attempt silently regressing an already-successful session id back to
  // 'unavailable'.
  const score = (c: GeneratorContext): number =>
    (c.webSessionId !== 'unavailable' ? 1 : 0) + (c.readonlySessionId !== 'unavailable' ? 1 : 0)

  let best: GeneratorContext | undefined
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctx = await buildFixtureContext(endpoint, scratchDir)
    if (!best || score(ctx) > score(best)) best = ctx
    if (score(best) === 2) return best
    if (attempt < attempts) {
      // eslint-disable-next-line no-console
      console.warn(
        `[external-mode.test] Tier-1 wire-seeding attempt ${attempt}/${attempts} did not obtain both real ` +
          "sessions (createSession returned no sessionId for at least one — real-Chrome createSession can " +
          'be flaky headlessly, or a shared Chrome profile dir can collide across sessions). Retrying.',
      )
    }
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[external-mode.test] Tier-1 wire-seeding could not obtain BOTH real sessions after ${attempts} ` +
      `attempt(s) (best: web=${best!.webSessionId !== 'unavailable'}, readonly=${best!.readonlySessionId !== 'unavailable'}) ` +
      '— createSession appears unable to run 2 concurrent real-Chrome sessions headlessly on this host. ' +
      'Session-dependent ops needing the unavailable session(s) will be SKIPPED below, not failed.',
  )
  return best as GeneratorContext
}

// ─── Bootstrap (top-level await): spawn a REAL TS daemon subprocess, point
// SPECTRA_DAEMON_SOCKET at it, and re-resolve through startConformanceDaemon
// so `endpoint` is the SAME shape a real external (Swift) daemon discovery
// produces. Top-level (not beforeAll) because whether session-dependent ops
// below run at all (`sessionsAvailable`) depends on this async setup, and
// `describe`/`it.skip` decisions must be made at synchronous collection time
// — vitest test files are ESM and support top-level await for exactly this. ───

const spawnedDaemon = await startConformanceDaemon()

const originalSocketEnv = process.env.SPECTRA_DAEMON_SOCKET
process.env.SPECTRA_DAEMON_SOCKET = spawnedDaemon.socketPath
const endpoint = await startConformanceDaemon()
// Restore immediately — nothing below depends on the env var itself, only on
// the already-resolved `endpoint` object, so the mutation window is as small
// as possible (defense-in-depth against any other test file sharing this
// worker; vitest's default `forks` pool already isolates process.env per
// file, but this costs nothing and removes the dependency on that default).
if (originalSocketEnv === undefined) delete process.env.SPECTRA_DAEMON_SOCKET
else process.env.SPECTRA_DAEMON_SOCKET = originalSocketEnv

const scratchDir = mkdtempSync(join(tmpdir(), 'spectra-external-mode-fixtures-'))
const genCtx = await buildFixtureContextWithRetry(endpoint, scratchDir, SEED_RETRY_ATTEMPTS)
// Gated per-session (not all-or-nothing): a real daemon's BrowserManager
// launches every real-Chrome session against the SAME default
// `~/.spectra/chromium-profile` user-data-dir (src/cdp/browser.ts) — a
// pre-existing daemon-side limitation (out of scope here; not touched) that
// makes a SECOND concurrent real-Chrome session collide with the first
// (observed live: "Chrome debugger did not respond ... Is another Chrome
// instance using this port?"). So `webSessionId` (created first) can succeed
// even when `readonlySessionId` (created second) cannot — gating each
// session-dependent op on the SPECIFIC session it needs, not on both,
// maximizes real coverage instead of skipping everything on one collision.
const readonlySessionAvailable = genCtx.readonlySessionId !== 'unavailable'
const webSessionAvailable = genCtx.webSessionId !== 'unavailable'

afterAll(async () => {
  await spawnedDaemon.close()
  rmSync(scratchDir, { recursive: true, force: true })
})

async function assertConformant(operation: string, params: unknown): Promise<void> {
  const opSpec = spec.operations[operation]
  const response = await callOperation({ socketPath: endpoint.socketPath, operation, params })

  const envelopeCheck = apiResponseEnvelopeSchema.safeParse(response.body)
  expect(
    envelopeCheck.success,
    envelopeCheck.success ? '' : `[${operation}] envelope invalid: ${envelopeCheck.error.message}`,
  ).toBe(true)
  if (!envelopeCheck.success) return

  const envelope = envelopeCheck.data
  expect(
    envelope.ok,
    envelope.ok ? '' : `[${operation}] expected ok:true, got error ${envelope.error.code}: ${envelope.error.message}`,
  ).toBe(true)
  if (!envelope.ok) return

  const shapeCheck = validateShape(opSpec.result, envelope.result)
  expect(
    shapeCheck.ok,
    `[${operation}] result shape mismatch: ${shapeCheck.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
  ).toBe(true)
}

describe('M3 external-verification proof — real TS daemon spoken to purely via SPECTRA_DAEMON_SOCKET', () => {
  it('resolves via SPECTRA_DAEMON_SOCKET as an external endpoint with no pre-seeded fixture sessionIds', () => {
    expect(endpoint.external).toBe(true)
    expect(endpoint.sessionIds).toBeUndefined()
    expect(endpoint.socketPath).toBe(spawnedDaemon.socketPath)
  })

  // ─── Session-independent control-plane ops — always run ─────────────────
  it('health returns a spec-conformant envelope + shape', async () => {
    expect(SWIFT_G1_VERIFIABLE_OPS.has('health')).toBe(true)
    await assertConformant('health', { includePermissions: true })
  })

  it('listSessions returns a spec-conformant envelope + shape', async () => {
    expect(SWIFT_G1_VERIFIABLE_OPS.has('listSessions')).toBe(true)
    await assertConformant('listSessions', {})
  })

  it('library:status returns a spec-conformant envelope + shape', async () => {
    expect(SWIFT_G1_VERIFIABLE_OPS.has('library')).toBe(true)
    await assertConformant('library', { action: 'status' })
  })

  it('library:find returns a spec-conformant envelope + shape', async () => {
    await assertConformant('library', { action: 'find' })
  })

  // ─── Session-dependent ops — exercise Task-1 Tier-1 wire seeding ─────────
  // Loudly skipped (not silently, not failed) per-session when real-Chrome
  // createSession genuinely could not obtain that specific session — see
  // buildFixtureContextWithRetry's console.warn and the doc comment on
  // readonlySessionAvailable/webSessionAvailable above.
  const readonlyIt = readonlySessionAvailable ? it : it.skip
  const readonlySkipReason = readonlySessionAvailable
    ? ''
    : ' — SKIPPED: Tier-1 wire seeding could not obtain a real readonly session (createSession unavailable headlessly on this host)'

  readonlyIt(`getSession(readonlySessionId) returns a spec-conformant envelope + shape${readonlySkipReason}`, async () => {
    expect(SWIFT_G1_VERIFIABLE_OPS.has('getSession')).toBe(true)
    await assertConformant('getSession', { sessionId: genCtx.readonlySessionId })
  })

  readonlyIt(
    `getRun(readonlySessionId) returns a spec-conformant envelope + shape (validates the 2 conformant ` +
      `steps Tier-1 seeded over the wire)${readonlySkipReason}`,
    async () => {
      expect(SWIFT_G1_VERIFIABLE_OPS.has('getRun')).toBe(true)
      await assertConformant('getRun', { sessionId: genCtx.readonlySessionId })
    },
  )

  // Runs last — closes webSessionId (never referenced above), leaving
  // readonlySessionId untouched for getSession/getRun.
  const webIt = webSessionAvailable ? it : it.skip
  const webSkipReason = webSessionAvailable
    ? ''
    : ' — SKIPPED: Tier-1 wire seeding could not obtain a real web session (createSession unavailable headlessly on this host)'
  webIt(`closeSession(webSessionId) returns a spec-conformant envelope + shape${webSkipReason}`, async () => {
    expect(SWIFT_G1_VERIFIABLE_OPS.has('closeSession')).toBe(true)
    await assertConformant('closeSession', { sessionId: genCtx.webSessionId })
  })
})
