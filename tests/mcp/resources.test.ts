import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerResources } from '../../src/mcp/resources.js'
import type { ToolContext } from '../../src/mcp/context.js'
import type { SessionManager } from '../../src/core/session.js'
import type { Driver, Snapshot } from '../../src/core/types.js'

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/core/storage.js', () => ({
  getStoragePath: vi.fn().mockReturnValue('/tmp/spectra'),
}))

// ── Fixtures ────────────────────────────────────────────────────────────────

const mockSnapshot: Snapshot = {
  url: 'http://localhost:3000',
  platform: 'web',
  elements: [
    {
      id: 'e1',
      role: 'heading',
      label: 'Dashboard',
      value: null,
      enabled: true,
      focused: false,
      actions: [],
      bounds: [0, 0, 300, 40],
      parent: null,
    },
    {
      id: 'e2',
      role: 'button',
      label: 'Log In',
      value: null,
      enabled: true,
      focused: false,
      actions: ['press'],
      bounds: [10, 60, 120, 36],
      parent: null,
    },
  ],
  timestamp: 1700000000000,
}

function mockDriver(): Driver {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue(mockSnapshot),
    act: vi.fn().mockResolvedValue({ success: true, snapshot: mockSnapshot }),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('PNG')),
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  }
}

const mockSessionsList = [
  {
    id: 'abc123',
    name: 'localhost',
    platform: 'web' as const,
    target: { url: 'http://localhost:3000' },
    steps: [{ index: 0 }, { index: 1 }],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'def456',
    name: 'safari',
    platform: 'macos' as const,
    target: { appName: 'Safari' },
    steps: [],
    createdAt: 1700000001000,
    updatedAt: 1700000001000,
  },
]

function mockContext(): ToolContext {
  return {
    sessions: {
      create: vi.fn(),
      addStep: vi.fn(),
      get: vi.fn(),
      list: vi.fn().mockReturnValue(mockSessionsList),
      close: vi.fn(),
      closeAll: vi.fn(),
    } as unknown as SessionManager,
    drivers: new Map(),
  }
}

// ── Internal shape of McpServer private fields ───────────────────────────────

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

// ── Helper: invoke a registered resource by URI ──────────────────────────────

/**
 * Directly invokes the registered resource callback matching the given URI.
 * Replicates the SDK's own dispatch logic (static lookup then template match)
 * so tests run without a live transport/client round-trip.
 */
async function readResource(
  server: McpServer,
  uriStr: string,
): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string }> }> {
  const url = new URL(uriStr)
  const internals = server as unknown as InternalMcpServer

  // Try static resources (keyed by URI string)
  const staticReg = internals._registeredResources[uriStr]
  if (staticReg?.enabled !== false && staticReg) {
    return (await staticReg.readCallback(url, {})) as { contents: Array<{ uri: string; mimeType?: string; text?: string }> }
  }

  // Try template resources (keyed by name; SDK uses uriTemplate.match())
  for (const reg of Object.values(internals._registeredResourceTemplates)) {
    const variables = reg.resourceTemplate.uriTemplate.match(uriStr)
    if (variables !== null) {
      return (await reg.readCallback(url, variables, {})) as { contents: Array<{ uri: string; mimeType?: string; text?: string }> }
    }
  }

  throw new Error(`No resource matched URI: ${uriStr}`)
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('registerResources', () => {
  let server: McpServer
  let ctx: ToolContext

  beforeEach(() => {
    server = new McpServer({ name: 'spectra-test', version: '0.0.0' })
    ctx = mockContext()
    registerResources(server, ctx)
  })

  // ── spectra://sessions ─────────────────────────────────────────────────────

  describe('spectra://sessions', () => {
    it('lists all sessions with correct fields', async () => {
      const result = await readResource(server, 'spectra://sessions')
      expect(result.contents).toHaveLength(1)

      const content = result.contents[0]
      expect(content.uri).toBe('spectra://sessions')
      expect(content.mimeType).toBe('application/json')

      const data = JSON.parse(content.text!)
      expect(data.sessions).toHaveLength(2)

      const [first, second] = data.sessions
      expect(first).toMatchObject({ id: 'abc123', name: 'localhost', platform: 'web', steps: 2 })
      expect(first.createdAt).toMatch(/^\d{4}-/)  // ISO string
      expect(second).toMatchObject({ id: 'def456', name: 'safari', platform: 'macos', steps: 0 })
    })

    it('returns empty sessions array when no sessions exist', async () => {
      vi.mocked(ctx.sessions.list).mockReturnValue([])
      const result = await readResource(server, 'spectra://sessions')
      const data = JSON.parse(result.contents[0].text!)
      expect(data.sessions).toHaveLength(0)
    })
  })

  // ── spectra://sessions/{sessionId}/snapshot ────────────────────────────────

  describe('spectra://sessions/{sessionId}/snapshot', () => {
    it('returns serialized AX tree for a known session', async () => {
      const driver = mockDriver()
      ctx.drivers.set('abc123', driver)

      const result = await readResource(server, 'spectra://sessions/abc123/snapshot')
      expect(result.contents).toHaveLength(1)

      const content = result.contents[0]
      expect(content.mimeType).toBe('text/plain')
      expect(content.text).toContain('[e1] heading "Dashboard"')
      expect(content.text).toContain('[e2] button "Log In"')
      expect(content.text).toContain('http://localhost:3000')
    })

    it('returns error text for unknown session', async () => {
      const result = await readResource(server, 'spectra://sessions/missing/snapshot')
      const content = result.contents[0]
      expect(content.text).toContain('missing')
      expect(content.text).toContain('not found')
    })

    it('calls driver.snapshot() each time (live data, not cached)', async () => {
      const driver = mockDriver()
      ctx.drivers.set('abc123', driver)

      await readResource(server, 'spectra://sessions/abc123/snapshot')
      await readResource(server, 'spectra://sessions/abc123/snapshot')

      expect(driver.snapshot).toHaveBeenCalledTimes(2)
    })
  })

  // ── spectra://sessions/{sessionId}/state ──────────────────────────────────

  describe('spectra://sessions/{sessionId}/state', () => {
    it('returns state detection result for a known session', async () => {
      const driver = mockDriver()
      ctx.drivers.set('abc123', driver)

      const result = await readResource(server, 'spectra://sessions/abc123/state')
      expect(result.contents).toHaveLength(1)

      const content = result.contents[0]
      expect(content.mimeType).toBe('application/json')

      const data = JSON.parse(content.text!)
      expect(data.sessionId).toBe('abc123')
      expect(data).toHaveProperty('state')
      expect(data).toHaveProperty('confidence')
      expect(data).toHaveProperty('indicators')
      expect(data.elementCount).toBe(2)
      expect(data.timestamp).toBe(1700000000000)
    })

    it('returns error JSON for unknown session', async () => {
      const result = await readResource(server, 'spectra://sessions/ghost/state')
      const content = result.contents[0]
      expect(content.mimeType).toBe('application/json')
      const data = JSON.parse(content.text!)
      expect(data.error).toContain('ghost')
    })

    it('detects populated state for snapshot with rich elements', async () => {
      const driver = mockDriver()
      const richSnapshot: Snapshot = {
        ...mockSnapshot,
        elements: Array.from({ length: 15 }, (_, i) => ({
          id: `e${i + 1}`,
          role: i % 3 === 0 ? 'button' : i % 3 === 1 ? 'heading' : 'text',
          label: `Element ${i + 1}`,
          value: null,
          enabled: true,
          focused: false,
          actions: i % 3 === 0 ? ['press'] : [],
          bounds: [0, i * 30, 200, 28],
          parent: null,
        })),
      }
      vi.mocked(driver.snapshot).mockResolvedValue(richSnapshot)
      ctx.drivers.set('abc123', driver)

      const result = await readResource(server, 'spectra://sessions/abc123/state')
      const data = JSON.parse(result.contents[0].text!)
      expect(data.state).toBe('populated')
      expect(data.confidence).toBeGreaterThan(0)
    })

    it('confidence is rounded to 3 decimal places', async () => {
      const driver = mockDriver()
      ctx.drivers.set('abc123', driver)

      const result = await readResource(server, 'spectra://sessions/abc123/state')
      const data = JSON.parse(result.contents[0].text!)
      const decimals = data.confidence.toString().split('.')[1]
      expect((decimals ?? '').length).toBeLessThanOrEqual(3)
    })
  })

  // ── Registration completeness ──────────────────────────────────────────────

  describe('resource registration', () => {
    it('registers exactly 1 static resource and 2 template resources', () => {
      const internals = server as unknown as InternalMcpServer
      expect(Object.keys(internals._registeredResources)).toHaveLength(1)
      expect(Object.keys(internals._registeredResourceTemplates)).toHaveLength(2)
    })
  })
})
