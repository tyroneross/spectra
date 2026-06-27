// tests/helpers/mock-daemon.ts
//
// Mock daemon — a test double that honors the FROZEN wire contract over a unix
// socket. It validates the request envelope and per-operation param schema
// exactly as the real BE daemon (src/daemon/server.ts) does, then returns a
// canned ApiSuccessEnvelope (or a configured ApiErrorEnvelope). Because the
// forwarder unit tests drive every call through this socket, the daemon wire
// path is exercised on every `npm test` — the anti-dormancy guarantee from the
// aligned plan §3.4 (the daemon path never ships dormant).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { API_VERSION, operationCapabilities } from '../../src/contract/wire.js'
import {
  apiRequestEnvelopeSchema,
  operationParamSchemas,
} from '../../src/contract/schemas.js'

const OPERATIONS = new Set(Object.keys(operationCapabilities))

export interface RecordedCall {
  operation: string
  params: unknown
  requestId: string
}

export interface MockResult {
  status?: number
  ok: true
  result: unknown
}
export interface MockErrorResult {
  status?: number
  ok: false
  code: string
  message: string
  hint?: string
}
export type MockHandlerResult = MockResult | MockErrorResult

export interface MockDaemonOptions {
  /** Per-operation result override. Return a success or error envelope body. */
  handlers?: Partial<Record<string, (params: unknown) => MockHandlerResult>>
  /** Bind to an explicit socket path (default: a fresh temp socket). */
  socketPath?: string
}

export interface MockDaemon {
  socketPath: string
  calls: RecordedCall[]
  server: Server
  close: () => Promise<void>
}

function defaultResult(operation: string, params: unknown): MockHandlerResult {
  switch (operation) {
    case 'health':
      return { ok: true, result: { ok: true, apiVersion: API_VERSION, daemonVersion: 'mock', pid: process.pid, uptimeSec: 0, aquaSession: true, windowServer: { connected: true } } }
    case 'listSessions':
      return { ok: true, result: { sessions: [] } }
    case 'createSession':
      return { ok: true, result: { sessionId: 'mock-session-1', platform: 'web', elementCount: 0, snapshot: '(mock snapshot)' } }
    case 'snapshot':
      return { ok: true, result: { snapshot: '(mock snapshot)', elementCount: 0 } }
    case 'analyze':
      return { ok: true, result: { state: 'ready', stateConfidence: 1, regions: [], topElements: [], totalElements: 0, consoleErrors: [] } }
    case 'closeAllSessions':
    case 'closeSession':
      return { ok: true, result: { success: true } }
    default:
      // Echo so round-trip tests can assert the params reached the daemon intact.
      return { ok: true, result: { operation, echo: params ?? null } }
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) })
  res.end(json)
}

function errorEnvelope(requestId: string | undefined, code: string, message: string, hint?: string): unknown {
  return { apiVersion: API_VERSION, requestId, ok: false, error: { code, message, hint }, timestamp: Date.now(), deliveryPath: 'test' }
}

export async function startMockDaemon(opts: MockDaemonOptions = {}): Promise<MockDaemon> {
  const dir = opts.socketPath ? null : mkdtempSync(join(tmpdir(), 'spectra-mock-daemon-'))
  const socketPath = opts.socketPath ?? join(dir as string, 'daemon.sock')
  const calls: RecordedCall[] = []

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://spectra.local')
    const match = /^\/api\/v1\/([^/]+)$/.exec(url.pathname)
    if (!match) { send(res, 404, errorEnvelope(undefined, 'not_found', `Unknown route ${url.pathname}`)); return }
    const routeOp = match[1]
    if (!OPERATIONS.has(routeOp)) { send(res, 404, errorEnvelope(undefined, 'not_found', `Unknown operation ${routeOp}`)); return }
    if ((req.method ?? 'GET') !== 'POST') { send(res, 405, errorEnvelope(undefined, 'bad_request', 'Operations require POST')); return }

    const raw = await readBody(req)
    let parsed: unknown
    try { parsed = raw.length === 0 ? {} : JSON.parse(raw) } catch { send(res, 400, errorEnvelope(undefined, 'bad_request', 'Malformed JSON')); return }

    // Validate the envelope against the FROZEN schema.
    const env = apiRequestEnvelopeSchema.safeParse(parsed)
    if (!env.success) {
      const obj = parsed as { requestId?: string; apiVersion?: unknown }
      const code = obj?.apiVersion !== API_VERSION ? 'unsupported_api_version' : 'bad_request'
      send(res, 400, errorEnvelope(obj?.requestId, code, `Invalid request envelope: ${env.error.issues.map((i) => i.message).join('; ')}`))
      return
    }
    const envelope = env.data
    if (envelope.operation !== routeOp) {
      send(res, 400, errorEnvelope(envelope.requestId, 'bad_request', `Route op ${routeOp} != envelope op ${envelope.operation}`))
      return
    }

    // Validate params against the frozen per-operation schema.
    const paramSchema = operationParamSchemas[routeOp as keyof typeof operationParamSchemas]
    const paramCheck = paramSchema.safeParse(envelope.params ?? undefined)
    if (!paramCheck.success) {
      send(res, 400, errorEnvelope(envelope.requestId, 'bad_request', `Invalid params: ${paramCheck.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`))
      return
    }

    calls.push({ operation: routeOp, params: envelope.params, requestId: envelope.requestId })

    const handler = opts.handlers?.[routeOp]
    const outcome = handler ? handler(envelope.params) : defaultResult(routeOp, envelope.params)
    const status = outcome.status ?? (outcome.ok ? 200 : 400)
    if (outcome.ok) {
      send(res, status, { apiVersion: API_VERSION, requestId: envelope.requestId, ok: true, result: outcome.result, timestamp: Date.now(), deliveryPath: 'test' })
    } else {
      send(res, status, errorEnvelope(envelope.requestId, outcome.code, outcome.message, outcome.hint))
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => { server.off('error', reject); resolve() })
  })

  return {
    socketPath,
    calls,
    server,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      if (dir) rmSync(dir, { recursive: true, force: true })
    },
  }
}
