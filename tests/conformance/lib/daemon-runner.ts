// tests/conformance/lib/daemon-runner.ts
//
// M2B — subprocess entrypoint that boots the REAL TS daemon (real
// server.ts::startDaemonServer, real core-impl.ts business logic) with only
// the native-capture bottom layer faked (see ./fakes.ts). Run as a child
// process (see daemon-endpoint.ts) with HOME pointed at an isolated temp
// directory, so `~/.spectra/daemon.sock` (the frozen primary socket path,
// src/contract/wire.ts primarySocketPath) resolves under that temp dir and
// the real user's `~/.spectra` is never touched.
//
// Prints exactly one JSON line to stdout once listening:
//   {"ready":true,"socketPath":"...","sessionIds":{"web":"...","macos":"..."},"pid":...}
// Then waits for SIGTERM/SIGINT to shut down.
//
// Mutation-check support (M2B acceptance requirement — prove the oracle
// bites): set SPECTRA_CONFORMANCE_MUTATE_OP + SPECTRA_CONFORMANCE_MUTATE_KIND
// to have ConformanceCoreApi mutate one operation's response before it is
// serialized. Unset by default — the conformance suite never sets these.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { createContext } from '../../../src/mcp/context.js'
import { startDaemonServer } from '../../../src/daemon/server.js'
import type { Capability } from '../../../src/contract/wire.js'
import {
  ConformanceCoreApi,
  FakeDriver,
  FAKE_ELEMENT_ID,
  fakeRecordCompositeWorker,
  fakeSingleWindowRecordingRunner,
  fakeWindowListProvider,
} from './fakes.js'

async function main(): Promise<void> {
  const ctx = createContext()

  const webSession = await ctx.sessions.create({
    platform: 'web',
    target: { url: 'https://fake.local/conformance' },
    name: 'conformance-web-fixture',
  })
  ctx.drivers.set(webSession.id, new FakeDriver())

  const macosSession = await ctx.sessions.create({
    platform: 'macos',
    target: { appName: 'Fake Conformance App' },
    name: 'conformance-macos-fixture',
  })
  ctx.drivers.set(macosSession.id, new FakeDriver())

  // A DEDICATED read-only fixture session for getSession/getRun. Kept pristine
  // (no test ever routes a mutating op here) and pre-seeded below with two
  // CONFORMANT act steps, so getSession/getRun validate a KNOWN-GOOD nested
  // shape deterministically. This is the fix for the read-op contamination
  // uncovered by the D1 ordering fix: the shared `web` session's steps are
  // polluted by the malformed-payload (invalidPayloads) tests — the daemon does
  // not schema-validate params server-side (documented finding, see
  // conformance.test.ts), so a malformed `act` SUCCEEDS and records a step whose
  // `action` is missing `type`/`elementId`. Reading that back via getSession/
  // getRun would structurally fail against the declared Action type — a downstream
  // symptom of the known no-server-side-validation finding, NOT a getSession bug.
  // Isolating the read fixture removes the false red without masking anything:
  // the malformed-input error-taxonomy behavior is still asserted on `web`.
  const readonlySession = await ctx.sessions.create({
    platform: 'web',
    target: { url: 'https://fake.local/conformance-readonly' },
    name: 'conformance-web-readonly',
  })
  ctx.drivers.set(readonlySession.id, new FakeDriver())

  const mutateOperation = process.env.SPECTRA_CONFORMANCE_MUTATE_OP
  const mutateKind = process.env.SPECTRA_CONFORMANCE_MUTATE_KIND
  const mutateOp = mutateOperation && mutateKind
    ? {
        operation: mutateOperation,
        mutate: (result: unknown): unknown => {
          if (result === null || typeof result !== 'object') return result
          const clone = { ...(result as Record<string, unknown>) }
          if (mutateKind === 'drop-field') {
            // Drop the first own key we find — deliberately generic so the
            // same toggle works for any operation named via env var.
            const [firstKey] = Object.keys(clone)
            if (firstKey) delete clone[firstKey]
          } else if (mutateKind === 'rename-field') {
            const [firstKey] = Object.keys(clone)
            if (firstKey) {
              clone[`${firstKey}Renamed`] = clone[firstKey]
              delete clone[firstKey]
            }
          }
          return clone
        },
      }
    : undefined

  const api = new ConformanceCoreApi({
    context: ctx,
    windowListProvider: fakeWindowListProvider,
    singleWindowRecordingRunner: fakeSingleWindowRecordingRunner(),
    recordCompositeWorker: fakeRecordCompositeWorker,
    mutateOp,
  })

  // Seed the read-only session with two CONFORMANT steps (a bare click and a
  // click-with-value) via the real act code path, so getSession/getRun return a
  // populated, contract-valid SessionStep[]/CaptureRunAction[] to validate
  // against — not an empty array (which would exercise only the envelope, never
  // the nested action shape).
  await api.act({ sessionId: readonlySession.id, elementId: FAKE_ELEMENT_ID, action: 'click' })
  await api.act({ sessionId: readonlySession.id, elementId: FAKE_ELEMENT_ID, action: 'click', value: 'seed-value' })

  // Seed a live recording on a DEDICATED recording session (addressed only by
  // recordingId, never exposed as a fixture sessionId), so getRecording — which
  // runs alphabetically BEFORE startRecording and needs an EXISTING recording to
  // read (a stopped recording is not returned) — reaches its success path, while
  // the macos fixture session stays recording-FREE. The startRecording test
  // (routed to macos) then starts a fresh recording and SUCCEEDS instead of
  // hitting `conflict`; the stopRecording test (also routed to macos) stops that
  // fresh one. Keeping the seeded recording on its own session is what lets
  // getRecording (needs active) and startRecording (needs clean) BOTH succeed —
  // they'd contend on a single shared session. Left active; torn down on
  // shutdown (driver.disconnect in the shutdown handler below).
  const recordingSession = await ctx.sessions.create({
    platform: 'macos',
    target: { appName: 'Fake Conformance App' },
    name: 'conformance-macos-recording',
  })
  ctx.drivers.set(recordingSession.id, new FakeDriver())
  const seededRecording = await api.startRecording({ sessionId: recordingSession.id })

  // D4 capability probe support: when SPECTRA_CONFORMANCE_UNIX_CAPS is set (a
  // JSON array of Capability strings), the unix caller is granted ONLY those
  // capabilities instead of the default all-capabilities grant — letting the
  // conformance suite prove the daemon's default-deny gate
  // (security.ts assertOperationAllowed) actually denies an op whose required
  // capability is absent. Unset (the normal suite) → full grant, as before.
  const capsEnv = process.env.SPECTRA_CONFORMANCE_UNIX_CAPS
  const unixCapabilities = capsEnv ? (JSON.parse(capsEnv) as Capability[]) : undefined

  const running = await startDaemonServer({
    api,
    unix: unixCapabilities ? { enabled: true, capabilities: unixCapabilities } : { enabled: true },
  })

  process.stdout.write(
    `${JSON.stringify({
      ready: true,
      socketPath: running.socketPath,
      sessionIds: { web: webSession.id, macos: macosSession.id, readonly: readonlySession.id },
      recordingId: seededRecording.recordingId,
      pid: process.pid,
    })}\n`,
  )

  const shutdown = () => {
    // Full teardown of every driver ANY session picked up during the run —
    // not just the two fixture sessions above. The conformance suite's own
    // generic per-operation loop calls the REAL `createSession` operation
    // (to validate ITS contract shape too), which — for a web/macos/sim
    // target — instantiates a REAL CdpDriver/NativeDriver/SimDriver via
    // src/mcp/tools/connect.ts (no override seam is wired through
    // core-impl.ts's own createSession, unlike the fixture sessions seeded
    // above). On a machine with real Chrome + the native swift bridge
    // installed (as this dev machine has), that live call genuinely spawns a
    // Chrome/native-bridge child process. Neither `closeSession` nor
    // `closeAllSessions` call `driver.disconnect()` (only `driver.close()` —
    // "keep underlying infrastructure alive" per the Driver interface
    // doc-comment in src/core/types.ts) — a pre-existing daemon behavior, out
    // of scope to change here. `disconnect()` is the ONLY call that performs
    // "full teardown — closes underlying connections/processes"; calling it
    // directly on every driver in `ctx.drivers` before exit is what prevents
    // this harness from orphaning a real Chrome process on the host.
    Promise.all([...ctx.drivers.values()].map((driver) => driver.disconnect().catch(() => {})))
      .catch(() => {})
      .then(() => running.close())
      .finally(() => process.exit(0))
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

main().catch((error) => {
  process.stderr.write(`daemon-runner failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
