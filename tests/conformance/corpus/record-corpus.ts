// tests/conformance/corpus/record-corpus.ts
//
// M2B deliverable (c) — dual-run corpus recorder. Runs the SAME payload
// generator the conformance suite uses against a live daemon, captures every
// (request → normalized response) pair, and writes them to
// golden-corpus.json. This corpus + tests/conformance/conformance.test.ts are
// what M3 diffs the Swift daemon against per op-group (plan §Verification
// strategy item 2).
//
// IMPORTANT (why the stored `request` is NORMALIZED, not literal): sessionId/
// recordingId are fresh per daemon instance (a new fixture session is seeded
// on every spawn), so a literal request captured against THIS run's daemon
// can never be replayed verbatim against a later run's (or a Swift daemon's)
// fresh instance. The corpus therefore stores the request in NORMALIZED form
// (sessionId → "<ID>", etc.) as the audit/regression record, while the
// replay side (corpus.test.ts) regenerates an equivalent CONCRETE request via
// the same payload-generator + a fresh fixture context, matched by
// (operation, payloadLabel), and diffs the normalized RESPONSE only. This is
// the standard shape of a dual-run corpus for a stateful, session-based
// protocol — see tests/conformance/corpus/corpus.test.ts.
//
// Run: npx tsx tests/conformance/corpus/record-corpus.ts
// (regenerates golden-corpus.json from whichever daemon SPECTRA_DAEMON_SOCKET
// points at, or the harness-spawned TS reference daemon by default.)
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EnrichedContractSpec } from '../../../src/contract/enriched-spec.js'
import { startConformanceDaemon } from '../lib/daemon-endpoint.js'
import { callOperation } from '../lib/socket-client.js'
import { validPayloads } from '../lib/payload-generator.js'
import { buildFixtureContext, withSessionOverride } from '../lib/fixture-context.js'
import { orderedOperationNames } from '../lib/op-order.js'
import { normalizeEntry, type CorpusEntry } from './normalize.js'

const here = dirname(fileURLToPath(import.meta.url))
const specPath = join(here, '..', '..', '..', 'src', 'contract', 'contract.spec.json')
const corpusPath = join(here, 'golden-corpus.json')

export async function recordCorpus(): Promise<CorpusEntry[]> {
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as EnrichedContractSpec
  const endpoint = await startConformanceDaemon()
  const scratchDir = mkdtempSync(join(tmpdir(), 'spectra-conformance-corpus-'))

  try {
    const genCtx = await buildFixtureContext(endpoint, scratchDir)

    const entries: CorpusEntry[] = []
    // D1 fix (corpus arm): iterate in the SHARED destroyer-last order — NOT
    // pure `.sort()`. The recorder previously iterated alphabetically, so
    // closeAllSessions ran early and destroyed the fixtures mid-record, baking
    // the D1 error-only responses into golden-corpus.json (the corpus asserted
    // the very defect the oracle exists to catch, and replay matched it error-
    // for-error). Sharing lib/op-order.ts with conformance.test.ts keeps the
    // live suite and the recorded corpus on identical ordering.
    for (const operation of orderedOperationNames(spec.operations)) {
      const opSpec = spec.operations[operation]
      const payloads = validPayloads(opSpec.params, genCtx)
      for (const payload of payloads) {
        const params = withSessionOverride(operation, genCtx, payload.params)
        const response = await callOperation({ socketPath: endpoint.socketPath, operation, params })
        const body = response.body as
          | { ok: true; result: unknown }
          | { ok: false; error: { code: string; message: string } }

        const entry: CorpusEntry = {
          operation,
          payloadLabel: payload.label,
          request: params,
          response: body.ok
            ? { ok: true, result: body.result }
            : { ok: false, errorCode: body.error.code, errorMessage: body.error.message },
        }
        entries.push(normalizeEntry(entry))
      }
    }
    return entries
  } finally {
    await endpoint.close()
    rmSync(scratchDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const entries = await recordCorpus()
  writeFileSync(corpusPath, `${JSON.stringify(entries, null, 2)}\n`)
  console.log(`Wrote ${corpusPath} — ${entries.length} normalized (request → response) pairs across 30 operations.`)
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  return fileURLToPath(import.meta.url) === entry || import.meta.url === `file://${entry}`
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exit(1)
  })
}
