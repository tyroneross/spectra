// tests/conformance/lib/socket-client.ts
//
// M2B — daemon-agnostic wire transport for the conformance suite. Deliberately
// bypasses src/client/daemon-client.ts: that client validates params CLIENT
// SIDE (schema.safeParse before ever touching the socket — see
// prepareParams()/validateParams in daemon-client.ts), which would mask
// whatever the DAEMON itself does (or doesn't) do with malformed input. The
// oracle needs to observe the real wire behavior, so this speaks the raw
// envelope directly over `socketRequest` (src/client/transport.ts — the same
// unix-socket-over-HTTP primitive the real client uses, reused read-only).
//
// This is what makes the harness daemon-agnostic: it is parameterized ONLY by
// a socket path and an operation name+params. A Swift daemon listening on the
// same `POST /api/v1/<operation>` route over the same 0600 unix socket is
// indistinguishable to this client from the TS daemon.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { randomUUID } from 'node:crypto'
import { socketRequest } from '../../../src/client/transport.js'
import { API_VERSION, type ApiRequestEnvelope, type CoreApiOperation } from '../../../src/contract/wire.js'

export interface WireCallOptions {
  socketPath: string
  operation: string
  params?: unknown
  /** Override apiVersion — used only by the (rare) unsupported_api_version boundary test. */
  apiVersionOverride?: number
  /** Omit requestId entirely — used only by the bad_request-envelope boundary test. */
  omitRequestId?: boolean
  timeoutMs?: number
}

export interface WireCallResult {
  status: number
  requestId: string
  body: unknown
}

/** Sends ONE raw request over the real unix socket and returns the parsed
 * envelope + HTTP status, with no client-side schema validation applied. */
export async function callOperation(opts: WireCallOptions): Promise<WireCallResult> {
  const requestId = randomUUID()
  const envelope: Partial<ApiRequestEnvelope> = {
    apiVersion: (opts.apiVersionOverride ?? API_VERSION) as ApiRequestEnvelope['apiVersion'],
    operation: opts.operation as CoreApiOperation,
    params: opts.params as ApiRequestEnvelope['params'],
  }
  if (!opts.omitRequestId) envelope.requestId = requestId

  const res = await socketRequest({
    socketPath: opts.socketPath,
    path: `/api/v1/${opts.operation}`,
    method: 'POST',
    body: JSON.stringify(envelope),
    timeoutMs: opts.timeoutMs ?? 30_000,
  })

  return { status: res.status, requestId, body: res.body }
}
