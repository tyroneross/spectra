// src/mcp/tools/discover.ts
import type { ToolContext } from '../context.js'
import { crawl } from '../../intelligence/navigation.js'
import { scoreElements } from '../../intelligence/importance.js'
import { detectState, createStateTriggers } from '../../intelligence/states.js'
import { frame } from '../../intelligence/framing.js'
import { prepareForCapture, restoreAfterCapture } from '../../media/clean.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getStoragePath } from '../../core/storage.js'
import type { CaptureManifest, CaptureEntry, Viewport, NavigationGraph } from '../../intelligence/types.js'

// ─── Debug ────────────────────────────────────────────────────

const DEBUG = process.env.SPECTRA_DEBUG === '1'

// ─── Types ────────────────────────────────────────────────────

export interface DiscoverParams {
  sessionId: string
  maxDepth?: number        // default: 3
  maxScreens?: number      // default: 50
  captureStates?: boolean  // default: false
  clean?: boolean          // default: true — apply cleanup before capture
  outputDir?: string       // default: .spectra/sessions/{sessionId}/discover
}

export interface DiscoverResult {
  screens: number
  captures: number
  sensitive: string[]      // node IDs flagged as sensitive
  manifestPath: string
  outputDir: string
}

// ─── Handler ─────────────────────────────────────────────────

export async function handleDiscover(params: DiscoverParams, ctx: ToolContext): Promise<DiscoverResult> {
  const driver = ctx.drivers.get(params.sessionId)
  if (!driver) throw new Error(`Session ${params.sessionId} not found`)

  const session = ctx.sessions.get(params.sessionId)
  const platform = session?.platform ?? 'web'
  const startTime = Date.now()

  // Setup output directory
  const outputDir = params.outputDir ?? join(getStoragePath(), 'sessions', params.sessionId, 'discover')
  await mkdir(outputDir, { recursive: true })

  // Extract CDP connection if the driver exposes one
  const connection = driver.getConnection?.()
  const conn = (connection?.conn ?? null) as import('../../cdp/connection.js').CdpConnection | null
  const driverSessionId = connection?.sessionId ?? null

  // Prepare for clean capture (optional)
  let cleanState = null
  if (params.clean !== false) {
    cleanState = await prepareForCapture(conn, driverSessionId, platform)
  }

  // Default viewport for scoring
  const viewport: Viewport = { width: 1280, height: 800, devicePixelRatio: 1 }

  if (DEBUG) {
    console.log(`[discover] starting crawl for session ${params.sessionId}, platform=${platform}`)
  }

  // Run the navigation crawl
  const graph = await crawl(driver, {
    maxDepth: params.maxDepth ?? 3,
    maxScreens: params.maxScreens ?? 50,
    scrollDiscover: true,
    captureEach: true,
    changeThreshold: 0.15,
    allowExternal: false,
    allowFormSubmit: false,
  })

  // Process each discovered screen
  const captures: CaptureEntry[] = []
  const sensitive: string[] = []

  // Access crawl's snapshot cache for correct per-screen scoring
  const snapshotCache = (graph as any)._snapshotCache as Map<string, { snapshot: import('../../core/types.js').Snapshot; screenshot: Buffer }> | undefined

  for (const [nodeId, node] of graph.nodes) {
    // Track sensitive screens
    if (node.sensitiveContent) {
      sensitive.push(nodeId)
      continue // Skip capture for sensitive screens
    }

    // Use the cached snapshot from crawl (correct screen) instead of re-snapshotting
    const cached = snapshotCache?.get(nodeId)
    const snapshot = cached?.snapshot ?? await driver.snapshot()
    const scores = scoreElements(snapshot.elements, viewport)
    const state = detectState(snapshot)

    if (DEBUG) {
      console.log(`[discover] processing screen ${nodeId}, state=${state.state}, scores=${scores.length}`)
    }

    // Save full screenshot
    if (node.screenshot.length > 0) {
      const filename = `screen-${nodeId.replace(/[^a-z0-9]/gi, '_')}.png`
      const path = join(outputDir, filename)
      await writeFile(path, node.screenshot)
      captures.push({
        path,
        state: state.state,
        importance: scores.length > 0 ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length : 0,
        framed: false,
        timestamp: Date.now(),
      })
    }

    // Auto-frame best regions
    if (node.screenshot.length > 0 && scores.length > 0) {
      try {
        const framed = frame(node.screenshot, scores, snapshot.elements)
        const framedFilename = `framed-${nodeId.replace(/[^a-z0-9]/gi, '_')}.png`
        const framedPath = join(outputDir, framedFilename)
        await writeFile(framedPath, framed.buffer)
        captures.push({
          path: framedPath,
          state: state.state,
          importance: scores.length > 0 ? scores[0].score : 0,
          region: framed.label,
          framed: true,
          timestamp: Date.now(),
        })
      } catch {
        // Framing can fail on very small screenshots — skip silently
      }
    }
  }

  // State triggers — use CDP connection when available for real state injection
  if (params.captureStates) {
    const triggers = createStateTriggers({ conn, sessionId: driverSessionId, platform })
    for (const trigger of triggers) {
      try {
        await trigger.trigger()
        const snapshot = await driver.snapshot()
        const state = detectState(snapshot)
        if (DEBUG) {
          console.log(`[discover] state trigger: ${trigger.state}, detected=${state.state}`)
        }
        await trigger.restore()
      } catch {
        // Best-effort — don't abort the crawl if a trigger fails
      }
    }
  }

  // Restore cleanup
  if (cleanState) {
    await restoreAfterCapture(cleanState)
  }

  // Build manifest
  const manifest: CaptureManifest = {
    sessionId: params.sessionId,
    captures,
    navigation: graph,
    duration: Date.now() - startTime,
  }

  // Save manifest — NavigationGraph has Map fields, serialize to plain objects
  const manifestPath = join(outputDir, 'manifest.json')
  const serializable = {
    ...manifest,
    navigation: manifest.navigation ? {
      nodes: Object.fromEntries(
        Array.from(manifest.navigation.nodes).map(([k, v]) => [k, { ...v, screenshot: undefined }])
      ),
      edges: manifest.navigation.edges,
      root: manifest.navigation.root,
    } : undefined,
  }
  await writeFile(manifestPath, JSON.stringify(serializable, null, 2))

  if (DEBUG) {
    console.log(`[discover] complete: ${graph.nodes.size} screens, ${captures.length} captures, ${sensitive.length} sensitive`)
  }

  return {
    screens: graph.nodes.size,
    captures: captures.length,
    sensitive,
    manifestPath,
    outputDir,
  }
}
