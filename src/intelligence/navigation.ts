import type { Driver, Snapshot, Element } from '../core/types.js'
import type { NavigationGraph, ScreenNode, NavigationEdge, CrawlOptions } from './types.js'
import { detectChange } from './change.js'
import { scoreElements } from './importance.js'
import { selectActionForElement, isElementVisible } from '../core/actions.js'

// ─── Debug ───────────────────────────────────────────────────

const DEBUG = process.env.SPECTRA_DEBUG === '1'

// ─── Constants ───────────────────────────────────────────────

const SENSITIVE_PATTERNS = /password|secret|token|api.?key|credit.?card|ssn|social.?security/i

const STRUCTURAL_ROLES = new Set(['group', 'generic', 'none', 'presentation', 'separator'])

const NAVIGABLE_ROLES = new Set([
  'link',
  'button',
  'tab',
  'menuitem',
  'checkbox',
  'radio',
  'switch',
  'combobox',
  'option',
])

const DEFAULT_CRAWL_OPTIONS: CrawlOptions = {
  maxDepth: 3,
  maxScreens: 50,
  scrollDiscover: true,
  captureEach: true,
  changeThreshold: 0.15,
  allowExternal: false,
  allowFormSubmit: false,
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800, devicePixelRatio: 1 }

// ─── FNV-1a Hash ─────────────────────────────────────────────

function simpleHash(str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(36)
}

// ─── Screen Fingerprint ──────────────────────────────────────

export function fingerprint(snapshot: Snapshot): string {
  const pairs = snapshot.elements
    .map(stableElementToken)
    .filter((token): token is string => token !== null)
    .sort()

  return simpleHash(pairs.join('|'))
}

function stableElementToken(el: Element): string | null {
  const role = normalizeRole(el.role)
  const label = normalizeLabel(el.label)
  const value = normalizeLabel(el.value ?? '')
  if (!label && !value && STRUCTURAL_ROLES.has(role)) return null

  const [x, y, w, h] = el.bounds
  const bounds = w > 0 && h > 0
    ? `${bucket(x)}:${bucket(y)}:${bucket(w)}:${bucket(h)}`
    : ''
  return `${role}:${label}:${value}:${bounds}`
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/g, '{uuid}')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '{time}')
    .replace(/\b\d{4,}\b/g, '{number}')
}

function normalizeRole(role: string): string {
  return role.toLowerCase().replace(/^ax/, '')
}

function bucket(value: number): number {
  return Math.round(value / 48)
}

// ─── Screen ID ───────────────────────────────────────────────

function screenId(snapshot: Snapshot): string {
  const fp = fingerprint(snapshot)
  if (snapshot.url) return `${snapshot.url}:${fp}`
  if (snapshot.appName) return `${snapshot.appName}:${fp}`
  return fp
}

// ─── Sensitive Content Check ─────────────────────────────────

function hasSensitiveContent(snapshot: Snapshot): boolean {
  return snapshot.elements.some(el =>
    (el.role === 'textbox' || el.role === 'input') &&
    SENSITIVE_PATTERNS.test(el.label)
  )
}

// ─── External URL Check ──────────────────────────────────────

function isExternalUrl(label: string, currentUrl?: string): boolean {
  // If the label looks like a URL starting with http/https
  if (!label.startsWith('http://') && !label.startsWith('https://')) return false
  if (!currentUrl) return true
  try {
    const current = new URL(currentUrl)
    const target = new URL(label)
    return current.hostname !== target.hostname
  } catch {
    return false
  }
}

// ─── Average Importance ──────────────────────────────────────

function averageImportance(snapshot: Snapshot): number {
  if (snapshot.elements.length === 0) return 0
  const scores = scoreElements(snapshot.elements, DEFAULT_VIEWPORT)
  if (scores.length === 0) return 0
  return scores.reduce((sum, s) => sum + s.score, 0) / scores.length
}

// ─── Crawl ───────────────────────────────────────────────────

export async function crawl(
  driver: Driver,
  options?: Partial<CrawlOptions>
): Promise<NavigationGraph> {
  const opts: CrawlOptions = { ...DEFAULT_CRAWL_OPTIONS, ...options }


  // 1. Take initial snapshot + screenshot
  const rootSnapshot = await driver.snapshot()
  const rootScreenshot = await driver.screenshot()
  const rootId = screenId(rootSnapshot)
  const rootSensitive = hasSensitiveContent(rootSnapshot)

  const rootNode: ScreenNode = {
    id: rootId,
    url: rootSnapshot.url,
    appName: rootSnapshot.appName,
    screenshot: rootSensitive ? Buffer.alloc(0) : rootScreenshot,
    importance: averageImportance(rootSnapshot),
    visited: false,
    sensitiveContent: rootSensitive || undefined,
  }

  // 2. Build initial graph
  const nodes = new Map<string, ScreenNode>()
  const edges: NavigationEdge[] = []
  nodes.set(rootId, rootNode)

  // Map fingerprint -> nodeId (for dedup when URL differs but content is same)
  const fingerprintToNode = new Map<string, string>()
  fingerprintToNode.set(fingerprint(rootSnapshot), rootId)

  // Snapshot cache keyed by nodeId
  const snapshotCache = new Map<string, { snapshot: Snapshot; screenshot: Buffer }>()
  snapshotCache.set(rootId, { snapshot: rootSnapshot, screenshot: rootScreenshot })

  // 3. BFS queue
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: rootId, depth: 0 }]

  while (queue.length > 0 && nodes.size < opts.maxScreens) {
    const item = queue.shift()!
    const { nodeId, depth } = item

    const node = nodes.get(nodeId)!
    if (node.visited) continue
    node.visited = true

    const cached = snapshotCache.get(nodeId)
    if (!cached) continue

    const { snapshot: currentSnapshot, screenshot: currentScreenshot } = cached
    const currentUrl = currentSnapshot.url

    // Navigate to this node's URL before processing (ensures driver is on the right screen)
    if (driver.navigate && currentUrl) {
      await driver.navigate(currentUrl)
    }

    // 4. Scroll discovery
    let scrollSnapshot = currentSnapshot
    if (opts.scrollDiscover) {
      await discoverByScroll(driver)
      // Re-fetch snapshot after scroll to capture newly loaded elements
      scrollSnapshot = await driver.snapshot()
    }

    // 5. Find navigable elements from post-scroll snapshot
    const actionByElementId = new Map<string, NonNullable<ReturnType<typeof selectActionForElement>>>()
    const navigableElements: Element[] = scrollSnapshot.elements.filter(el => {
      const role = normalizeRole(el.role)
      if (!NAVIGABLE_ROLES.has(role)) return false
      if (!isElementVisible(el)) return false

      // Filter external links
      if (role === 'link' && !opts.allowExternal) {
        if (isExternalUrl(el.label, currentUrl)) return false
      }

      // Filter sensitive element labels
      if (SENSITIVE_PATTERNS.test(el.label)) return false

      const selected = selectActionForElement(el, {
        purpose: 'navigation',
        allowFormSubmit: opts.allowFormSubmit,
      })
      if (!selected) return false
      actionByElementId.set(el.id, selected)

      return true
    })

    // Cap at 20 per screen after ranking the most navigation-like targets.
    const candidates = rankNavigationCandidates(navigableElements, scrollSnapshot).slice(0, 20)

    if (DEBUG) {
      console.log(`[navigation] screen ${nodeId} — ${candidates.length} candidates at depth ${depth}`)
    }

    // 6. Interact with each candidate
    for (const el of candidates) {
      if (nodes.size >= opts.maxScreens) break

      const selected = actionByElementId.get(el.id) ?? selectActionForElement(el, {
        purpose: 'navigation',
        allowFormSubmit: opts.allowFormSubmit,
      })
      if (!selected) continue

      // Act on the element using the safest supported action for capture discovery.
      let actResult
      try {
        actResult = await driver.act(el.id, selected.action, selected.value)
      } catch (err) {
        console.warn(`[navigation] act failed for element ${el.id}:`, err)
        continue
      }

      if (!actResult.success) continue

      const newSnapshot = actResult.snapshot ?? await driver.snapshot()
      const newScreenshot = await driver.screenshot()
      const newFp = fingerprint(newSnapshot)
      const newId = screenId(newSnapshot)

      // Dedup by fingerprint
      if (fingerprintToNode.has(newFp)) {
        const existingId = fingerprintToNode.get(newFp)!
        // Add edge if not duplicate
        const edgeExists = edges.some(e => e.from === nodeId && e.to === existingId && e.action.elementId === el.id)
        if (!edgeExists) {
          edges.push({ from: nodeId, to: existingId, action: { elementId: el.id, type: selected.action, label: el.label } })
        }
        // Backtrack
        await backtrack(driver, currentUrl)
        continue
      }

      // Check change significance
      const change = detectChange(currentScreenshot, newScreenshot, currentSnapshot, newSnapshot)
      if (change.score < opts.changeThreshold) {
        // Insignificant change — skip
        await backtrack(driver, currentUrl)
        continue
      }

      // Sensitive content check
      const newSensitive = hasSensitiveContent(newSnapshot)

      const newNode: ScreenNode = {
        id: newId,
        url: newSnapshot.url,
        appName: newSnapshot.appName,
        screenshot: newSensitive ? Buffer.alloc(0) : newScreenshot,
        importance: averageImportance(newSnapshot),
        visited: false,
        sensitiveContent: newSensitive || undefined,
      }

      nodes.set(newId, newNode)
      fingerprintToNode.set(newFp, newId)
      snapshotCache.set(newId, { snapshot: newSnapshot, screenshot: newScreenshot })

      edges.push({ from: nodeId, to: newId, action: { elementId: el.id, type: selected.action, label: el.label } })

      if (depth + 1 < opts.maxDepth) {
        queue.push({ nodeId: newId, depth: depth + 1 })
      }

      // Backtrack to previous screen
      await backtrack(driver, currentUrl)
    }
  }

  const result: NavigationGraph = { nodes, edges, root: rootId }
  // Attach snapshot cache as internal property for discover tool
  ;(result as any)._snapshotCache = snapshotCache
  return result
}

function rankNavigationCandidates(elements: Element[], snapshot: Snapshot): Element[] {
  const scoreById = new Map(scoreElements(snapshot.elements, DEFAULT_VIEWPORT).map(s => [s.elementId, s.score]))
  const originalIndex = new Map(snapshot.elements.map((el, index) => [el.id, index]))

  return [...elements].sort((a, b) => {
    const scoreDelta = navigationScore(b, scoreById) - navigationScore(a, scoreById)
    if (scoreDelta !== 0) return scoreDelta
    return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0)
  })
}

function navigationScore(element: Element, scoreById: Map<string, number>): number {
  const role = normalizeRole(element.role)
  const [x, y, w, h] = element.bounds
  const importance = scoreById.get(element.id) ?? 0
  const roleBonus = role === 'tab' ? 0.35
    : role === 'link' || role === 'menuitem' ? 0.3
    : role === 'button' ? 0.2
    : 0.1
  const navZoneBonus = y <= 160 || x <= 240 ? 0.15 : 0
  const sizePenalty = w * h > 300_000 ? 0.1 : 0
  return importance + roleBonus + navZoneBonus - sizePenalty
}

// ─── Backtrack ───────────────────────────────────────────────

async function backtrack(driver: Driver, previousUrl?: string): Promise<void> {
  if (driver.navigate && previousUrl) {
    await driver.navigate(previousUrl)
  } else if (!driver.navigate) {
    console.warn('[navigation] backtracking not available — driver does not support navigate()')
  }
}

// ─── Discover by Scroll ──────────────────────────────────────

export async function discoverByScroll(
  driver: Driver,
  maxScrolls = 20
): Promise<ScreenNode[]> {
  const discovered: ScreenNode[] = []

  let currentSnapshot = await driver.snapshot()
  let prevElementCount = currentSnapshot.elements.length
  let prevFp = fingerprint(currentSnapshot)
  let noNewCount = 0

  for (let i = 0; i < maxScrolls; i++) {
    // Find a scrollable element to act on, or fall back to first interactive element
    const scrollTarget = currentSnapshot.elements.find(el =>
      el.actions.includes('scroll')
    ) ?? currentSnapshot.elements.find(el => el.actions.length > 0)

    if (!scrollTarget) break

    try {
      await driver.act(scrollTarget.id, 'scroll', '500')
    } catch {
      break
    }

    const newSnapshot = await driver.snapshot()
    const newFp = fingerprint(newSnapshot)

    // Bottom of page — fingerprint unchanged
    if (newFp === prevFp) break

    const newCount = newSnapshot.elements.length
    if (newCount <= prevElementCount) {
      noNewCount++
      if (noNewCount >= 3) break
    } else {
      noNewCount = 0

      // Capture screenshot of newly revealed content
      const screenshot = await driver.screenshot()
      const sensitive = hasSensitiveContent(newSnapshot)

      discovered.push({
        id: screenId(newSnapshot),
        url: newSnapshot.url,
        appName: newSnapshot.appName,
        screenshot: sensitive ? Buffer.alloc(0) : screenshot,
        importance: averageImportance(newSnapshot),
        visited: false,
        sensitiveContent: sensitive || undefined,
      })
    }

    prevElementCount = newCount
    prevFp = newFp
    currentSnapshot = newSnapshot
  }

  return discovered
}
