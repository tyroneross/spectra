import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AccessibilityDomain, type CdpAXNode } from '../../src/cdp/accessibility.js'
import type { CdpConnection } from '../../src/cdp/connection.js'

function mockConnection(): CdpConnection {
  return {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    connected: true,
  } as unknown as CdpConnection
}

// Minimal CDP AX tree representing a login page
function loginPageNodes(): CdpAXNode[] {
  return [
    { nodeId: '1', role: { value: 'WebArea' }, name: { value: 'Login' }, childIds: ['2', '3', '4', '5'], backendDOMNodeId: 1 },
    { nodeId: '2', role: { value: 'heading' }, name: { value: 'Welcome Back' }, childIds: [], backendDOMNodeId: 2 },
    { nodeId: '3', role: { value: 'textbox' }, name: { value: 'Email address' }, value: { value: '' }, properties: [{ name: 'focused', value: { value: true } }], childIds: [], backendDOMNodeId: 3 },
    { nodeId: '4', role: { value: 'textbox' }, name: { value: 'Password' }, childIds: [], backendDOMNodeId: 4 },
    { nodeId: '5', role: { value: 'button' }, name: { value: 'Log In' }, properties: [{ name: 'disabled', value: { value: false } }], childIds: [], backendDOMNodeId: 5 },
    { nodeId: '6', role: { value: 'link' }, name: { value: 'Forgot password?' }, childIds: [], backendDOMNodeId: 6 },
    { nodeId: '7', role: { value: 'generic' }, childIds: [], backendDOMNodeId: 7 },  // unlabeled container — should be filtered
  ]
}

describe('AccessibilityDomain', () => {
  let conn: CdpConnection
  let ax: AccessibilityDomain

  beforeEach(() => {
    conn = mockConnection()
    ax = new AccessibilityDomain(conn, 'session-1')
  })

  describe('getSnapshot', () => {
    it('converts CDP AX tree to Element array', async () => {
      vi.mocked(conn.send).mockResolvedValueOnce({ nodes: loginPageNodes() })

      const elements = await ax.getSnapshot()

      // Should filter out WebArea and unlabeled generic
      expect(elements).toHaveLength(5)

      expect(elements[0]).toMatchObject({ id: 'e1', role: 'heading', label: 'Welcome Back' })
      expect(elements[1]).toMatchObject({ id: 'e2', role: 'textfield', label: 'Email address', focused: true })
      expect(elements[2]).toMatchObject({ id: 'e3', role: 'textfield', label: 'Password', focused: false })
      expect(elements[3]).toMatchObject({ id: 'e4', role: 'button', label: 'Log In', enabled: true })
      expect(elements[4]).toMatchObject({ id: 'e5', role: 'link', label: 'Forgot password?' })
    })

    it('calls Accessibility.getFullAXTree with correct sessionId', async () => {
      vi.mocked(conn.send).mockResolvedValueOnce({ nodes: [] })

      await ax.getSnapshot()

      expect(conn.send).toHaveBeenCalledWith(
        'Accessibility.getFullAXTree',
        {},
        'session-1',
      )
    })

    it('infers actions from role', async () => {
      vi.mocked(conn.send).mockResolvedValueOnce({ nodes: loginPageNodes() })

      const elements = await ax.getSnapshot()

      expect(elements.find(e => e.role === 'button')!.actions).toEqual(['press'])
      expect(elements.find(e => e.role === 'textfield')!.actions).toEqual(['setValue'])
      expect(elements.find(e => e.role === 'link')!.actions).toEqual(['press'])
      expect(elements.find(e => e.role === 'heading')!.actions).toEqual([])
    })

    it('maps backendDOMNodeId for click targeting', async () => {
      vi.mocked(conn.send).mockResolvedValueOnce({ nodes: loginPageNodes() })

      await ax.getSnapshot()

      // Button "Log In" has backendDOMNodeId 5
      expect(ax.getBackendNodeId('e4')).toBe(5)
    })

    it('handles disabled elements', async () => {
      const nodes: CdpAXNode[] = [
        { nodeId: '1', role: { value: 'button' }, name: { value: 'Submit' },
          properties: [{ name: 'disabled', value: { value: true } }],
          childIds: [], backendDOMNodeId: 10 },
      ]
      vi.mocked(conn.send).mockResolvedValueOnce({ nodes })

      const elements = await ax.getSnapshot()
      expect(elements[0].enabled).toBe(false)
    })

    it('handles empty tree', async () => {
      vi.mocked(conn.send).mockResolvedValueOnce({ nodes: [] })

      const elements = await ax.getSnapshot()
      expect(elements).toEqual([])
    })
  })
})
