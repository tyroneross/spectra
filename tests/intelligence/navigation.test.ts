import { describe, it, expect } from 'vitest'
import { crawl, fingerprint } from '../../src/intelligence/navigation.js'
import { encodePng } from '../../src/media/png.js'
import type { Driver, Snapshot, Element, ActionType, ActResult, DriverTarget } from '../../src/core/types.js'

// ─── Test PNG helpers ─────────────────────────────────────────

function makeTestPng(r: number, g: number, b: number): Buffer {
  const width = 10
  const height = 10
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return encodePng({ width, height, data })
}

// Gradient PNGs produce different perceptual hashes (needed so detectChange sees real change)
function makeGradientPng(leftToRight: boolean): Buffer {
  const width = 20
  const height = 20
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
  private actLog: Array<{ elementId: string; action: string }> = []

  constructor(
    private screens: Map<string, ScreenData>,
    private transitions: Map<string, string> // elementId → screenName
  ) {
    // start on first screen
    this.currentScreen = [...screens.keys()][0]
  }

  getActLog() { return this.actLog }
  getCurrentScreen() { return this.currentScreen }

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
    this.actLog.push({ elementId, action })
    const target = this.transitions.get(elementId)
    if (target) this.currentScreen = target
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

// ─── Tests ────────────────────────────────────────────────────

describe('fingerprint()', () => {
  it('produces stable output for same snapshot', () => {
    const snap = makeSnapshot({
      elements: [
        makeElement({ role: 'button', label: 'Submit' }),
        makeElement({ role: 'link', label: 'Home' }),
      ],
    })
    expect(fingerprint(snap)).toBe(fingerprint(snap))
  })

  it('is order-independent (sorted role:label pairs)', () => {
    const el1 = makeElement({ role: 'button', label: 'Submit' })
    const el2 = makeElement({ role: 'link', label: 'Home' })
    const snapA = makeSnapshot({ elements: [el1, el2] })
    const snapB = makeSnapshot({ elements: [el2, el1] })
    expect(fingerprint(snapA)).toBe(fingerprint(snapB))
  })

  it('differs when elements change', () => {
    const snapA = makeSnapshot({ elements: [makeElement({ role: 'button', label: 'Login' })] })
    const snapB = makeSnapshot({ elements: [makeElement({ role: 'button', label: 'Logout' })] })
    expect(fingerprint(snapA)).not.toBe(fingerprint(snapB))
  })
})

describe('crawl()', () => {
  it('test 1: single screen no navigation → 1 node, 0 edges', async () => {
    const homeSnap = makeSnapshot({ url: 'http://example.com/', elements: [] })
    const homePng = makeGradientPng(true)

    const screens = new Map([['home', { snapshot: homeSnap, screenshot: homePng }]])
    const transitions = new Map<string, string>()

    const driver = new MockDriver(screens, transitions)
    const graph = await crawl(driver, { scrollDiscover: false })

    expect(graph.nodes.size).toBe(1)
    expect(graph.edges.length).toBe(0)
    expect(graph.root).toBeTruthy()
  })

  it('test 2: two linked screens → 2 nodes, 1 edge', async () => {
    const linkEl = makeElement({ role: 'link', label: 'About', id: 'link-about' })

    const homeSnap = makeSnapshot({
      url: 'http://example.com/',
      elements: [linkEl],
    })
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
    const graph = await crawl(driver, { scrollDiscover: false, changeThreshold: 0.0 })

    expect(graph.nodes.size).toBe(2)
    expect(graph.edges.length).toBe(1)
    expect(graph.edges[0].action.elementId).toBe('link-about')
    expect(graph.edges[0].action.type).toBe('click')
  })

  it('test 3: deduplication — two elements lead to same screen → 1 target node', async () => {
    const btn1 = makeElement({ role: 'button', label: 'Go to About (1)', id: 'btn-1' })
    const btn2 = makeElement({ role: 'button', label: 'Go to About (2)', id: 'btn-2' })

    // Both buttons lead to the exact same "about" screen (same elements, same URL)
    const aboutEl = makeElement({ role: 'heading', label: 'About Heading' })
    const homeSnap = makeSnapshot({ url: 'http://example.com/', elements: [btn1, btn2] })
    const aboutSnap = makeSnapshot({ url: 'http://example.com/about', elements: [aboutEl] })

    const homePng = makeGradientPng(true)
    const aboutPng = makeGradientPng(false)

    const screens = new Map([
      ['home', { snapshot: homeSnap, screenshot: homePng }],
      ['about', { snapshot: aboutSnap, screenshot: aboutPng }],
    ])
    const transitions = new Map([['btn-1', 'about'], ['btn-2', 'about']])

    const driver = new MockDriver(screens, transitions)
    const graph = await crawl(driver, { scrollDiscover: false, changeThreshold: 0.0 })

    // home + about = 2 nodes; not 3
    expect(graph.nodes.size).toBe(2)
    // Two edges (both buttons → about), but only one unique target node
    const targetIds = new Set(graph.edges.map(e => e.to))
    expect(targetIds.size).toBe(1)
  })

  it('test 4: maxDepth=1 → only root direct links explored, not grandchildren', async () => {
    const linkToB = makeElement({ role: 'link', label: 'Go B', id: 'link-b' })
    const linkToC = makeElement({ role: 'link', label: 'Go C', id: 'link-c' })

    const snapA = makeSnapshot({ url: 'http://example.com/', elements: [linkToB] })
    const snapB = makeSnapshot({ url: 'http://example.com/b', elements: [linkToC] })
    const snapC = makeSnapshot({ url: 'http://example.com/c', elements: [] })

    const pngA = makeGradientPng(true)
    const pngB = makeGradientPng(false)
    const pngC = makeTestPng(200, 100, 50)

    const screens = new Map([
      ['a', { snapshot: snapA, screenshot: pngA }],
      ['b', { snapshot: snapB, screenshot: pngB }],
      ['c', { snapshot: snapC, screenshot: pngC }],
    ])
    const transitions = new Map([['link-b', 'b'], ['link-c', 'c']])

    const driver = new MockDriver(screens, transitions)
    const graph = await crawl(driver, { scrollDiscover: false, maxDepth: 1, changeThreshold: 0.0 })

    // Should find A + B (depth 0 → 1), but NOT C (depth 1 → 2 which exceeds maxDepth=1)
    expect(graph.nodes.size).toBe(2)
  })

  it('test 5: maxScreens=2 → stops at 2 nodes', async () => {
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
    const graph = await crawl(driver, { scrollDiscover: false, maxScreens: 2, changeThreshold: 0.0 })

    expect(graph.nodes.size).toBe(2)
  })

  it('test 6: sensitive content detection — screen with password field → sensitiveContent=true', async () => {
    const passwordInput = makeElement({
      role: 'textbox',
      label: 'password',
      id: 'input-password',
    })
    const snapA = makeSnapshot({ url: 'http://example.com/login', elements: [passwordInput] })
    const screens = new Map([['login', { snapshot: snapA, screenshot: makeGradientPng(true) }]])
    const transitions = new Map<string, string>()

    const driver = new MockDriver(screens, transitions)
    const graph = await crawl(driver, { scrollDiscover: false })

    const rootNode = [...graph.nodes.values()][0]
    expect(rootNode.sensitiveContent).toBe(true)
    // screenshot should be empty buffer for sensitive screens
    expect(rootNode.screenshot.length).toBe(0)
  })

  it('test 7: change threshold — insignificant change skipped (no new node)', async () => {
    const btn = makeElement({ role: 'button', label: 'Tiny Change', id: 'btn-tiny' })
    // Home snapshot and "changed" snapshot have identical elements (change score = 0)
    const snapA = makeSnapshot({
      url: 'http://example.com/',
      elements: [btn],
    })
    // After click, same elements → change score will be 0 < threshold
    const snapSame = makeSnapshot({
      url: 'http://example.com/',
      elements: [btn],
    })

    const samePng = makeGradientPng(true) // same image → perceptual hash will be identical

    const screens = new Map([
      ['home', { snapshot: snapA, screenshot: samePng }],
    ])
    // btn-tiny transitions to 'home' (same screen)
    const transitions = new Map([['btn-tiny', 'home']])

    const driver = new MockDriver(screens, transitions)
    const graph = await crawl(driver, { scrollDiscover: false, changeThreshold: 0.15 })

    // No new node added — same fingerprint deduped
    expect(graph.nodes.size).toBe(1)
  })

  it('test 8: backtracking — after clicking link to B from A, driver navigates back to A', async () => {
    const linkEl = makeElement({ role: 'link', label: 'Go to B', id: 'link-to-b' })
    const snapA = makeSnapshot({ url: 'http://example.com/', elements: [linkEl] })
    const snapB = makeSnapshot({ url: 'http://example.com/b', elements: [] })

    const screens = new Map([
      ['a', { snapshot: snapA, screenshot: makeGradientPng(true) }],
      ['b', { snapshot: snapB, screenshot: makeGradientPng(false) }],
    ])
    const transitions = new Map([['link-to-b', 'b']])

    const navigateCalls: string[] = []
    class TrackingDriver extends MockDriver {
      override async navigate(url: string): Promise<void> {
        navigateCalls.push(url)
        return super.navigate(url)
      }
    }

    const driver = new TrackingDriver(screens, transitions)
    const graph = await crawl(driver, { scrollDiscover: false, changeThreshold: 0.0 })

    // Both pages discovered
    expect(graph.nodes.size).toBe(2)
    expect(graph.edges.length).toBe(1)

    // Backtracking: navigate was called with page A's URL at least once
    expect(navigateCalls).toContain('http://example.com/')
  })

  it('test 9: external link filtering — external URL skipped when allowExternal=false', async () => {
    const externalLink = makeElement({
      role: 'link',
      label: 'http://other-domain.com/page',
      id: 'ext-link',
    })
    const internalLink = makeElement({
      role: 'link',
      label: 'Internal Page',
      id: 'int-link',
    })
    const snapA = makeSnapshot({
      url: 'http://example.com/',
      elements: [externalLink, internalLink],
    })
    const snapInternal = makeSnapshot({
      url: 'http://example.com/internal',
      elements: [],
    })

    const screens = new Map([
      ['a', { snapshot: snapA, screenshot: makeGradientPng(true) }],
      ['internal', { snapshot: snapInternal, screenshot: makeGradientPng(false) }],
    ])
    const transitions = new Map([
      ['ext-link', 'external'],
      ['int-link', 'internal'],
    ])

    const driver = new MockDriver(screens, transitions)
    const graph = await crawl(driver, {
      scrollDiscover: false,
      allowExternal: false,
      changeThreshold: 0.0,
    })

    // External link should not have been followed
    const actLog = driver.getActLog()
    const externalActed = actLog.some(a => a.elementId === 'ext-link')
    expect(externalActed).toBe(false)

    // Internal link should have been followed → 2 nodes
    expect(graph.nodes.size).toBe(2)
  })

  it('test 10: graph structure — edges have correct from/to/action data', async () => {
    const navEl = makeElement({ role: 'link', label: 'Contact', id: 'link-contact' })
    const snapHome = makeSnapshot({ url: 'http://example.com/', elements: [navEl] })
    const snapContact = makeSnapshot({ url: 'http://example.com/contact', elements: [] })

    const screens = new Map([
      ['home', { snapshot: snapHome, screenshot: makeGradientPng(true) }],
      ['contact', { snapshot: snapContact, screenshot: makeGradientPng(false) }],
    ])
    const transitions = new Map([['link-contact', 'contact']])

    const driver = new MockDriver(screens, transitions)
    const graph = await crawl(driver, { scrollDiscover: false, changeThreshold: 0.0 })

    expect(graph.edges.length).toBeGreaterThanOrEqual(1)
    const edge = graph.edges[0]

    expect(edge.from).toBe(graph.root)
    expect(typeof edge.to).toBe('string')
    expect(edge.to).not.toBe(edge.from)
    expect(edge.action.elementId).toBe('link-contact')
    expect(edge.action.type).toBe('click')
    expect(edge.action.label).toBe('Contact')
  })
})
