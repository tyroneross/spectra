// tests/mcp/http.test.ts
//
// Exercises the HTTP transport mount: version/health endpoints (no auth) +
// /mcp endpoint auth gating. The MCP transport itself is exercised via SDK
// integration tests upstream; here we verify the wiring layer.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHttpServer, type RunningHttpServer } from '../../src/mcp/http.js'

let tmp: string
let running: RunningHttpServer

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init)
  const text = await res.text()
  let body: unknown = text
  try { body = JSON.parse(text) } catch { /* leave as text */ }
  return { status: res.status, body }
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'spectra-http-test-'))
  // Random ephemeral port via port=0 — node:http picks an unused port
  running = await startHttpServer({ port: 0, overrideHome: tmp })
})

afterEach(async () => {
  await running.close().catch(() => {})
  rmSync(tmp, { recursive: true, force: true })
})

describe('HTTP daemon — non-auth endpoints', () => {
  it('GET /api/version returns apiVersion + daemonVersion without auth', async () => {
    const r = await fetchJson(`http://127.0.0.1:${running.port}/api/version`)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      apiVersion: expect.any(Number),
      daemonVersion: expect.any(String),
    })
  })

  it('GET /api/health returns ok + pid without auth', async () => {
    const r = await fetchJson(`http://127.0.0.1:${running.port}/api/health`)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, pid: expect.any(Number) })
  })

  it('unknown path returns 404', async () => {
    const r = await fetchJson(`http://127.0.0.1:${running.port}/nope`)
    expect(r.status).toBe(404)
  })
})

describe('HTTP daemon — /mcp auth gate', () => {
  it('POST /mcp without auth → 401', async () => {
    const r = await fetchJson(`http://127.0.0.1:${running.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(r.status).toBe(401)
  })

  it('POST /mcp with bad token → 401', async () => {
    const r = await fetchJson(`http://127.0.0.1:${running.port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${'x'.repeat(running.token.length)}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(r.status).toBe(401)
  })

  it('POST /mcp with valid token → not 401 (handled by transport)', async () => {
    // The MCP transport rejects malformed/unknown methods with its own status.
    // The contract we test here is "auth gate doesn't fire" — i.e. status !== 401.
    const r = await fetchJson(`http://127.0.0.1:${running.port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${running.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          clientInfo: { name: 'test', version: '0.0.0' },
          capabilities: {},
        },
      }),
    })
    expect(r.status).not.toBe(401)
    // initialize is a valid JSON-RPC request → transport should answer 200
    expect(r.status).toBeLessThan(500)
  })
})
