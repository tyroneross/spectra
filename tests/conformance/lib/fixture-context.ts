// tests/conformance/lib/fixture-context.ts
//
// Shared fixture-context builder used by conformance.test.ts,
// corpus/record-corpus.ts, and corpus/corpus.test.ts, so all three exercise
// the exact same payload-generation logic (only the DAEMON ENDPOINT they
// point at differs). Kept as one file rather than triplicated so a future
// per-op session-routing rule (MACOS_SESSION_OPS) only needs a single edit.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { createServer, type Server } from 'node:http'
import { cpSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callOperation } from './socket-client.js'
import type { DaemonEndpoint, DaemonSessionIds } from './daemon-endpoint.js'
import type { GeneratorContext } from './payload-generator.js'
import { FAKE_ELEMENT_ID } from './fakes.js'

const here = dirname(fileURLToPath(import.meta.url))
// Committed input fixtures (a valid .cast + a small .mp4) live alongside the
// harness so replayTerminal (reads a `.cast`) and library:add / recordComposite
// (ffprobe a real media file) reach their SUCCESS path instead of ENOENT-ing
// on a missing file. D5 fix: the payload-generator's file hints resolve to
// `${ctx.scratchDir}/<name>` (a fresh per-run temp dir), so the committed
// fixtures must be COPIED into that scratch dir at context-build time — they
// are never referenced from their source location directly (keeps every read
// pointed at the same isolated temp root the harness cleans up afterward).
const FIXTURES_SRC_DIR = join(here, '..', 'fixtures')

/** Operations whose fixture sessionId must be the 'macos' session (not the
 * default 'web' one) to reach a live SUCCESS path rather than only an
 * error-shape path. `startRecording` starts a recording on the (seeded-clean)
 * macos session; `stopRecording` runs afterward (alphabetically) and stops that
 * same recording — both on macos so start→stop is a coherent pair. */
export const MACOS_SESSION_OPS = new Set(['startRecording', 'stopRecording'])

/** Read-only operations routed to the pristine, pre-seeded `readonly` session
 * so they validate a KNOWN-GOOD nested shape instead of the malformed-payload-
 * polluted shared `web` session (see daemon-runner.ts's readonly-session note). */
export const READONLY_SESSION_OPS = new Set(['getSession', 'getRun'])

// Fixed HTML content served by the local fixture server below — deterministic
// element count/labels every time (a heading + a button), so createSession's
// AX snapshot never depends on real network content or its loading latency.
const FIXTURE_HTML =
  '<!DOCTYPE html><html><head><title>Spectra Conformance Fixture</title></head>' +
  '<body><h1>Spectra Conformance Fixture</h1><button type="button">Fixture Button</button></body></html>'

/** Starts a same-machine, no-network HTTP server serving `FIXTURE_HTML` for
 * any path, bound to an OS-assigned loopback port. `unref()`d so it never
 * keeps the test process alive — it is torn down implicitly when the process
 * exits (each conformance test file's own process/worker lifetime already
 * bounds this fixture's lifetime; nothing here depends on an explicit close). */
function startLocalWebFixtureServer(): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(FIXTURE_HTML)
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.unref()
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('local web fixture server did not bind to a TCP port'))
        return
      }
      resolve({ url: `http://127.0.0.1:${address.port}/conformance-fixture` })
    })
  })
}

// ─── External-daemon Tier-1 wire seeding ───────────────────────────────────
// (docs/plans/m3-external-daemon-seeding.md) — reproduces the in-process
// daemon-runner.ts fixture shape (a `web` session + a pristine `readonly`
// session pre-seeded with 2 conformant `act` steps) using ONLY real,
// spec-conformant operation calls over the socket, since an external (Swift)
// daemon has no in-process seam to inject a FakeDriver-backed session the way
// daemon-runner.ts does.

/** Real AX-tree line format is `serializeSnapshot`'s `[<id>] <role> "<label>"
 * ...` (src/core/serialize.ts) — e.g. `[e42] button "Fixture Button" ...` for
 * a real CDP-driven snapshot of the fixture page's `<button>`. Matches the
 * FIRST `button`-role line to recover a real, driver-assigned element id. */
const BUTTON_SNAPSHOT_LINE_RE = /^\[([^\]]+)\]\s+button\b/m

/** Calls `createSession` over the wire and returns its `sessionId`, or
 * `'unavailable'` if the call fails or the response is malformed — mirrors
 * the pre-existing best-effort extraction this branch already used, so a
 * daemon hiccup during fixture bootstrap surfaces as downstream
 * session_not_found failures (informative) rather than crashing every test
 * in the file (uninformative). */
async function createExternalSession(socketPath: string, target: string): Promise<string> {
  try {
    const created = await callOperation({ socketPath, operation: 'createSession', params: { target } })
    const body = created.body as { ok?: boolean; result?: { sessionId?: string } }
    return body.ok ? body.result?.sessionId ?? 'unavailable' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/** Snapshots `sessionId` and returns a real, driver-assigned actionable
 * element id (the fixture page's `<button>`) — or `fallback` (the
 * FAKE_ELEMENT_ID hint) if the snapshot call fails, the session is
 * unavailable, or no button-role line is found. Never throws: Tier-1 seeding
 * is best-effort against a real external daemon whose snapshot behavior this
 * harness does not control. */
async function findActionableElementId(socketPath: string, sessionId: string, fallback: string): Promise<string> {
  try {
    const snap = await callOperation({ socketPath, operation: 'snapshot', params: { sessionId } })
    const body = snap.body as { ok?: boolean; result?: { snapshot?: string } }
    const text = body.ok ? body.result?.snapshot : undefined
    if (typeof text === 'string') {
      const match = BUTTON_SNAPSHOT_LINE_RE.exec(text)
      if (match) return match[1]
    }
  } catch {
    // Best-effort — fall through to the hint below.
  }
  return fallback
}

/** Best-effort `act` call used only for Tier-1 seeding — swallows errors so
 * one failed seed step (e.g. the external daemon rejects the recovered
 * element id) never crashes fixture-context bootstrap for the whole suite;
 * the readonly session simply ends up with fewer than 2 seeded steps, which
 * getSession/getRun will still validate (just against a smaller step array). */
async function seedAct(socketPath: string, sessionId: string, elementId: string, value?: string): Promise<void> {
  try {
    await callOperation({
      socketPath,
      operation: 'act',
      params: { sessionId, elementId, action: 'click', ...(value !== undefined ? { value } : {}) },
    })
  } catch {
    // Best-effort seeding — see doc comment above.
  }
}

// M3.G2 (S7) — read ONLY at module load (same rule as external-mode.ts's
// `milestoneG2`/payload-generator.ts's `milestoneG2`): gates the `fake:`
// target seeding path below. Default (unset) is byte-identical to the
// pre-G2 Tier-1 seeding behavior (localWebFixtureUrl for every seeded
// session) — this only changes what target string Tier-1 seeding calls
// createSession with, never whether seeding happens.
const milestoneG2 = process.env.SPECTRA_CONFORMANCE_MILESTONE === 'g2'

// [ASSUMED name, reversible — docs/plans/m3-g2-plan.md §Env Contract],
// mirrors payload-generator.ts's identically-named override so both harness
// entry points agree on which `fake:` target string to seed against without
// a second, independently-fragile default.
const FAKE_TARGET_DEFAULT = 'fake:conformance-seed'
function fakeSeedTarget(): string {
  return process.env.SPECTRA_CONFORMANCE_FAKE_TARGET ?? FAKE_TARGET_DEFAULT
}

// M3.G2 Advisor ruling 2 (docs/plans/m3-g2-vb-advisor-ruling-2.md, Item 3) —
// mirrors `fakeSeedTarget()`'s env-overridable-default pattern for the V-A
// getRecording D1 guard: under the g2 milestone gate, the external daemon is
// presumed to be a Swift daemon-core running with SPECTRA_CONFORMANCE_SEED=1
// (same presumption `seedExternalSessions` already encodes below), which
// (RecordingOps.swift:498) seeds a fixed `conformance-seed-recording` id.
// The literal default MUST match that Swift-side literal verbatim.
function seedRecordingId(): string {
  return process.env.SPECTRA_CONFORMANCE_SEED_RECORDING ?? 'conformance-seed-recording'
}

/** Tier-1 wire seeding for an external daemon: a plain `web` session, and a
 * SECOND, dedicated `readonly` session seeded with 2 conformant `act` steps
 * (a bare click, then click-with-value) so getSession/getRun validate a real
 * nested SessionStep[]/CaptureRunAction[] shape — not an empty array. Tier-2
 * (recordingId) is intentionally NOT seeded here: recording seeding needs
 * native capture permission on the daemon's host, which this harness cannot
 * grant deterministically; recordingId stays undefined for external daemons
 * (see GeneratorContext.recordingId doc comment) and startRecording/
 * getRecording/stopRecording are excluded from external-mode verification
 * (lib/external-mode.ts EXTERNAL_ONLY_SKIP_OPS).
 *
 * M3.G2 (S7, seed-gated — plan §Depends-on: "macos is not independently
 * wire-seedable here (no native AX driver seam over the wire)" is a G1-only
 * finding): under the g2 milestone gate, the external daemon is presumed to
 * be a Swift daemon-core running with `SPECTRA_CONFORMANCE_SEED=1`, which
 * (ADR-06) accepts a `fake:`-prefixed createSession target and serves it
 * NATIVELY via FakeDriver — so Tier-1 seeding routes at that target instead
 * of the web fixture URL, exercising Swift's own native createSession/
 * DriverRegistry path rather than a CDP/web driver the standalone Swift G2
 * daemon does not implement. Gate-off (default): unchanged
 * `localWebFixtureUrl` seeding, byte-for-byte identical to before this
 * branch existed. */
async function seedExternalSessions(socketPath: string, localWebFixtureUrl: string): Promise<DaemonSessionIds> {
  const seedTarget = milestoneG2 ? fakeSeedTarget() : localWebFixtureUrl
  const web = await createExternalSession(socketPath, seedTarget)
  const readonly = await createExternalSession(socketPath, seedTarget)

  const elementId = await findActionableElementId(socketPath, readonly, FAKE_ELEMENT_ID)
  await seedAct(socketPath, readonly, elementId)
  await seedAct(socketPath, readonly, elementId, 'seed-value')

  // macos is still aliased to the web session id here even under the g2
  // gate: a `fake:` session's Driver conforms to W0's frozen protocol but
  // (per DriverProtocol.swift's own doc comment) FakeDriver only ever
  // produces platform `.web` — it is NOT a macos+appName session, so it
  // cannot satisfy startRecording/stopRecording's real-capture guard
  // (those stay error-taxonomy-only under V-A/external-mode regardless —
  // MACOS_SESSION_OPS is unaffected by this gate).
  return { web, macos: web, readonly }
}

export function withSessionOverride(operation: string, ctx: GeneratorContext, params: unknown): unknown {
  const override = MACOS_SESSION_OPS.has(operation)
    ? ctx.macosSessionId
    : READONLY_SESSION_OPS.has(operation)
      ? ctx.readonlySessionId
      : undefined
  if (override === undefined) return params
  if (params === null || typeof params !== 'object') return params
  const record = params as Record<string, unknown>
  if (!('sessionId' in record)) return params
  return { ...record, sessionId: override }
}

export async function buildFixtureContext(
  endpoint: DaemonEndpoint,
  scratchDir: string,
): Promise<GeneratorContext> {
  const { url: localWebFixtureUrl } = await startLocalWebFixtureServer()

  // D5: stage the committed input fixtures into the per-run scratch dir so the
  // payload hints (`${scratchDir}/fixture-recording.cast`,
  // `${scratchDir}/fixture-input.mp4`) resolve to real files.
  cpSync(FIXTURES_SRC_DIR, scratchDir, { recursive: true })

  let sessionIds = endpoint.sessionIds
  if (!sessionIds) {
    // Tier-2 option A (docs/plans/m3-external-daemon-seeding.md): an external
    // daemon that SELF-SEEDS a deterministic conformance session — e.g. the
    // Swift G1 daemon-core booted with SPECTRA_CONFORMANCE_SEED=1, which seeds a
    // fixed `conformance-seed` session but does NOT implement createSession (G1
    // is control-plane only, so Tier-1 wire seeding via createSession isn't
    // available). Point read-op routing at that known session id.
    const seedSession = process.env.SPECTRA_CONFORMANCE_SEED_SESSION
    if (seedSession) {
      sessionIds = { web: seedSession, macos: seedSession, readonly: seedSession }
    } else {
      // Tier-1 wire seeding for an external daemon that DOES implement
      // createSession (e.g. the TS daemon in external-mode.test.ts) — see
      // seedExternalSessions above.
      sessionIds = await seedExternalSessions(endpoint.socketPath, localWebFixtureUrl)
    }
  }

  return {
    webSessionId: sessionIds.web,
    macosSessionId: sessionIds.macos,
    readonlySessionId: sessionIds.readonly,
    elementId: FAKE_ELEMENT_ID,
    // M3.G2 Advisor ruling 2, Item 3: gate on the `milestoneG2` module const
    // (NOT `SPECTRA_CONFORMANCE_SEED` — a daemon-side env var not reliably
    // present in THIS suite process's own env). Default-mode invariance:
    // milestone unset -> byte-identical (`undefined`, as before this edit).
    recordingId: endpoint.recordingId ?? (milestoneG2 ? seedRecordingId() : undefined),
    scratchDir,
    localWebFixtureUrl,
  }
}
