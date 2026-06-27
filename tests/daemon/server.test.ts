import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CoreApi, HealthResult, ListWindowsResult } from '../../src/contract/core-api.js'
import { API_VERSION, type ApiResponseEnvelope, type Capability } from '../../src/contract/wire.js'
import type { DaemonRequestHandler } from '../../src/daemon/server.js'

let tmp: string
let createDaemonRequestHandler: typeof import('../../src/daemon/server.js').createDaemonRequestHandler

beforeEach(async () => {
  vi.resetModules()
  vi.doUnmock('node:fs')
  vi.doUnmock('node:fs/promises')
  vi.doUnmock('../../src/core/storage.js')
  ;({ createDaemonRequestHandler } = await import('../../src/daemon/server.js'))
  tmp = mkdtempSync(join('/private/tmp', 'spectra-daemon-test-'))
})

afterEach(async () => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('daemon Unix socket dispatch', () => {
  it('dispatches enveloped ops for a verified Unix peer', async () => {
    const socketPath = join(tmp, 'daemon.sock')
    const api = fakeApi()
    const handler = createDaemonRequestHandler({
      api,
      transport: 'unix',
      socketPath,
      unix: {
        surface: 'test',
        capabilities: ['daemon:read'],
        peerCredentials: () => ({ uid: 501, gid: 20, pid: 1234 }),
        enforceSocketMode: false,
      },
    })

    const res = await post(handler, '/api/v1/health', {}, {
      apiVersion: API_VERSION,
      requestId: 'req-health',
      operation: 'health',
      params: {},
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      apiVersion: API_VERSION,
      requestId: 'req-health',
      ok: true,
      result: { ok: true, apiVersion: API_VERSION },
      caller: {
        verifiedBy: 'unix-peer',
        capabilities: ['daemon:read'],
        uid: 501,
      },
      deliveryPath: 'test',
    })
    expect(api.health).toHaveBeenCalledOnce()
  })

  it('default-denies operations when verified caller lacks operationCapabilities', async () => {
    const socketPath = join(tmp, 'daemon.sock')
    const api = fakeApi()
    const handler = createDaemonRequestHandler({
      api,
      transport: 'unix',
      socketPath,
      unix: {
        surface: 'test',
        capabilities: ['daemon:read'],
        peerCredentials: () => ({ uid: 501 }),
        enforceSocketMode: false,
      },
    })

    const res = await post(handler, '/api/v1/listWindows', {}, {
      apiVersion: API_VERSION,
      requestId: 'req-windows',
      operation: 'listWindows',
      params: {},
    })

    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({
      ok: false,
      requestId: 'req-windows',
      error: {
        code: 'capability_denied',
      },
    })
    expect(api.listWindows).not.toHaveBeenCalled()
  })
})

describe('daemon loopback TCP security', () => {
  it('requires bearer token on every TCP request and stores the token file as mode 0600', async () => {
    const tokenPath = join(tmp, 'daemon.token')
    const token = 'a'.repeat(43)
    const handler = tcpHandler({
      token,
      tokenPath,
      allowedOrigins: ['http://127.0.0.1'],
      capabilities: ['daemon:read'],
    })

    const res = await post(handler, '/api/v1/health', {
      origin: 'http://127.0.0.1',
      host: '127.0.0.1:47823',
      token: undefined,
    }, {
      apiVersion: API_VERSION,
      requestId: 'req-no-token',
      operation: 'health',
      params: {},
    })

    expect(res.status).toBe(401)
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600)
    expect(res.body).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    })
  })

  it('rejects non-loopback Host before dispatch', async () => {
    const tokenPath = join(tmp, 'daemon.token')
    const token = 'b'.repeat(43)
    const api = fakeApi()
    const handler = tcpHandler({
      api,
      token,
      tokenPath,
      allowedOrigins: ['http://127.0.0.1'],
      capabilities: ['daemon:read'],
    })

    const res = await post(handler, '/api/v1/health', {
      origin: 'http://127.0.0.1',
      host: 'spectra.example.com',
      token,
    }, {
      apiVersion: API_VERSION,
      requestId: 'req-host',
      operation: 'health',
      params: {},
    })

    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
    expect(api.health).not.toHaveBeenCalled()
  })

  it('rejects disallowed Origin before dispatch', async () => {
    const tokenPath = join(tmp, 'daemon.token')
    const token = 'c'.repeat(43)
    const api = fakeApi()
    const handler = tcpHandler({
      api,
      token,
      tokenPath,
      allowedOrigins: ['http://127.0.0.1'],
      capabilities: ['daemon:read'],
    })

    const res = await post(handler, '/api/v1/health', {
      origin: 'http://evil.localhost',
      host: '127.0.0.1:47823',
      token,
    }, {
      apiVersion: API_VERSION,
      requestId: 'req-origin',
      operation: 'health',
      params: {},
    })

    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
    expect(api.health).not.toHaveBeenCalled()
  })

  it('accepts valid loopback Host, allowed Origin, bearer token, and capability', async () => {
    const tokenPath = join(tmp, 'daemon.token')
    const token = 'd'.repeat(43)
    const api = fakeApi()
    const handler = tcpHandler({
      api,
      token,
      tokenPath,
      allowedOrigins: ['http://127.0.0.1'],
      capabilities: ['daemon:read'],
    })

    const res = await post(handler, '/api/v1/health', {
      origin: 'http://127.0.0.1',
      host: '127.0.0.1:47823',
      token,
    }, {
      apiVersion: API_VERSION,
      requestId: 'req-ok',
      operation: 'health',
      params: {},
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      ok: true,
      caller: {
        verifiedBy: 'bearer-token',
        capabilities: ['daemon:read'],
      },
      deliveryPath: 'http-mcp',
    })
    expect(api.health).toHaveBeenCalledOnce()
  })
})

function fakeApi(): CoreApi {
  const healthResult: HealthResult = {
    ok: true,
    apiVersion: API_VERSION,
    daemonVersion: 'test',
    pid: 123,
    uptimeSec: 1,
    startedAt: 1,
    aquaSession: true,
    windowServer: { connected: true },
  }
  const listWindowsResult: ListWindowsResult = { windows: [] }
  return {
    health: vi.fn(async () => healthResult),
    listWindows: vi.fn(async () => listWindowsResult),
  } as unknown as CoreApi
}

function tcpHandler(options: {
  api?: CoreApi
  token: string
  tokenPath: string
  allowedOrigins: string[]
  capabilities: Capability[]
}): DaemonRequestHandler {
  return createDaemonRequestHandler({
    api: options.api ?? fakeApi(),
    transport: 'tcp',
    socketPath: join(tmp, 'daemon.sock'),
    unix: {
      surface: 'test',
      capabilities: options.capabilities,
      peerCredentials: () => ({ uid: 501 }),
      enforceSocketMode: false,
    },
    tcp: {
      enabled: true,
      host: '127.0.0.1',
      allowedOrigins: options.allowedOrigins,
      tokenPath: options.tokenPath,
      token: options.token,
      capabilities: options.capabilities,
      surface: 'http-mcp',
    },
  })
}

async function post(
  handler: DaemonRequestHandler,
  path: string,
  security: Partial<{ origin: string; host: string; token: string }>,
  body: unknown,
): Promise<{ status: number; body: ApiResponseEnvelope }> {
  const json = JSON.stringify(body)
  const req = Readable.from([json]) as IncomingMessage
  req.method = 'POST'
  req.url = path
  req.headers = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(json)),
    ...(security.host ? { host: security.host } : {}),
    ...(security.origin ? { origin: security.origin } : {}),
    ...(security.token ? { authorization: `Bearer ${security.token}` } : {}),
  }
  Object.defineProperty(req, 'socket', {
    value: { remoteAddress: '127.0.0.1' },
  })

  const res = mockResponse()
  await handler(req, res.response)
  return {
    status: res.status,
    body: JSON.parse(res.body) as ApiResponseEnvelope,
  }
}

function mockResponse(): {
  response: ServerResponse
  status: number
  body: string
} {
  const state = {
    status: 0,
    body: '',
    response: {
      headersSent: false,
      writeHead(status: number) {
        state.status = status
        state.response.headersSent = true
        return state.response
      },
      write(chunk: string | Buffer) {
        state.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
        return true
      },
      end(chunk?: string | Buffer) {
        if (chunk) state.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
        state.response.headersSent = true
        return state.response
      },
      on() {
        return state.response
      },
    } as unknown as ServerResponse,
  }
  return state
}
