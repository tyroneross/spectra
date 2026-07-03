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
// C8 (Fable M3.G1 follow-on) — Swift-native corpus recording mode. The corpus
// above (golden-corpus.json) is recorded from the TS reference daemon and
// guards the TS backend ONLY: a from-scratch Swift reimplementation
// legitimately diverges from it on non-contract cosmetics (daemonVersion
// "0.3.2" vs "0.3.2-swift-g1", TS-only envelope metadata, optional fields the
// Swift daemon omits), so replaying golden-corpus.json against Swift byte-for-
// byte is not a valid regression (this is exactly the defect the
// oracle-baseline-encodes-the-defect rule warns about — see the Fable M3.G1
// flip-gate reconciliation note in verify-flip-suite.ts's gateA()). To restore
// a byte-level Swift regression WITHOUT touching golden-corpus.json, this file
// gained a second, separate recording path: set SPECTRA_CORPUS_TARGET=swift-
// native (and point SPECTRA_DAEMON_SOCKET at a live, SEEDED Swift daemon — see
// swift-native-corpus.json's header for the exact boot recipe) to record ONLY
// the 5 NATIVELY-ROUTED ops (health, getPermissions, requestPermissions,
// listWindows, library — the ops actually served by Swift in production,
// per tests/conformance/lib/front-door.ts's PRODUCTION_ROUTING_CONFIG) to
// tests/conformance/corpus/swift-native-corpus.json instead. The DEFAULT
// (unset) behavior — recording all 30 ops to golden-corpus.json — is
// completely unchanged; this is purely additive.
//
// Run (Swift-native mode): SPECTRA_CORPUS_TARGET=swift-native
//   SPECTRA_DAEMON_SOCKET=<swift-socket>
//   SPECTRA_CONFORMANCE_SEED_SESSION=conformance-seed
//   npx tsx tests/conformance/corpus/record-corpus.ts
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
const swiftNativeCorpusPath = join(here, 'swift-native-corpus.json')

// The 5 ops served NATIVELY by Swift in the production routing config (NOT the
// broader 11-op "G1 control-plane" set — 6 of those, e.g. listSessions/
// getSession/closeSession, are PROXIED in production; a Swift byte-corpus for
// them is out of scope here — see tests/conformance/lib/front-door.ts's
// PRODUCTION_ROUTING_CONFIG, the single source of truth this list is kept in
// sync with by hand since importing it here would pull the front-door test
// harness into the recorder's dependency graph for no behavioral benefit).
const SWIFT_NATIVE_OPS = ['health', 'getPermissions', 'requestPermissions', 'listWindows', 'library'] as const

// PRIVACY (discovered live while recording swift-native-corpus.json): unlike
// the TS reference daemon (whose conformance harness fakes `listWindows` with
// a single deterministic "Fake Conformance App" window — see golden-
// corpus.json's own listWindows entries), the Swift G1 daemon-core's
// `listWindows` enumerates the REAL, LIVE macOS window list even under
// SPECTRA_CONFORMANCE_SEED=1 — real window titles (which can contain message
// previews, other people's names, document titles, etc.), real bundle ids,
// real pids. Recording that verbatim into a COMMITTED corpus fixture would
// bake this machine's live desktop contents (personal content) into the repo.
// It is also genuinely non-deterministic (window count/positions/titles
// change on any interactive machine), so it could never byte-diff stably
// anyway — matching lib/external-mode.ts's own documented call that
// `listWindows` is "shape-only (the live window list is host-volatile)".
// `redactLiveWindowList` replaces the `windows` array with a fixed placeholder
// BEFORE the entry is ever written to disk, for both payload arms — this
// function is the ONLY place raw `listWindows` output from a live host is
// ever handled in this recorder, and it is called unconditionally (not just
// when the array happens to be non-empty), so no future re-record can leak
// real window content by accident (e.g. a bogus test filter coincidentally
// matching a real window title). corpus.test.ts's replay side applies the
// IDENTICAL redaction to the freshly-replayed response before comparing, so
// this is a documented shape-only check for this one op/field, not a silent
// byte-diff weakening.
const LIVE_WINDOW_LIST_PLACEHOLDER = '<LIVE_WINDOW_LIST>'

function redactLiveWindowList(entry: CorpusEntry): CorpusEntry {
  if (entry.operation !== 'listWindows' || !entry.response.ok) return entry
  const result = entry.response.result as { windows?: unknown }
  if (!('windows' in result)) return entry
  return {
    ...entry,
    response: { ok: true, result: { ...result, windows: LIVE_WINDOW_LIST_PLACEHOLDER } },
  }
}

/** Calls `operation` with `payload.params` against `socketPath`, and returns
 * the normalized (request → response) corpus entry — the single per-call
 * recording step shared by both `recordCorpus()` (all 30 ops, golden-
 * corpus.json) and `recordSwiftNativeCorpus()` (5 native ops, swift-native-
 * corpus.json) so the two recording paths can never drift on HOW an entry is
 * captured/normalized, only on WHICH ops/payloads they iterate. */
async function recordOneEntry(
  socketPath: string,
  operation: string,
  genCtx: Awaited<ReturnType<typeof buildFixtureContext>>,
  payload: { label: string; params: unknown },
): Promise<CorpusEntry> {
  const params = withSessionOverride(operation, genCtx, payload.params)
  const response = await callOperation({ socketPath, operation, params })
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
  return normalizeEntry(entry)
}

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
        entries.push(await recordOneEntry(endpoint.socketPath, operation, genCtx, payload))
      }
    }
    return entries
  } finally {
    await endpoint.close()
    rmSync(scratchDir, { recursive: true, force: true })
  }
}

// ─── C8 — Swift-native corpus recording (5 ops, both payload arms) ─────────
//
// Records ONLY the 5 natively-routed ops, and ONLY 2 representative payload
// arms per op (10 entries total) — NOT the full `validPayloads()` sweep. For
// the 4 non-union ops (health/getPermissions/requestPermissions/listWindows)
// `validPayloads()` already returns exactly 2 ({label:'minimal'},
// {label:'full'}), so this is a no-op restriction for them. `library`'s param
// schema is a 9-arm discriminated union (add/find/gallery/get/tag/delete/
// status/export/migrate-from-showcase) — `validPayloads()` there returns 10
// entries (one `arm:<action>/minimal` per option + one trailing
// `arm:add/full`, per payload-generator.ts's own generation order: every
// per-arm minimal FIRST, the single full variant LAST). Taking
// `payloads[0]`/`payloads[payloads.length - 1]` therefore generically reduces
// to exactly 2 entries per op for ALL 5 — `{minimal, full}` for the 4 plain
// ops, `{arm:add/minimal, arm:add/full}` for library — with no op-specific
// branching in this function, and (not incidentally) both of those 2 labels
// are ALSO present in golden-corpus.json's own (full, 10-entry) library
// recording, which is what lets corpus.test.ts pair a swift-native-corpus
// entry back to its matching golden-corpus payloadLabel by lookup rather than
// needing a second, independent payload-generation pass.
export async function recordSwiftNativeCorpus(): Promise<CorpusEntry[]> {
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as EnrichedContractSpec
  const endpoint = await startConformanceDaemon()
  const scratchDir = mkdtempSync(join(tmpdir(), 'spectra-conformance-corpus-swift-native-'))

  try {
    const genCtx = await buildFixtureContext(endpoint, scratchDir)

    const entries: CorpusEntry[] = []
    for (const operation of SWIFT_NATIVE_OPS) {
      const opSpec = spec.operations[operation]
      const allPayloads = validPayloads(opSpec.params, genCtx)
      const selected = allPayloads.length > 1 ? [allPayloads[0], allPayloads[allPayloads.length - 1]] : allPayloads
      for (const payload of selected) {
        entries.push(redactLiveWindowList(await recordOneEntry(endpoint.socketPath, operation, genCtx, payload)))
      }
    }
    return entries
  } finally {
    await endpoint.close()
    rmSync(scratchDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  if (process.env.SPECTRA_CORPUS_TARGET === 'swift-native') {
    const entries = await recordSwiftNativeCorpus()
    writeFileSync(swiftNativeCorpusPath, `${JSON.stringify(entries, null, 2)}\n`)
    console.log(
      `Wrote ${swiftNativeCorpusPath} — ${entries.length} normalized (request → response) pairs across ` +
        `${SWIFT_NATIVE_OPS.length} natively-routed Swift ops (2 payload arms each).`,
    )
    return
  }

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
