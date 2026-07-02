// tests/conformance/corpus/normalize.ts
//
// M2B deliverable (c) — dual-run corpus normalization table (plan §F5).
// Recorded request/response pairs are non-deterministic in exactly the ways
// documented below; normalizing them BEFORE diffing is what turns the corpus
// into signal instead of noise. Over-normalization is itself a form of oracle
// erosion (plan R5) — every rule below exists because a SPECIFIC field is
// provably non-deterministic across two otherwise-identical runs, not as a
// blanket "make the diff pass" measure.
//
// Normalization rules applied (deep walk over every request param + response
// result/error, keyed by PROPERTY NAME — not by value shape, so a field that
// happens to look like a timestamp but isn't named like one is left alone):
//
//   1. requestId, eventId, tokenId              → "<ID>"   (fresh per call)
//   2. sessionId, recordingId, artifactId,
//      decisionId, id (library/session ids)      → "<ID>"   (fresh per session/run)
//   3. timestamp, createdAt, updatedAt, closedAt,
//      startedAt, stoppedAt, emittedAt,
//      lastCheckedAt, durationMs, duration        → "<TIMESTAMP>" (wall-clock)
//   4. pid, processId, windowId, port, tcpPort    → "<PID>"  (OS-assigned, host-specific)
//   5. Any string VALUE that looks like an absolute filesystem path
//      (starts with "/" and contains 2+ path segments) OR a key named
//      path/outPath/rawPath/sourcePath/storageRoot/manifestPath/outputDir/
//      screenshotPath/snapshotBefore/snapshotAfter/cursorTelemetryPath →
//      "<PATH>" (host/tempdir-specific; only the LAST path segment's
//      extension is preserved, e.g. "<PATH>.mp4", since the extension IS
//      contract-meaningful (format) while the directory is not).
//   6. Arrays of PRIMITIVES (string/number/boolean) are sorted before
//      comparison — ordering of e.g. `sensitive: string[]` or `warnings:
//      string[]` is not a contract guarantee. Arrays of OBJECTS are left in
//      response order — the corpus differ therefore cannot yet catch a pure
//      reordering of e.g. `sessions[]`; this is a documented, NOT a silent,
//      limitation (surfaced in the M2B report, not swept under normalization).
//   7. A `createdAt`/`updatedAt`/etc. TIMESTAMP_KEY rendered as an ISO-8601
//      STRING (listSessions/getSession) is normalized the same as its
//      epoch-number siblings — same non-determinism, different
//      serialization.
//   8. `event`/`detail` (free-text log lines in terminal/demo-run-script
//      timelines) have embedded "N.NNs"-style durations normalized to
//      "<DURATION>".
//   9. Any string with a 10+ digit run (an embedded epoch timestamp, e.g.
//      recordTerminal's `castFile` filename) has that run normalized to
//      "<TIMESTAMP>".
//  10. getPermissions/requestPermissions/health: `permissions[].state` and
//      `.canPrompt` reflect LIVE macOS TCC state, not daemon logic — see
//      LIVE_OS_STATE_OPERATIONS below.
//  11. A `http://127.0.0.1:<port>/...` URL (the in-process local web fixture
//      server createSession's `target` payload points at — see
//      lib/fixture-context.ts) is normalized to "<LOCAL_FIXTURE_URL>": the
//      port is a fresh OS-assigned value every daemon spawn even though the
//      fixture's content is fixed.
//  12. A bracketed `[ex<base36>]` token in free text (e.g. createSession's
//      `snapshot` markdown, `[exarmi1k] group "..."`) is a synthetic AX
//      element id src/cdp/accessibility.ts mints via
//      `ex${Math.random().toString(36).slice(2,8)}` (=`ex`+≤6 base36 chars)
//      for a node with no `backendDOMNodeId` — normalized to
//      "[<SYNTHETIC_AX_ID>]". Ids are ALWAYS rendered bracketed by
//      src/core/serialize.ts (`[${el.id}] ${role} "${label}"`); real
//      (backend-node-backed) ids are `e<digits>` and never start with "ex".
//      Anchoring on the `[ex…]` bracket is what keeps this from matching
//      ordinary words that merely start with "ex" (exited/export/exchange/
//      exported) — the D2 defect the loose `\bex[0-9a-z]+\b` form had, which
//      silently masked genuine text drift.
//
// Rules 7-9 were NOT anticipated up front — they were discovered live by
// running the corpus diff against the real TS daemon during M2B
// implementation (recordTerminal's timeline `time`/`event`/`castFile` fields
// and listSessions' ISO createdAt all failed the diff before these rules
// existed). That failure-then-fix loop is itself part of the oracle-erosion
// control (plan R5): each rule above is traceable to a REPRODUCED false
// positive, not added speculatively.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

const ID_KEYS = new Set([
  'requestId', 'eventId', 'tokenId', 'sessionId', 'recordingId', 'artifactId', 'decisionId', 'id',
  // `runId` — a capture-run id (getRun/getSession); random per daemon spawn
  // (derived from the fresh fixture sessionId). Discovered live via the corpus
  // diff once the D1 recorder fix made getRun/getSession record their success
  // shape instead of a not_found error.
  'runId',
])
const TIMESTAMP_KEYS = new Set([
  'timestamp', 'createdAt', 'updatedAt', 'closedAt', 'startedAt', 'stoppedAt', 'emittedAt',
  'lastCheckedAt', 'durationMs', 'duration', 'inputDuration', 'outputDuration',
  // snake_case timestamp keys — the library subsystem (src/library/*) uses
  // snake_case field names (created_at/updated_at, rendered as ISO strings),
  // unlike the camelCase core API. Discovered live via the corpus diff on the
  // library arms (add/find/gallery/status/export) after the D1 fixes made the
  // library ops reach their success path deterministically. `newest`/`oldest`
  // are library-status ISO timestamps of the newest/oldest catalog entry —
  // same wall-clock non-determinism. `duration_ms` is a snake_case wall-clock
  // duration (walkthrough / stopRecording inline timing) that drifts a
  // millisecond or two run-to-run — same class as camelCase `durationMs`.
  'created_at', 'updated_at', 'newest', 'oldest', 'duration_ms',
  // `time` (terminal recorder timeline entries: seconds-since-recording-start,
  // a float wall-clock offset) — discovered live via the corpus diff itself
  // (recordTerminal[minimal] failed on a `time` float drift before this rule
  // was added; see the M2B report's mutation/finding section).
  'time',
  // `uptimeSec` (health result: daemon process uptime) — same discovery path.
  'uptimeSec',
])
// 10+ consecutive digits inside an otherwise-stable string is an embedded
// epoch timestamp (e.g. recordTerminal's `castFile: "<dir>/1782970835493.cast"`)
// — also discovered live via the corpus diff. Deliberately narrow (digit-run
// length, not "any number-looking substring") so it doesn't swallow
// contract-meaningful numeric strings. See `normalize()` below.
const HOST_SPECIFIC_NUMBER_KEYS = new Set(['pid', 'processId', 'windowId', 'port', 'tcpPort'])
const PATH_KEYS = new Set([
  'path', 'outPath', 'rawPath', 'sourcePath', 'storageRoot', 'manifestPath', 'outputDir',
  'screenshotPath', 'snapshotBefore', 'snapshotAfter', 'cursorTelemetryPath', 'outDir',
])
// Free-text log/description fields that legitimately embed a wall-clock
// float duration inline (e.g. recordTerminal's timeline
// `event: "exited with code 0 after 0.01s"`) — discovered live via the
// corpus diff (the digit-run rule below doesn't fire on "0.01" — only 1-2
// digits either side of the dot). Scoped to these two known keys rather than
// any string, to avoid swallowing contract-meaningful text elsewhere.
const EMBEDDED_DURATION_TEXT_KEYS = new Set(['event', 'detail'])

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

// createSession's `target` param is a `http://127.0.0.1:<port>/...` URL
// backed by an in-process HTTP fixture server (tests/conformance/lib/
// fixture-context.ts's startLocalWebFixtureServer) started fresh — on a
// freshly OS-assigned port — every time buildFixtureContext() runs. The port
// therefore differs on every daemon spawn (record vs. replay, or replay vs.
// replay) even though the fixture's CONTENT is fully deterministic. Without
// this rule the port leaks into the response via createSession's own
// `snapshot` text ("# Page: http://127.0.0.1:<port>/...") and would produce a
// permanent, un-actionable corpus diff on every replay — a purely
// host/run-specific value, same class as PID/port normalization above, just
// embedded inside free text rather than under a dedicated key.

function looksLikeAbsolutePath(value: string): boolean {
  return value.startsWith('/') && value.split('/').filter(Boolean).length >= 2
}

function normalizePathValue(value: string): string {
  const dotIndex = value.lastIndexOf('.')
  const slashIndex = value.lastIndexOf('/')
  const hasExtension = dotIndex > slashIndex && dotIndex !== -1
  return hasExtension ? `<PATH>${value.slice(dotIndex)}` : '<PATH>'
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/** Deep-normalizes a request params object or a response result/error body
 * per the rules documented above. Pure function — same input always
 * normalizes to the same output. */
export function normalize(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalize(item))
    if (normalized.every(isPrimitive)) {
      return [...normalized].sort((a, b) => String(a).localeCompare(String(b)))
    }
    return normalized
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalize(v, k)
    }
    return out
  }

  if (key && ID_KEYS.has(key) && typeof value === 'string') return '<ID>'
  if (key && TIMESTAMP_KEYS.has(key) && typeof value === 'number') return '<TIMESTAMP>'
  // `listSessions`/`getSession` render createdAt as an ISO string (not the
  // raw epoch number `TimestampMs` elsewhere) — discovered live via the
  // corpus diff. Same field, different serialization; same non-determinism.
  if (key && TIMESTAMP_KEYS.has(key) && typeof value === 'string' && ISO_DATE_PATTERN.test(value)) {
    return '<TIMESTAMP>'
  }
  if (key && HOST_SPECIFIC_NUMBER_KEYS.has(key) && typeof value === 'number') return '<PID>'
  if (key && PATH_KEYS.has(key) && typeof value === 'string') return normalizePathValue(value)
  if (typeof value === 'string' && looksLikeAbsolutePath(value)) return normalizePathValue(value)
  if (typeof value === 'string' && key && EMBEDDED_DURATION_TEXT_KEYS.has(key)) {
    const replaced = value.replace(/\d+(\.\d+)?s\b/g, '<DURATION>')
    if (replaced !== value) return replaced
  }
  if (typeof value === 'string') {
    // Chained (not early-returning after the first hit): a single string —
    // e.g. createSession's `snapshot` text — can legitimately contain BOTH a
    // local-fixture URL AND an embedded epoch timestamp at once, so each
    // rule must see the OTHER rule's output, not just the original value.
    // Fresh regex literals per call — a `g`-flagged RegExp reused across
    // calls via `.test()` (which advances `lastIndex`) is a classic
    // footgun; `.replace()` is itself a no-op when there's no match, so no
    // guard is needed before applying each in turn.
    // Library capture ids are minted as `cap_<random hex>` (src/library/*),
    // both as standalone values (e.g. add's `added`) and embedded in free text
    // (e.g. `summary: "cap_8d40… | screenshot | web | …"`). They are per-add
    // random — normalized to <ID> like every other id class. Applied first so
    // the id inside `summary` is neutralized before the other string rules run.
    const withoutCaptureIds = value.replace(/\bcap_[0-9a-f]{6,}\b/g, '<ID>')
    // An absolute temp path EMBEDDED in free text — e.g. migrate-from-showcase's
    // warning "Showcase index.json not found at /private/var/folders/…/spectra-
    // conformance-home-<rand>/.showcase/index.json". The per-spawn temp HOME
    // (mkdtemp suffix) makes this host/run-specific. `looksLikeAbsolutePath`
    // only fires on a WHOLE-value path; this catches the temp path inside a
    // sentence. Scoped to the OS temp roots (var/folders, /tmp) so it can't
    // swallow contract-meaningful text — same class as the PATH_KEYS rule.
    // The extension of the LAST segment is PRESERVED (via normalizePathValue) so
    // a drift to a DIFFERENT file inside a temp path (e.g. `index.json` →
    // `index.yaml`) still shows up in the diff instead of both collapsing to a
    // bare `<PATH>`.
    const withoutTempPaths = withoutCaptureIds.replace(
      /\/(?:private\/)?(?:var\/folders|tmp)\/[^\s"']+/g,
      (match) => normalizePathValue(match),
    )
    const withoutFixtureUrl = withoutTempPaths.replace(/https?:\/\/127\.0\.0\.1:\d+\/[^\s"'\\]*/g, '<LOCAL_FIXTURE_URL>')
    // D2 fix: the previous `\bex[0-9a-z]+\b` matched ordinary English words
    // (exited/export/exact/exchange/exported) and silently masked real text
    // drift. The synthetic id is minted ONLY as `ex${Math.random().toString(36)
    // .slice(2,8)}` (src/cdp/accessibility.ts) — `ex` + up to 6 base36 chars —
    // and is ALWAYS rendered bracketed as `[<id>]` (src/core/serialize.ts's
    // `[${el.id}] ${role} "${label}"`). Real (backend-node-backed) ids are
    // `e${digits}` — never start with `ex`. Anchoring on the `[ex…]` bracket
    // context (the sole render path) makes this match the synthetic-id form
    // exactly, with zero false positives on free-text words that merely start
    // with "ex". The brackets are preserved so `[exarmi1k]` → `[<SYNTHETIC_AX_ID>]`.
    const withoutSyntheticAxIds = withoutFixtureUrl.replace(/\[ex[0-9a-z]{1,6}\]/g, '[<SYNTHETIC_AX_ID>]')
    // A session/run/recording id (8-hex-lowercase, random per daemon spawn) that
    // leaks into a free-text message — e.g. stopRecording's inline `error:
    // "No active recording for session 70dabbca"`. The id-as-a-VALUE is already
    // covered by ID_KEYS; this catches it EMBEDDED in a sentence. ANCHORED to
    // the `session|run|recording <id>` context (not a bare 8-char class) so it
    // can't swallow an unrelated 8-digit/8-letter token in some other message —
    // same anchoring discipline as the D2 `[ex…]` bracket rule (per the Fable
    // gate's over-breadth finding).
    const withoutEmbeddedIds = withoutSyntheticAxIds.replace(
      /\b(session|run|recording) [0-9a-f]{8}\b/g,
      '$1 <ID>',
    )
    const replaced = withoutEmbeddedIds.replace(/\d{10,}/g, '<TIMESTAMP>')
    if (replaced !== value) return replaced
  }

  return value
}

export interface CorpusEntry {
  operation: string
  payloadLabel: string
  request: unknown
  response:
    | { ok: true; result: unknown }
    | { ok: false; errorCode: string; errorMessage: string }
}

// `getPermissions`/`requestPermissions` read REAL macOS TCC permission state
// (Accessibility/Screen Recording grants) — discovered live via the corpus
// diff (a run flipped `state: "denied"` → `"granted"` between record and
// replay because the host's actual OS permission grant changed mid-session,
// unrelated to any daemon code path). This is genuine environmental state,
// not daemon-determinism to gate an M3 cutover on — normalizing `state`/
// `canPrompt` away here is NOT the same class of erosion as normalizing a
// structural field would be: conformance.test.ts already validates this
// result's SHAPE (state is one of the declared PermissionState values) on
// every run; only the corpus DIFF (looking for behavior drift over time)
// would be false-signaling on a field that legitimately reflects live OS
// state rather than daemon logic. Scoped to exactly these two operations —
// `state` on e.g. a recording status IS daemon-determined and stays strict.
//
// `health` joins this set for the identical reason (discovered live via the
// same class of corpus-diff false positive, M2B completion pass): its
// optional `permissions` field is sourced from the SAME
// `getPermissionStatuses()` call (src/daemon/core-impl.ts's `health()` wires
// `permissionsProvider: () => this.getPermissions({}).then(r => r.permissions)`
// straight into `daemonHealth()`), so it carries the exact same live-TCC-state
// non-determinism, not a daemon-logic difference.
const LIVE_OS_STATE_OPERATIONS = new Set(['getPermissions', 'requestPermissions', 'health'])

interface PermissionsLikeResult {
  permissions: Array<Record<string, unknown>>
}

function isPermissionsLikeResult(value: unknown): value is PermissionsLikeResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray((value as { permissions?: unknown }).permissions)
  )
}

function stripLiveOsPermissionState(result: unknown): unknown {
  if (!isPermissionsLikeResult(result)) return result
  return {
    ...result,
    permissions: result.permissions.map((permission) => ({
      ...permission,
      state: '<LIVE_OS_STATE>',
      canPrompt: '<LIVE_OS_STATE>',
    })),
  }
}

export function normalizeEntry(entry: CorpusEntry): CorpusEntry {
  let response = entry.response.ok
    ? ({ ok: true, result: normalize(entry.response.result) } as const)
    : ({ ok: false, errorCode: entry.response.errorCode, errorMessage: '<MESSAGE>' } as const)

  if (response.ok && LIVE_OS_STATE_OPERATIONS.has(entry.operation)) {
    response = { ok: true, result: stripLiveOsPermissionState(response.result) }
  }

  return {
    operation: entry.operation,
    payloadLabel: entry.payloadLabel,
    request: normalize(entry.request),
    response,
  }
}
