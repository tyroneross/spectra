// tests/mcp/resources.test.ts
//
// Coreless MCP resources, tested against the mock daemon. The resources now
// forward to the daemon (listSessions / snapshot / analyze) instead of reading
// an in-process core, so the assertions check the forwarded shapes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerResources } from '../../src/mcp/resources.js'
import { DaemonClient } from '../../src/client/daemon-client.js'
import { startMockDaemon, type MockDaemon } from '../helpers/mock-daemon.js'

type InternalMcpServer = {
  _registeredResources: Record<string, {
    enabled: boolean
    readCallback: (uri: URL, extra: unknown) => unknown
  }>
  _registeredResourceTemplates: Record<string, {
    enabled: boolean
    resourceTemplate: ResourceTemplate
    readCallback: (uri: URL, vars: Record<string, string | string[]>, extra: unknown) => unknown
  }>
}

async function readResource(
  server: McpServer,
  uriStr: string,
): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string }> }> {
  const url = new URL(uriStr)
  const internals = server as unknown as InternalMcpServer
  const staticReg = internals._registeredResources[uriStr]
  if (staticReg?.enabled !== false && staticReg) {
    return (await staticReg.readCallback(url, {})) as { contents: Array<{ uri: string; mimeType?: string; text?: string }> }
  }
  for (const reg of Object.values(internals._registeredResourceTemplates)) {
    const variables = reg.resourceTemplate.uriTemplate.match(uriStr)
    if (variables !== null) {
      return (await reg.readCallback(url, variables, {})) as { contents: Array<{ uri: string; mimeType?: string; text?: string }> }
    }
  }
  throw new Error(`No resource matched URI: ${uriStr}`)
}

let daemon: MockDaemon
let server: McpServer

beforeEach(async () => {
  daemon = await startMockDaemon({
    handlers: {
      listSessions: () => ({
        ok: true,
        result: {
          sessions: [
            { id: 'abc123', name: 'localhost', platform: 'web', steps: 2, recordingState: 'idle', createdAt: '2026-06-27T00:00:00.000Z' },
            { id: 'def456', name: 'safari', platform: 'macos', steps: 0, recordingState: 'idle', createdAt: '2026-06-27T00:01:00.000Z' },
          ],
        },
      }),
      snapshot: (params) => {
        const id = (params as { sessionId?: string })?.sessionId
        if (id !== 'abc123') return { ok: false, status: 404, code: 'not_found', message: `Session "${id}" not found` }
        return { ok: true, result: { snapshot: '[e1] heading "Dashboard"\n[e2] button "Log In"  (http://localhost:3000)', elementCount: 2 } }
      },
      analyze: (params) => {
        const id = (params as { sessionId?: string })?.sessionId
        if (id !== 'abc123') return { ok: false, status: 404, code: 'not_found', message: `Session "${id}" not found` }
        return { ok: true, result: { state: 'populated', stateConfidence: 0.8126, regions: [], topElements: [], totalElements: 15, consoleErrors: [] } }
      },
    },
  })
  const client = new DaemonClient({ socketPath: daemon.socketPath, surface: 'test' })
  server = new McpServer({ name: 'spectra-test', version: '0.0.0' })
  registerResources(server, client)
})

afterEach(async () => { await daemon.close().catch(() => {}) })

describe('registerResources (coreless)', () => {
  describe('spectra://sessions', () => {
    it('forwards listSessions and returns the daemon session list', async () => {
      const result = await readResource(server, 'spectra://sessions')
      expect(result.contents[0].mimeType).toBe('application/json')
      const data = JSON.parse(result.contents[0].text!)
      expect(data.sessions).toHaveLength(2)
      expect(data.sessions[0]).toMatchObject({ id: 'abc123', name: 'localhost', platform: 'web' })
      expect(daemon.calls.some((c) => c.operation === 'listSessions')).toBe(true)
    })
  })

  describe('spectra://sessions/{sessionId}/snapshot', () => {
    it('returns the daemon AX-tree snapshot for a known session', async () => {
      const result = await readResource(server, 'spectra://sessions/abc123/snapshot')
      expect(result.contents[0].mimeType).toBe('text/plain')
      expect(result.contents[0].text).toContain('[e1] heading "Dashboard"')
      expect(result.contents[0].text).toContain('[e2] button "Log In"')
    })

    it('returns actionable error text for an unknown session', async () => {
      const result = await readResource(server, 'spectra://sessions/missing/snapshot')
      expect(result.contents[0].text).toContain('Error:')
      expect(result.contents[0].text).toContain('missing')
    })

    it('forwards a fresh snapshot call each read (live data)', async () => {
      await readResource(server, 'spectra://sessions/abc123/snapshot')
      await readResource(server, 'spectra://sessions/abc123/snapshot')
      expect(daemon.calls.filter((c) => c.operation === 'snapshot')).toHaveLength(2)
    })
  })

  describe('spectra://sessions/{sessionId}/state', () => {
    it('forwards analyze and reshapes to {state, confidence, totalElements}', async () => {
      const result = await readResource(server, 'spectra://sessions/abc123/state')
      const data = JSON.parse(result.contents[0].text!)
      expect(data.sessionId).toBe('abc123')
      expect(data.state).toBe('populated')
      expect(data.totalElements).toBe(15)
    })

    it('rounds confidence to 3 decimal places', async () => {
      const result = await readResource(server, 'spectra://sessions/abc123/state')
      const data = JSON.parse(result.contents[0].text!)
      expect(data.confidence).toBe(0.813)
      const decimals = data.confidence.toString().split('.')[1]
      expect((decimals ?? '').length).toBeLessThanOrEqual(3)
    })

    it('returns error JSON for an unknown session', async () => {
      const result = await readResource(server, 'spectra://sessions/ghost/state')
      const data = JSON.parse(result.contents[0].text!)
      expect(data.error).toContain('ghost')
    })
  })

  describe('resource registration', () => {
    it('registers exactly 1 static resource and 2 template resources', () => {
      const internals = server as unknown as InternalMcpServer
      expect(Object.keys(internals._registeredResources)).toHaveLength(1)
      expect(Object.keys(internals._registeredResourceTemplates)).toHaveLength(2)
    })
  })
})
