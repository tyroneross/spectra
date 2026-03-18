import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CdpConnection } from '../../src/cdp/connection.js'
import { InputDomain } from '../../src/cdp/input.js'
import { PageDomain } from '../../src/cdp/page.js'
import { DomDomain } from '../../src/cdp/dom.js'
import { TargetDomain } from '../../src/cdp/target.js'
import { RuntimeDomain } from '../../src/cdp/runtime.js'

function mockConnection(): CdpConnection {
  return {
    send: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
    off: vi.fn(),
    connected: true,
  } as unknown as CdpConnection
}

describe('InputDomain', () => {
  let conn: CdpConnection
  let input: InputDomain

  beforeEach(() => {
    conn = mockConnection()
    input = new InputDomain(conn, 'sess-1')
  })

  it('dispatches a click at coordinates', async () => {
    await input.click(150, 200)

    // Click = mousePressed + mouseReleased
    expect(conn.send).toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed', x: 150, y: 200, button: 'left', clickCount: 1 }),
      'sess-1',
    )
    expect(conn.send).toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mouseReleased', x: 150, y: 200 }),
      'sess-1',
    )
  })

  it('types text as individual key events', async () => {
    await input.type('Hi')

    // Each character: keyDown + keyUp
    expect(conn.send).toHaveBeenCalledWith(
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'keyDown', text: 'H', code: 'KeyH' }),
      'sess-1',
    )
    expect(conn.send).toHaveBeenCalledWith(
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'keyUp', key: 'H', code: 'KeyH' }),
      'sess-1',
    )
  })

  it('uses correct key codes for non-alpha characters', async () => {
    await input.type('1 @')

    const calls = vi.mocked(conn.send).mock.calls
    const keyCodes = calls
      .filter(([method]) => method === 'Input.dispatchKeyEvent')
      .map(([, params]) => (params as Record<string, unknown>).code)

    // '1' → Digit1, ' ' → Space, '@' → Digit2
    expect(keyCodes).toContain('Digit1')
    expect(keyCodes).toContain('Space')
    expect(keyCodes).toContain('Digit2')
    expect(keyCodes).not.toContain('Key1')
    expect(keyCodes).not.toContain('Key ')
  })
})

describe('PageDomain', () => {
  let conn: CdpConnection
  let page: PageDomain

  beforeEach(() => {
    conn = mockConnection()
    page = new PageDomain(conn, 'sess-1')
  })

  it('navigates to a URL', async () => {
    vi.mocked(conn.send).mockResolvedValueOnce({ frameId: 'F1' })
    await page.navigate('http://localhost:3000')

    expect(conn.send).toHaveBeenCalledWith(
      'Page.navigate',
      { url: 'http://localhost:3000' },
      'sess-1',
    )
  })

  it('captures a screenshot as Buffer', async () => {
    vi.mocked(conn.send).mockResolvedValueOnce({ data: 'iVBOR...' })
    const buf = await page.screenshot()

    expect(conn.send).toHaveBeenCalledWith(
      'Page.captureScreenshot',
      { format: 'png' },
      'sess-1',
    )
    expect(buf).toBeInstanceOf(Buffer)
  })
})

describe('DomDomain', () => {
  let conn: CdpConnection
  let dom: DomDomain

  beforeEach(() => {
    conn = mockConnection()
    dom = new DomDomain(conn, 'sess-1')
  })

  it('gets element center from box model', async () => {
    vi.mocked(conn.send).mockResolvedValueOnce({
      model: {
        content: [100, 200, 180, 200, 180, 232, 100, 232], // quad: 4 corners
      },
    })
    const center = await dom.getElementCenter(42)
    expect(center).toEqual({ x: 140, y: 216 })
  })
})

describe('TargetDomain', () => {
  let conn: CdpConnection
  let target: TargetDomain

  beforeEach(() => {
    conn = mockConnection()
    target = new TargetDomain(conn)
  })

  it('creates a new page target', async () => {
    vi.mocked(conn.send).mockResolvedValueOnce({ targetId: 'T1' })
    const id = await target.createPage('about:blank')

    expect(conn.send).toHaveBeenCalledWith('Target.createTarget', { url: 'about:blank' })
    expect(id).toBe('T1')
  })

  it('attaches to target with flattened mode', async () => {
    vi.mocked(conn.send).mockResolvedValueOnce({ sessionId: 'S1' })
    const sessionId = await target.attach('T1')

    expect(conn.send).toHaveBeenCalledWith('Target.attachToTarget', { targetId: 'T1', flatten: true })
    expect(sessionId).toBe('S1')
  })
})

describe('RuntimeDomain', () => {
  let conn: CdpConnection
  let runtime: RuntimeDomain

  beforeEach(() => {
    conn = mockConnection()
    runtime = new RuntimeDomain(conn, 'sess-1')
  })

  it('evaluates JavaScript expression', async () => {
    vi.mocked(conn.send).mockResolvedValueOnce({
      result: { type: 'string', value: 'hello' },
    })
    const result = await runtime.evaluate('document.title')

    expect(conn.send).toHaveBeenCalledWith(
      'Runtime.evaluate',
      { expression: 'document.title', returnByValue: true },
      'sess-1',
    )
    expect(result).toBe('hello')
  })
})
