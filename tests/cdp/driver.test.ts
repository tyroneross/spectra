import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CdpDriver } from '../../src/cdp/driver.js'
import { CdpConnection } from '../../src/cdp/connection.js'
import { BrowserManager } from '../../src/cdp/browser.js'

// Mock all CDP modules
vi.mock('../../src/cdp/connection.js')
vi.mock('../../src/cdp/browser.js')
vi.mock('../../src/cdp/wait.js', () => ({
  waitForStableTree: vi.fn().mockResolvedValue({
    elements: [
      { id: 'e1', role: 'button', label: 'OK', value: null, enabled: true, focused: false, actions: ['press'], bounds: [0, 0, 0, 0], parent: null },
    ],
    timedOut: false,
  }),
  buildFingerprint: vi.fn().mockReturnValue('button:OK:true'),
}))

describe('CdpDriver', () => {
  let driver: CdpDriver

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock BrowserManager
    vi.mocked(BrowserManager.prototype.launch).mockResolvedValue('ws://127.0.0.1:9222/devtools/browser/abc')
    vi.mocked(BrowserManager.prototype.close).mockResolvedValue(undefined)

    // Mock CdpConnection
    vi.mocked(CdpConnection.prototype.connect).mockResolvedValue(undefined)
    vi.mocked(CdpConnection.prototype.close).mockResolvedValue(undefined)
    vi.mocked(CdpConnection.prototype.send).mockImplementation(async (method: string) => {
      switch (method) {
        case 'Target.createTarget': return { targetId: 'T1' }
        case 'Target.attachToTarget': return { sessionId: 'S1' }
        case 'Target.closeTarget': return {}
        case 'Accessibility.enable': return {}
        case 'Accessibility.getFullAXTree': return { nodes: [] }
        case 'Page.enable': return {}
        case 'Page.setLifecycleEventsEnabled': return {}
        case 'Page.navigate': return { frameId: 'F1' }
        case 'Page.captureScreenshot': return { data: Buffer.from('PNG').toString('base64') }
        case 'DOM.getBoxModel': return { model: { content: [100, 200, 180, 200, 180, 232, 100, 232] } }
        case 'Input.dispatchMouseEvent': return {}
        case 'Input.dispatchKeyEvent': return {}
        case 'Runtime.evaluate': return { result: { type: 'string', value: '' } }
        default: return {}
      }
    })

    driver = new CdpDriver()
  })

  describe('connect', () => {
    it('launches Chrome, connects WebSocket, creates and attaches to target', async () => {
      await driver.connect({ url: 'http://localhost:3000' })

      expect(BrowserManager.prototype.launch).toHaveBeenCalledOnce()
      expect(CdpConnection.prototype.connect).toHaveBeenCalledWith('ws://127.0.0.1:9222/devtools/browser/abc')
      expect(CdpConnection.prototype.send).toHaveBeenCalledWith('Target.createTarget', { url: 'http://localhost:3000' })
      expect(CdpConnection.prototype.send).toHaveBeenCalledWith('Target.attachToTarget', { targetId: 'T1', flatten: true })
    })
  })

  describe('snapshot', () => {
    it('returns stable AX tree as Snapshot', async () => {
      await driver.connect({ url: 'http://localhost:3000' })
      const snap = await driver.snapshot()

      expect(snap.platform).toBe('web')
      expect(snap.elements).toHaveLength(1)
      expect(snap.elements[0].role).toBe('button')
      expect(snap.timestamp).toBeGreaterThan(0)
    })
  })

  describe('act', () => {
    it('clicks an element by getting its center and dispatching mouse events', async () => {
      await driver.connect({ url: 'http://localhost:3000' })

      const result = await driver.act('e1', 'click')

      expect(result.success).toBeDefined()
      expect(result.snapshot).toBeDefined()
    })
  })

  describe('screenshot', () => {
    it('captures PNG screenshot', async () => {
      await driver.connect({ url: 'http://localhost:3000' })
      const buf = await driver.screenshot()

      expect(buf).toBeInstanceOf(Buffer)
    })
  })

  describe('close', () => {
    it('closes target, connection, and browser', async () => {
      await driver.connect({ url: 'http://localhost:3000' })
      await driver.close()

      expect(CdpConnection.prototype.send).toHaveBeenCalledWith('Target.closeTarget', { targetId: 'T1' })
      expect(CdpConnection.prototype.close).toHaveBeenCalled()
      expect(BrowserManager.prototype.close).toHaveBeenCalled()
    })
  })
})
