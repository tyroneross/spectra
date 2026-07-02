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
import type { DaemonEndpoint } from './daemon-endpoint.js'
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
    // External daemon (SPECTRA_DAEMON_SOCKET) with no pre-seeded fixture
    // session — obtain one live via the real createSession operation. Best
    // effort: the external (future Swift) daemon has no in-process seam to
    // seed a pristine read-only session, so readonly falls back to the same
    // live session (external-daemon parity runs are corpus-diff driven, not
    // gated on the read-op nested-shape isolation the in-process fixture adds).
    const created = await callOperation({
      socketPath: endpoint.socketPath,
      operation: 'createSession',
      params: { target: localWebFixtureUrl },
    })
    const body = created.body as { result?: { sessionId?: string } }
    const id = body.result?.sessionId ?? 'unavailable'
    sessionIds = { web: id, macos: id, readonly: id }
  }

  return {
    webSessionId: sessionIds.web,
    macosSessionId: sessionIds.macos,
    readonlySessionId: sessionIds.readonly,
    elementId: FAKE_ELEMENT_ID,
    recordingId: endpoint.recordingId,
    scratchDir,
    localWebFixtureUrl,
  }
}
