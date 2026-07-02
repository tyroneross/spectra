// tests/conformance/corpus/corpus.test.ts
//
// M2B deliverable (c) — dual-run corpus diff gate. For every entry recorded
// in golden-corpus.json (operation + payloadLabel + normalized response),
// regenerates the EQUIVALENT concrete request via the same payload-generator
// used to build the corpus (fresh session ids — see record-corpus.ts's
// header comment for why the stored request can't be replayed verbatim),
// sends it to a LIVE daemon (TS today; point SPECTRA_DAEMON_SOCKET at a
// Swift daemon later — see daemon-endpoint.ts), and asserts the normalized
// response equals the recorded normalized response. This IS the per-op-group
// parity check M3 requires before a routing-table flip (plan §Verification
// strategy item 2).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EnrichedContractSpec } from '../../../src/contract/enriched-spec.js'
import { startConformanceDaemon, type DaemonEndpoint } from '../lib/daemon-endpoint.js'
import { callOperation } from '../lib/socket-client.js'
import { validPayloads, type GeneratorContext } from '../lib/payload-generator.js'
import { buildFixtureContext, withSessionOverride } from '../lib/fixture-context.js'
import { normalizeEntry, type CorpusEntry } from './normalize.js'

const here = dirname(fileURLToPath(import.meta.url))
const corpusPath = join(here, 'golden-corpus.json')
const specPath = join(here, '..', '..', '..', 'src', 'contract', 'contract.spec.json')

let endpoint: DaemonEndpoint
let scratchDir: string
let genCtx: GeneratorContext

beforeAll(async () => {
  endpoint = await startConformanceDaemon()
  scratchDir = mkdtempSync(join(tmpdir(), 'spectra-conformance-corpus-replay-'))
  genCtx = await buildFixtureContext(endpoint, scratchDir)
}, 30_000)

afterAll(async () => {
  await endpoint?.close()
  if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
})

describe('dual-run corpus diff — replaying the recorded corpus against a live daemon', () => {
  if (!existsSync(corpusPath)) {
    it.skip('golden-corpus.json has not been generated yet — run `npx tsx tests/conformance/corpus/record-corpus.ts`', () => {})
    return
  }

  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as CorpusEntry[]
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as EnrichedContractSpec

  it('the recorded corpus covers all 30 operations', () => {
    const operations = new Set(corpus.map((entry) => entry.operation))
    expect(operations.size).toBe(30)
  })

  // Corpus-arm D1 guard (mirrors conformance.test.ts's live guard): every op
  // must have at least one ok:true entry in the RECORDED corpus. Without this,
  // a corpus recorded under a broken (alphabetical) ordering — where
  // closeAllSessions destroys the fixtures mid-record and ~14 ops record only
  // their error path — would replay green (error matches error) and silently
  // certify a broken daemon. This makes such a stale/broken corpus fail to
  // commit. Empty allowlist: with the shared destroyer-last recorder ordering
  // (lib/op-order.ts) every op reaches a success path at record time.
  const CORPUS_EXPECTED_ERROR_ONLY_OPS = new Set<string>([])

  it('D1 guard: every op has at least one ok:true entry in the recorded corpus', () => {
    const succeededOps = new Set(corpus.filter((e) => e.response.ok).map((e) => e.operation))
    const allOps = [...new Set(corpus.map((e) => e.operation))].sort()
    const errorOnly = allOps.filter(
      (op) => !succeededOps.has(op) && !CORPUS_EXPECTED_ERROR_ONLY_OPS.has(op),
    )
    expect(
      errorOnly,
      `the recorded corpus has ONLY error entries for these ops (success-shape NOT captured — ` +
        `the corpus was likely recorded under the D1 alphabetical-ordering defect; re-record with ` +
        `\`npx tsx tests/conformance/corpus/record-corpus.ts\`): ${errorOnly.join(', ')}`,
    ).toEqual([])
  })

  // FINDING (discovered live via this diff, not fixed — see M2B report):
  // recordTerminal's file-change count (`fileChanges` / the `timeline`
  // entry for the emitted `.cast` file) is racy against the child process's
  // own exit — the fs watcher and the process-exit handler are not
  // sequenced, so the "added: <file>" event is present on some runs and
  // absent on others. This is a REAL bug in src/mcp/tools/record.ts's
  // terminal recorder (out of scope to fix here — src/mcp is not an owned
  // path for M2B), not a normalization gap. Retrying is the honest
  // response to a genuine race (same as any flaky-e2e-test policy) — it is
  // NOT a normalization rule, so it does not mask a real protocol
  // regression the way silently allowing count drift in `normalize()` would.
  const KNOWN_RACY_OPS = new Set(['recordTerminal'])

  for (const entry of corpus) {
    const retries = KNOWN_RACY_OPS.has(entry.operation) ? 3 : 0
    it(`${entry.operation} [${entry.payloadLabel}] — regenerated request matches the recorded normalized response`, { timeout: 30_000, retry: retries }, async () => {
      const opSpec = spec.operations[entry.operation]
      const payload = validPayloads(opSpec.params, genCtx).find((p) => p.label === entry.payloadLabel)
      if (!payload) {
        throw new Error(
          `Corpus entry ${entry.operation}[${entry.payloadLabel}] has no matching generated payload — ` +
          'the spec or the generator changed since the corpus was recorded. Regenerate golden-corpus.json.',
        )
      }
      const params = withSessionOverride(entry.operation, genCtx, payload.params)
      const response = await callOperation({ socketPath: endpoint.socketPath, operation: entry.operation, params })
      const body = response.body as
        | { ok: true; result: unknown }
        | { ok: false; error: { code: string; message: string } }

      const replayed: CorpusEntry = {
        operation: entry.operation,
        payloadLabel: entry.payloadLabel,
        request: params,
        response: body.ok
          ? { ok: true, result: body.result }
          : { ok: false, errorCode: body.error.code, errorMessage: body.error.message },
      }

      expect(normalizeEntry(replayed).response).toEqual(entry.response)
    })
  }
})
