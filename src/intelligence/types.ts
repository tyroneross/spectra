// ─── Re-exports from core ────────────────────────────────────
import type { Platform, ActionType } from '../core/types.js'

export type { Platform, ActionType }

// ─── Viewport ────────────────────────────────────────────────
export interface Viewport {
  width: number
  height: number
  devicePixelRatio: number
}

// ─── UI State ────────────────────────────────────────────────
export type UIState = 'loading' | 'empty' | 'error' | 'populated' | 'focused' | 'unknown'

// ─── Importance Scoring ──────────────────────────────────────
export interface ImportanceScore {
  elementId: string
  score: number         // 0.0 - 1.0
  factors: ScoreFactor[]
}

export interface ScoreFactor {
  name: string
  weight: number
  value: number
  reason: string
}

// ─── Regions ─────────────────────────────────────────────────
export interface RegionOfInterest {
  bounds: [number, number, number, number]  // x, y, w, h
  score: number
  elements: string[]    // element IDs in this region
  label: string         // human-readable: "Main navigation", "Hero section"
}

// ─── Change Detection ────────────────────────────────────────
export interface ChangeResult {
  changed: boolean
  score: number           // 0.0 (identical) to 1.0 (completely different)
  type: 'none' | 'minor' | 'significant' | 'navigation'
  details: ChangeDetail[]
}

export interface ChangeDetail {
  kind: 'added' | 'removed' | 'moved' | 'changed' | 'content'
  elementId?: string
  description: string
}

// ─── State Detection ─────────────────────────────────────────
export interface StateDetection {
  state: UIState
  confidence: number
  indicators: string[]  // element IDs that signal this state
}

// ─── Navigation Graph ────────────────────────────────────────
export interface NavigationGraph {
  nodes: Map<string, ScreenNode>
  edges: NavigationEdge[]
  root: string
}

export interface ScreenNode {
  id: string              // hash of URL + visible element fingerprint
  url?: string
  appName?: string
  screenshot: Buffer
  importance: number      // average importance score of elements
  visited: boolean
  sensitiveContent?: boolean
}

export interface NavigationEdge {
  from: string
  to: string
  action: { elementId: string; type: ActionType; label: string }
}

// ─── Crawl Options ───────────────────────────────────────────
export interface CrawlOptions {
  maxDepth: number        // default: 3
  maxScreens: number      // default: 50
  scrollDiscover: boolean // default: true
  captureEach: boolean    // default: true
  changeThreshold: number // default: 0.15
  allowExternal: boolean  // default: false
  allowFormSubmit: boolean // default: false
}

// ─── Framing ─────────────────────────────────────────────────
export interface FrameOptions {
  target?: 'element' | 'region' | 'viewport' | 'fullpage'
  elementId?: string
  regionIndex?: number
  aspectRatio?: number    // e.g., 16/9, 4/3, 1 (square)
  padding?: number        // px around target (default: 16)
  minSize?: [number, number]
}

export interface FrameResult {
  crop: [number, number, number, number]  // x, y, w, h
  buffer: Buffer                           // cropped image
  label: string                            // "Settings panel", "Main content"
}

// ─── Capture Intent ──────────────────────────────────────────
export interface CaptureIntent {
  mode: 'auto' | 'targeted' | 'walkthrough' | 'states'
  target?: string         // element ID, region label, or URL
  includeStates?: UIState[]
  maxCaptures?: number
  outputFormat?: 'png' | 'jpeg'
  quality?: number        // 1-100 for jpeg
}

// ─── Capture Manifest ────────────────────────────────────────
export interface CaptureManifest {
  sessionId: string
  captures: CaptureEntry[]
  navigation?: NavigationGraph
  duration: number
}

export interface CaptureEntry {
  path: string
  state: UIState
  importance: number
  region?: string
  framed: boolean
  timestamp: number
  sensitiveContent?: boolean
}
