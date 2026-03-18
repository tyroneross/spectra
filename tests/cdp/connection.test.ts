import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MockWebSocket } from '../helpers/mock-websocket.js'

// Stub WebSocket global before importing connection module
vi.stubGlobal('WebSocket', MockWebSocket)

import { CdpConnection } from '../../src/cdp/connection.js'

describe('CdpConnection', () => {
  let conn: CdpConnection

  beforeEach(() => {
    MockWebSocket.reset()
    conn = new CdpConnection()
  })

  afterEach(async () => {
    await conn.close()
  })

  describe('connect', () => {
    it('resolves when WebSocket opens', async () => {
      const promise = conn.connect('ws://localhost:9222/devtools/browser/abc')
      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()
      await expect(promise).resolves.toBeUndefined()
      expect(conn.connected).toBe(true)
    })

    it('rejects when WebSocket errors', async () => {
      const promise = conn.connect('ws://localhost:9222/devtools/browser/abc')
      const ws = MockWebSocket.instances[0]
      ws.simulateError()
      await expect(promise).rejects.toThrow('WebSocket connection failed')
    })
  })

  describe('send', () => {
    it('sends JSON-RPC message and resolves with result', async () => {
      const connectPromise = conn.connect('ws://localhost:9222/devtools/browser/abc')
      MockWebSocket.instances[0].simulateOpen()
      await connectPromise

      const ws = MockWebSocket.instances[0]
      const resultPromise = conn.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })

      // Verify sent message
      const sent = JSON.parse(ws.sentMessages[0])
      expect(sent.method).toBe('Target.createTarget')
      expect(sent.params).toEqual({ url: 'about:blank' })
      expect(sent.id).toBe(1)

      // Simulate CDP response
      ws.simulateMessage(JSON.stringify({ id: 1, result: { targetId: 'T1' } }))
      const result = await resultPromise
      expect(result.targetId).toBe('T1')
    })

    it('rejects on CDP error response', async () => {
      const connectPromise = conn.connect('ws://localhost:9222/devtools/browser/abc')
      MockWebSocket.instances[0].simulateOpen()
      await connectPromise

      const ws = MockWebSocket.instances[0]
      const resultPromise = conn.send('Bad.method')

      ws.simulateMessage(JSON.stringify({
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      }))

      await expect(resultPromise).rejects.toThrow('CDP error -32601: Method not found')
    })

    it('throws if not connected', async () => {
      await expect(conn.send('Target.getTargets')).rejects.toThrow('Not connected')
    })

    it('increments message IDs', async () => {
      const connectPromise = conn.connect('ws://localhost:9222/devtools/browser/abc')
      MockWebSocket.instances[0].simulateOpen()
      await connectPromise

      const ws = MockWebSocket.instances[0]
      const p1 = conn.send('Method.one')
      const p2 = conn.send('Method.two')

      const msg1 = JSON.parse(ws.sentMessages[0])
      const msg2 = JSON.parse(ws.sentMessages[1])
      expect(msg1.id).toBe(1)
      expect(msg2.id).toBe(2)

      // Resolve pending promises to avoid unhandled rejections
      ws.simulateMessage(JSON.stringify({ id: 1, result: {} }))
      ws.simulateMessage(JSON.stringify({ id: 2, result: {} }))
      await Promise.all([p1, p2])
    })
  })

  describe('events', () => {
    it('dispatches CDP events to registered handlers', async () => {
      const connectPromise = conn.connect('ws://localhost:9222/devtools/browser/abc')
      MockWebSocket.instances[0].simulateOpen()
      await connectPromise

      const ws = MockWebSocket.instances[0]
      const received: unknown[] = []
      conn.on('Page.loadEventFired', (params) => received.push(params))

      ws.simulateMessage(JSON.stringify({
        method: 'Page.loadEventFired',
        params: { timestamp: 12345 },
      }))

      expect(received).toEqual([{ timestamp: 12345 }])
    })

    it('ignores events with no handlers', async () => {
      const connectPromise = conn.connect('ws://localhost:9222/devtools/browser/abc')
      MockWebSocket.instances[0].simulateOpen()
      await connectPromise

      const ws = MockWebSocket.instances[0]
      // Should not throw
      ws.simulateMessage(JSON.stringify({
        method: 'Network.requestWillBeSent',
        params: {},
      }))
    })
  })

  describe('close', () => {
    it('rejects pending requests on close', async () => {
      const connectPromise = conn.connect('ws://localhost:9222/devtools/browser/abc')
      MockWebSocket.instances[0].simulateOpen()
      await connectPromise

      const ws = MockWebSocket.instances[0]
      const pending = conn.send('Long.running')

      ws.close() // triggers close event

      await expect(pending).rejects.toThrow('WebSocket closed')
      expect(conn.connected).toBe(false)
    })
  })
})
