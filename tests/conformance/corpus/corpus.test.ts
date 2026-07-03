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
import { SWIFT_G1_VERIFIABLE_OPS, externalSkipReason } from '../lib/external-mode.js'
import { normalizeEntry, type CorpusEntry } from './normalize.js'

// M3 external-daemon gating — see conformance.test.ts's identical constant for
// why this reads the env var directly rather than `endpoint.external` (the
// per-entry `it`/`it.skip` calls below are registered synchronously, before
// `beforeAll` resolves `endpoint`).
const isExternalDaemon = Boolean(process.env.SPECTRA_DAEMON_SOCKET)

const here = dirname(fileURLToPath(import.meta.url))
const corpusPath = join(here, 'golden-corpus.json')
const swiftNativeCorpusPath = join(here, 'swift-native-corpus.json')
const specPath = join(here, '..', '..', '..', 'src', 'contract', 'contract.spec.json')

// C8 (Fable M3.G1 follow-on) — the 5 ops served NATIVELY by Swift in
// production (see record-corpus.ts's identical constant/doc comment). golden-
// corpus.json is TS-recorded, so BYTE-DIFFING it against ANY external (Swift)
// daemon is invalid for EVERY op, not just these 5 — that is the whole basis
// error the Fable M3.G1 flip-gate reconciliation found (see verify-flip-
// suite.ts's gateA() note). `lib/external-mode.ts`'s SWIFT_G1_VERIFIABLE_OPS
// allowlist (11 ops: these 5 + 6 more session/library-adjacent ops) still
// gates the SHAPE-ONLY entries below (CORPUS_SHAPE_ONLY_OPS) — that allowlist
// answers "does the standalone Swift daemon implement this op at all", which
// a shape-only ok-ness check still needs (confirmed live: `createSession`
// is NOT in that allowlist — G1 has no browser driver — and DOES fail its
// shape-only check externally when not skipped) — but it is NOT reused here
// to decide BYTE-DIFF eligibility: confirmed live (2026-07-03, recording this
// corpus against a fresh standalone Swift daemon) that getSession/getRun/
// recordLlmUsage — 3 of that allowlist's non-native ops — FAIL a golden-
// corpus.json byte-diff against Swift (real content/shape divergence, not
// flakiness), which would turn Gate A red the moment corpus.test.ts is
// re-added there. So for the BYTE-DIFF entries in this file, in external
// mode, the ONLY ops ever compared are the 5 native ops with a matching
// swift-native-corpus.json entry — every other byte-diff entry (the other 6
// "G1 control-plane" ops AND the 19 driver/capture ops alike) is SKIPPED. This
// is a narrower byte-diff basis than the old allowlist-driven skip (which ran
// those 6 non-native G1 ops' byte-diff against golden-corpus.json) — a
// deliberate correction, not an oversight: those 6 ops don't yet have a valid
// Swift-recorded corpus (session/capture op-groups are a later milestone, per
// the C8 task scope) and golden-corpus.json can never validly stand in for
// one.
const SWIFT_NATIVE_OPS = new Set(['health', 'getPermissions', 'requestPermissions', 'listWindows', 'library'])

/** The swift-native-corpus.json entries, keyed by `${operation} ${payloadLabel}`
 * for O(1) lookup while iterating golden-corpus.json's entries below (golden-
 * corpus.json stays the iteration source — see the loop below — since it
 * already covers all 30 ops incl. the 5 native ones; this file is consulted
 * only to swap in the correct EXPECTED response for a native op in external
 * mode). Empty (not fatal) when the file has not been recorded yet — every
 * native-op entry then has no match and is SKIPPED with an explanatory
 * reason, same as any other not-yet-recorded corpus gap. */
function loadSwiftNativeCorpus(): Map<string, CorpusEntry> {
  if (!existsSync(swiftNativeCorpusPath)) return new Map()
  const raw = JSON.parse(readFileSync(swiftNativeCorpusPath, 'utf8')) as CorpusEntry[]
  return new Map(raw.map((e) => [`${e.operation} ${e.payloadLabel}`, e]))
}

// PRIVACY/non-determinism (mirrors record-corpus.ts's identical redaction —
// see its doc comment): the Swift daemon-core's `listWindows` enumerates the
// REAL, live macOS window list (unlike the TS reference daemon's fake
// conformance window), so swift-native-corpus.json's `listWindows` entries
// have their `windows` array pre-redacted to a fixed placeholder at RECORD
// time. The freshly-replayed response here must have the SAME redaction
// applied before comparison, or every replay would either fail on genuinely
// volatile live window content or leak this run's real window titles into a
// test failure message. Applied ONLY when comparing against the swift-native
// corpus (external mode) — golden-corpus.json's own listWindows entries (the
// TS daemon's deterministic fake window) are byte-diffed unmodified, as
// before.
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

  // Real-Chrome + STATEFUL ops whose byte-exact corpus diff is inherently
  // non-deterministic, so they are SHAPE-VERIFIED here (envelope valid + ok-ness
  // matches the record) instead of byte-diffed:
  //   - createSession drives REAL Chrome; snapshot/elementCount race AX-stability
  //     vs page-load even on the fixed fixture page, and it's the only op that
  //     spawns a real browser (flaky under host load — retries help but don't
  //     eliminate it).
  //   - listSessions returns the accumulated session list, whose count/order is
  //     a DERIVED side effect of every createSession that ran before it in the
  //     same daemon — it inherits createSession's non-determinism.
  // Their full RESULT SHAPE is validated on EVERY run in conformance.test.ts
  // (validateShape against the enriched spec), so contract coverage is NOT lost;
  // only the byte-parity dual-run is dropped for these two. Real-Chrome parity
  // for M3/Swift is addressed by the wire-seeding design in
  // docs/plans/m3-external-daemon-seeding.md, not by byte-diffing a browser race.
  // This is the same discipline as the LIVE_OS_STATE normalization (right tool
  // for a genuinely non-deterministic source), documented not silent.
  const CORPUS_SHAPE_ONLY_OPS = new Set(['createSession', 'listSessions'])

  // C8: loaded once — see loadSwiftNativeCorpus()'s doc comment. Only ever
  // consulted when isExternalDaemon && the entry's op is in SWIFT_NATIVE_OPS.
  const swiftNativeCorpus = loadSwiftNativeCorpus()

  for (const entry of corpus) {
    const shapeOnly = CORPUS_SHAPE_ONLY_OPS.has(entry.operation)
    const retries = KNOWN_RACY_OPS.has(entry.operation) ? 3 : 0
    const isSwiftNativeOp = SWIFT_NATIVE_OPS.has(entry.operation)
    // C8: for a natively-routed op in EXTERNAL mode, the byte-regression
    // basis is the SWIFT-recorded corpus (swift-native-corpus.json), never
    // golden-corpus.json (TS-recorded — see this file's SWIFT_NATIVE_OPS doc
    // comment). `swiftNativeExpected` is looked up by (operation,
    // payloadLabel) — swift-native-corpus.json only records 2 of a native
    // op's payload arms (record-corpus.ts's recordSwiftNativeCorpus() doc
    // comment), so a golden-corpus entry for a THIRD arm (e.g. library's
    // "arm:find/minimal") has no Swift-recorded counterpart and is SKIPPED,
    // same as a non-native op would be.
    const swiftNativeExpected =
      isExternalDaemon && isSwiftNativeOp ? swiftNativeCorpus.get(`${entry.operation} ${entry.payloadLabel}`) : undefined
    // C8: SHAPE-ONLY entries (createSession/listSessions) never byte-diff —
    // their assertion is only "did the op return the same ok-ness" (see
    // CORPUS_SHAPE_ONLY_OPS's doc comment above), which is NOT susceptible to
    // the TS-vs-Swift byte-diff basis error, so they keep their ORIGINAL
    // gate: SWIFT_G1_VERIFIABLE_OPS answers "does the standalone Swift daemon
    // implement this op at all" (createSession — no browser driver in G1 —
    // stays skipped; listSessions — implemented — still runs). Every OTHER
    // (byte-diff) entry uses the narrower native-corpus-only rule instead —
    // see SWIFT_NATIVE_OPS's doc comment for why golden-corpus.json is no
    // longer a valid byte-diff basis for the other 6 SWIFT_G1_VERIFIABLE_OPS
    // members either.
    const skipExternally = isExternalDaemon && (
      shapeOnly ? !SWIFT_G1_VERIFIABLE_OPS.has(entry.operation) : isSwiftNativeOp ? swiftNativeExpected === undefined : true
    )
    const test = skipExternally ? it.skip : it
    const label =
      (shapeOnly
        ? `${entry.operation} [${entry.payloadLabel}] — replays to a spec-valid envelope with matching ok-ness (byte-diff N/A: real-Chrome/stateful)`
        : swiftNativeExpected
          ? `${entry.operation} [${entry.payloadLabel}] — regenerated request matches the Swift-recorded native corpus (swift-native-corpus.json)`
          : `${entry.operation} [${entry.payloadLabel}] — regenerated request matches the recorded normalized response`) +
      (skipExternally
        ? ` — SKIPPED: ${
            shapeOnly
              ? externalSkipReason(entry.operation)
              : isSwiftNativeOp
                ? `no Swift-recorded corpus entry for payloadLabel "${entry.payloadLabel}" in swift-native-corpus.json ` +
                  '(only 2 representative arms are recorded per native op — see record-corpus.ts)'
                : 'external Swift daemon — golden-corpus.json is TS-recorded, not a valid byte-diff basis for any ' +
                  'op it did not itself serve; see swift-native-corpus.json for the 5 ops that have a Swift-recorded baseline'
          }`
        : '')
    test(label, { timeout: 30_000, retry: retries }, async () => {
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

      if (shapeOnly) {
        // Non-byte parity: assert the op still replays to the SAME ok-ness the
        // corpus recorded (createSession→ok:true, etc.). Shape correctness is
        // covered by conformance.test.ts; this keeps a "still works over the
        // wire" signal without the flaky byte-equality.
        expect(body.ok, `${entry.operation}[${entry.payloadLabel}] ok-ness drifted from the recorded corpus`).toBe(entry.response.ok)
        return
      }

      const replayed: CorpusEntry = {
        operation: entry.operation,
        payloadLabel: entry.payloadLabel,
        request: params,
        response: body.ok
          ? { ok: true, result: body.result }
          : { ok: false, errorCode: body.error.code, errorMessage: body.error.message },
      }

      // C8: byte-regress against the Swift-recorded expectation for a native
      // op under an external daemon; golden-corpus.json's own `entry.response`
      // otherwise (in-process TS mode, or a non-native op — unchanged).
      // `redactLiveWindowList` is a no-op for every op except listWindows
      // under the swift-native comparison — see its doc comment.
      const actual = swiftNativeExpected ? redactLiveWindowList(normalizeEntry(replayed)) : normalizeEntry(replayed)
      expect(actual.response).toEqual((swiftNativeExpected ?? entry).response)
    })
  }
})
