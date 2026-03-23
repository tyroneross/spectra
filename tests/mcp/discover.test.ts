import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { handleDiscover } from '../../src/mcp/tools/discover.js'
import { encodePng } from '../../src/media/png.js'
import type { Driver, Snapshot, Element, ActionType, ActResult, DriverTarget } from '../../src/core/types.js'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ToolContext } from '../../src/mcp/context.js'
import type { SessionManager } from '../../src/core/session.js'
import type { Session } from '../../src/core/types.js'

// ─── PNG helpers ──────────────────────────────────────────────

function makeTestPng(r: number, g: number, b: number, size = 20): Buffer {
  const width = size
  const height = size
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return encodePng({ width, height, data })
}

// Gradient PNGs produce different perceptual hashes
function makeGradientPng(leftToRight: boolean, size = 20): Buffer {
  const width = size
  const height = size
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = leftToRight ? x / (width - 1) : 1 - x / (width - 1)
      const v = Math.round(t * 255)
      const idx = (y * width + x) * 4
      data[idx] = v
      data[idx + 1] = v
      data[idx + 2] = v
      data[idx + 3] = 255
    }
  }
  return encodePng({ width, height, data })
}

// ─── Element factory ──────────────────────────────────────────

let _elId = 0
function makeElement(overrides: Partial<Element> = {}): Element {
  _elId++
  return {
    id: `el-${_elId}`,
    role: 'button',
    label: `Element ${_elId}`,
    value: null,
    enabled: true,
    focused: false,
    actions: ['click'],
    bounds: [0, 0, 100, 40],
    parent: null,
    ...overrides,
  }
}

// ─── Snapshot factory ─────────────────────────────────────────

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    platform: 'web',
    elements: [],
    timestamp: Date.now(),
    url: 'http://example.com/',
    ...overrides,
  }
}

// ─── Mock Driver ─────────────────────────────────────────────

interface ScreenData {
  snapshot: Snapshot
  screenshot: Buffer
}

class MockDriver implements Driver {
  private currentScreen: string

  constructor(
    private screens: Map<string, ScreenData>,
    private transitions: Map<string, string> // elementId → screenName
  ) {
    this.currentScreen = [...screens.keys()][0]
  }

  async connect(_target: DriverTarget): Promise<void> {}

  async snapshot(): Promise<Snapshot> {
    const s = this.screens.get(this.currentScreen)
    if (!s) throw new Error(`No screen: ${this.currentScreen}`)
    return s.snapshot
  }

  async screenshot(): Promise<Buffer> {
    const s = this.screens.get(this.currentScreen)
    if (!s) throw new Error(`No screen: ${this.currentScreen}`)
    return s.screenshot
  }

  async act(elementId: string, action: ActionType, _value?: string): Promise<ActResult> {
    // Only transition on click — scroll/hover/etc should not navigate
    if (action === 'click') {
      const target = this.transitions.get(elementId)
      if (target) this.currentScreen = target
    }
    const snap = await this.snapshot()
    return { success: true, snapshot: snap }
  }

  async navigate(url: string): Promise<void> {
    for (const [name, data] of this.screens) {
      if (data.snapshot.url === url) {
        this.currentScreen = name
        return
      }
    }
  }

  async close(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

// ─── Mock Context ─────────────────────────────────────────────

function makeSession(platform: Session['platform'] = 'web'): Session {
  return {
    id: 'test-session',
    name: 'test',
    platform,
    target: { url: 'http://example.com/' },
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function makeContext(driver: Driver, sessionId = 'test-session'): ToolContext {
  const session = makeSession()
  const sessionsMap = new Map<string, Session>([[sessionId, session]])

  const sessions = {
    get: (id: string) => sessionsMap.get(id) ?? null,
    create: async () => session,
    addStep: async () => {},
    list: () => [...sessionsMap.values()],
    close: async () => {},
    closeAll: async () => {},
  } as unknown as SessionManager

  const drivers = new Map<string, Driver>([[sessionId, driver]])

  return { sessions, drivers }
}

// ─── Setup / Teardown ─────────────────────────────────────────

let tmpDir: string

beforeEach(async () => {
  _elId = 0
  tmpDir = await mkdtemp(join(tmpdir(), 'spectra-discover-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ─── Tests ────────────────────────────────────────────────────

describe('handleDiscover', () => {

  it('test 1: session not found — throws error', async () => {
    const ctx = makeContext(new MockDriver(new Map(), new Map()), 'test-session')
    // Remove the driver so session not found
    ctx.drivers.clear()

    await expect(handleDiscover({ sessionId: 'test-session', outputDir: tmpDir }, ctx))
      .rejects.toThrow('Session test-session not found')
  })

  it('test 2: single screen app — 1 screen captured, manifest written', async () => {
    const homeSnap = makeSnapshot({ url: 'http://example.com/', elements: [] })
    const homePng = makeGradientPng(true)

    const screens = new Map([['home', { snapshot: homeSnap, screenshot: homePng }]])
    const driver = new MockDriver(screens, new Map())
    const ctx = makeContext(driver)

    const result = await handleDiscover({
      sessionId: 'test-session',
      outputDir: tmpDir,
    }, ctx)

    expect(result.screens).toBe(1)
    expect(result.outputDir).toBe(tmpDir)
    expect(result.manifestPath).toBe(join(tmpDir, 'manifest.json'))
  })

  it('test 3: multi-screen discovery — 2 screens linked → 2 screen captures', async () => {
    const linkEl = makeElement({ role: 'link', label: 'About', id: 'link-about' })
    const homeSnap = makeSnapshot({ url: 'http://example.com/', elements: [linkEl] })
    const aboutSnap = makeSnapshot({
      url: 'http://example.com/about',
      elements: [makeElement({ role: 'heading', label: 'About Us' })],
    })
    const homePng = makeGradientPng(true)
    const aboutPng = makeGradientPng(false)

    const screens = new Map([
      ['home', { snapshot: homeSnap, screenshot: homePng }],
      ['about', { snapshot: aboutSnap, screenshot: aboutPng }],
    ])
    const transitions = new Map([['link-about', 'about']])
    const driver = new MockDriver(screens, transitions)
    const ctx = makeContext(driver)

    const result = await handleDiscover({
      sessionId: 'test-session',
      outputDir: tmpDir,
    }, ctx)

    // 2 screens discovered
    expect(result.screens).toBe(2)
    // At least 2 captures (one per non-sensitive screen)
    expect(result.captures).toBeGreaterThanOrEqual(2)
  })

  it('test 4: manifest written — file exists with valid JSON and captures array', async () => {
    const homeSnap = makeSnapshot({ url: 'http://example.com/', elements: [] })
    const screens = new Map([['home', { snapshot: homeSnap, screenshot: makeGradientPng(true) }]])
    const driver = new MockDriver(screens, new Map())
    const ctx = makeContext(driver)

    await handleDiscover({ sessionId: 'test-session', outputDir: tmpDir }, ctx)

    const content = await readFile(join(tmpDir, 'manifest.json'), 'utf-8')
    const parsed = JSON.parse(content)

    expect(parsed.sessionId).toBe('test-session')
    expect(Array.isArray(parsed.captures)).toBe(true)
    expect(typeof parsed.duration).toBe('number')
  })

  it('test 5: output directory created — directory exists after discover', async () => {
    const nested = join(tmpDir, 'nested', 'output')
    const homeSnap = makeSnapshot({ url: 'http://example.com/', elements: [] })
    const screens = new Map([['home', { snapshot: homeSnap, screenshot: makeGradientPng(true) }]])
    const driver = new MockDriver(screens, new Map())
    const ctx = makeContext(driver)

    await handleDiscover({ sessionId: 'test-session', outputDir: nested }, ctx)

    const files = await readdir(nested)
    expect(files).toContain('manifest.json')
  })

  it('test 6: sensitive screen skipped — in sensitive list, no capture file for that screen', async () => {
    const passwordEl = makeElement({ role: 'textbox', label: 'password', id: 'pw-input' })
    const sensitiveSnap = makeSnapshot({
      url: 'http://example.com/login',
      elements: [passwordEl],
    })
    const screens = new Map([['login', { snapshot: sensitiveSnap, screenshot: makeGradientPng(true) }]])
    const driver = new MockDriver(screens, new Map())
    const ctx = makeContext(driver)

    const result = await handleDiscover({ sessionId: 'test-session', outputDir: tmpDir }, ctx)

    expect(result.sensitive.length).toBeGreaterThan(0)
    // No capture files for the sensitive screen
    expect(result.captures).toBe(0)

    const files = await readdir(tmpDir)
    const screenFiles = files.filter(f => f.startsWith('screen-'))
    expect(screenFiles.length).toBe(0)
  })

  it('test 7: maxDepth respected — limits exploration depth', async () => {
    const linkToB = makeElement({ role: 'link', label: 'Go B', id: 'link-b' })
    const linkToC = makeElement({ role: 'link', label: 'Go C', id: 'link-c' })

    const snapA = makeSnapshot({ url: 'http://example.com/', elements: [linkToB] })
    const snapB = makeSnapshot({ url: 'http://example.com/b', elements: [linkToC] })
    const snapC = makeSnapshot({ url: 'http://example.com/c', elements: [] })

    const screens = new Map([
      ['a', { snapshot: snapA, screenshot: makeGradientPng(true) }],
      ['b', { snapshot: snapB, screenshot: makeGradientPng(false) }],
      ['c', { snapshot: snapC, screenshot: makeTestPng(200, 100, 50) }],
    ])
    const transitions = new Map([['link-b', 'b'], ['link-c', 'c']])
    const driver = new MockDriver(screens, transitions)
    const ctx = makeContext(driver)

    const result = await handleDiscover({
      sessionId: 'test-session',
      outputDir: tmpDir,
      maxDepth: 1,
    }, ctx)

    // depth=1 → A + B discovered, C should NOT be (requires depth=2)
    expect(result.screens).toBe(2)
  })

  it('test 8: maxScreens respected — limits total screens', async () => {
    const links = [
      makeElement({ role: 'link', label: 'Page B', id: 'link-pB' }),
      makeElement({ role: 'link', label: 'Page C', id: 'link-pC' }),
    ]
    const snapA = makeSnapshot({ url: 'http://example.com/', elements: links })
    const snapB = makeSnapshot({ url: 'http://example.com/b', elements: [] })
    const snapC = makeSnapshot({ url: 'http://example.com/c', elements: [] })

    const screens = new Map([
      ['a', { snapshot: snapA, screenshot: makeGradientPng(true) }],
      ['b', { snapshot: snapB, screenshot: makeGradientPng(false) }],
      ['c', { snapshot: snapC, screenshot: makeTestPng(50, 100, 200) }],
    ])
    const transitions = new Map([['link-pB', 'b'], ['link-pC', 'c']])
    const driver = new MockDriver(screens, transitions)
    const ctx = makeContext(driver)

    const result = await handleDiscover({
      sessionId: 'test-session',
      outputDir: tmpDir,
      maxScreens: 2,
    }, ctx)

    expect(result.screens).toBe(2)
  })

  it('test 9: captures include state detection — each capture entry has a state field', async () => {
    const homeSnap = makeSnapshot({
      url: 'http://example.com/',
      elements: [
        makeElement({ role: 'heading', label: 'Welcome' }),
        makeElement({ role: 'button', label: 'Get Started' }),
        makeElement({ role: 'text', label: 'Some content' }),
        makeElement({ role: 'link', label: 'Learn more' }),
      ],
    })
    const screens = new Map([['home', { snapshot: homeSnap, screenshot: makeGradientPng(true) }]])
    const driver = new MockDriver(screens, new Map())
    const ctx = makeContext(driver)

    const result = await handleDiscover({ sessionId: 'test-session', outputDir: tmpDir }, ctx)

    // Read manifest to verify state field presence
    const content = await readFile(join(tmpDir, 'manifest.json'), 'utf-8')
    const parsed = JSON.parse(content)

    expect(parsed.captures.length).toBeGreaterThan(0)
    for (const capture of parsed.captures) {
      expect(typeof capture.state).toBe('string')
      expect(['loading', 'empty', 'error', 'populated', 'focused', 'unknown']).toContain(capture.state)
    }
  })

  it('test 10: framed captures generated — at least one capture with framed=true', async () => {
    // Use a screen with high-scoring elements so framing triggers
    const homeSnap = makeSnapshot({
      url: 'http://example.com/',
      elements: [
        makeElement({ role: 'heading', label: 'Main Heading', bounds: [10, 10, 200, 40] }),
        makeElement({ role: 'button', label: 'Call To Action', bounds: [10, 60, 150, 44] }),
        makeElement({ role: 'link', label: 'Navigation Link', bounds: [10, 120, 120, 30] }),
      ],
    })
    // Larger PNG so framing has something to crop
    const homePng = makeGradientPng(true, 400)
    const screens = new Map([['home', { snapshot: homeSnap, screenshot: homePng }]])
    const driver = new MockDriver(screens, new Map())
    const ctx = makeContext(driver)

    const result = await handleDiscover({ sessionId: 'test-session', outputDir: tmpDir }, ctx)

    const content = await readFile(join(tmpDir, 'manifest.json'), 'utf-8')
    const parsed = JSON.parse(content)

    const framedCaptures = parsed.captures.filter((c: { framed: boolean }) => c.framed === true)
    expect(framedCaptures.length).toBeGreaterThan(0)
    expect(result.captures).toBeGreaterThan(1)
  })

})
