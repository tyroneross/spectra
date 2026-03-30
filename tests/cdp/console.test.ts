import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConsoleDomain } from '../../src/cdp/console.js'
import type { CdpConnection } from '../../src/cdp/connection.js'

function mockConnection(): CdpConnection {
  return {
    send: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
    off: vi.fn(),
    connected: true,
  } as unknown as CdpConnection
}

// Simulate firing a Runtime.consoleAPICalled event via the registered handler
function fireConsoleEvent(conn: CdpConnection, params: object): void {
  const onCalls = vi.mocked(conn.on).mock.calls
  const call = onCalls.find(([event]) => event === 'Runtime.consoleAPICalled')
  if (!call) throw new Error('Runtime.consoleAPICalled handler not registered')
  call[1](params)
}

describe('ConsoleDomain', () => {
  let conn: CdpConnection
  let domain: ConsoleDomain

  beforeEach(() => {
    conn = mockConnection()
    domain = new ConsoleDomain(conn, 'session-1')
  })

  describe('enable()', () => {
    it('sends Runtime.enable with the correct sessionId', async () => {
      await domain.enable()
      expect(conn.send).toHaveBeenCalledWith('Runtime.enable', {}, 'session-1')
    })

    it('registers a Runtime.consoleAPICalled listener', async () => {
      await domain.enable()
      const events = vi.mocked(conn.on).mock.calls.map(([e]) => e)
      expect(events).toContain('Runtime.consoleAPICalled')
    })

    it('is idempotent — second enable() does not re-send', async () => {
      await domain.enable()
      await domain.enable()
      expect(conn.send).toHaveBeenCalledTimes(1)
    })
  })

  describe('message capture', () => {
    it('captures a log message from the event', async () => {
      await domain.enable()
      fireConsoleEvent(conn, {
        type: 'log',
        args: [{ type: 'string', value: 'hello world' }],
        timestamp: 1000,
      })
      const messages = domain.getMessages()
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({ type: 'log', text: 'hello world', timestamp: 1000 })
    })

    it('joins multiple args with spaces', async () => {
      await domain.enable()
      fireConsoleEvent(conn, {
        type: 'log',
        args: [
          { type: 'string', value: 'foo' },
          { type: 'string', value: 'bar' },
        ],
        timestamp: 2000,
      })
      expect(domain.getMessages()[0].text).toBe('foo bar')
    })

    it('uses description as fallback when value is absent', async () => {
      await domain.enable()
      fireConsoleEvent(conn, {
        type: 'log',
        args: [{ type: 'object', description: 'HTMLBodyElement' }],
        timestamp: 3000,
      })
      expect(domain.getMessages()[0].text).toBe('HTMLBodyElement')
    })

    it('extracts url and lineNumber from stackTrace', async () => {
      await domain.enable()
      fireConsoleEvent(conn, {
        type: 'error',
        args: [{ type: 'string', value: 'oops' }],
        timestamp: 4000,
        stackTrace: {
          callFrames: [{ url: 'https://example.com/app.js', lineNumber: 42 }],
        },
      })
      const msg = domain.getMessages()[0]
      expect(msg.url).toBe('https://example.com/app.js')
      expect(msg.lineNumber).toBe(42)
    })

    it('accumulates multiple messages', async () => {
      await domain.enable()
      fireConsoleEvent(conn, { type: 'log', args: [{ type: 'string', value: 'a' }], timestamp: 1 })
      fireConsoleEvent(conn, { type: 'error', args: [{ type: 'string', value: 'b' }], timestamp: 2 })
      fireConsoleEvent(conn, { type: 'warning', args: [{ type: 'string', value: 'c' }], timestamp: 3 })
      expect(domain.getMessages()).toHaveLength(3)
    })
  })

  describe('getErrors()', () => {
    it('returns only error and warning messages', async () => {
      await domain.enable()
      fireConsoleEvent(conn, { type: 'log', args: [{ type: 'string', value: 'log' }], timestamp: 1 })
      fireConsoleEvent(conn, { type: 'info', args: [{ type: 'string', value: 'info' }], timestamp: 2 })
      fireConsoleEvent(conn, { type: 'error', args: [{ type: 'string', value: 'err' }], timestamp: 3 })
      fireConsoleEvent(conn, { type: 'warning', args: [{ type: 'string', value: 'warn' }], timestamp: 4 })

      const errors = domain.getErrors()
      expect(errors).toHaveLength(2)
      expect(errors.map(e => e.type)).toEqual(['error', 'warning'])
    })

    it('returns empty array when no errors recorded', async () => {
      await domain.enable()
      expect(domain.getErrors()).toEqual([])
    })
  })

  describe('clear()', () => {
    it('empties all messages', async () => {
      await domain.enable()
      fireConsoleEvent(conn, { type: 'log', args: [{ type: 'string', value: 'x' }], timestamp: 1 })
      fireConsoleEvent(conn, { type: 'error', args: [{ type: 'string', value: 'y' }], timestamp: 2 })
      expect(domain.getMessages()).toHaveLength(2)

      domain.clear()
      expect(domain.getMessages()).toHaveLength(0)
      expect(domain.getErrors()).toHaveLength(0)
    })
  })

  describe('handler subscription', () => {
    it('calls registered handler for each incoming message', async () => {
      await domain.enable()
      const handler = vi.fn()
      domain.onMessage(handler)

      fireConsoleEvent(conn, { type: 'log', args: [{ type: 'string', value: 'hi' }], timestamp: 5 })
      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'log', text: 'hi' }))
    })

    it('offMessage stops the handler from receiving further messages', async () => {
      await domain.enable()
      const handler = vi.fn()
      domain.onMessage(handler)
      fireConsoleEvent(conn, { type: 'log', args: [{ type: 'string', value: 'a' }], timestamp: 1 })
      domain.offMessage(handler)
      fireConsoleEvent(conn, { type: 'log', args: [{ type: 'string', value: 'b' }], timestamp: 2 })
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('getMessages() returns a copy — mutations do not affect internal state', async () => {
      await domain.enable()
      fireConsoleEvent(conn, { type: 'log', args: [{ type: 'string', value: 'stable' }], timestamp: 1 })
      const copy = domain.getMessages()
      copy.splice(0)
      expect(domain.getMessages()).toHaveLength(1)
    })
  })
})
