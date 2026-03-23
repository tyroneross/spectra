# Spectra Capture Optimization — Design Spec

**Date**: 2026-03-23
**Status**: Draft
**Goal**: Transform Spectra from "capture what I point at" to "intelligently capture what matters" — seamless across web, macOS, iOS, and watchOS.

---

## 1. Problem Statement

Spectra currently captures screenshots and records sessions, but the capture is **dumb** — it takes whatever is on screen with no understanding of what's important, when the screen has meaningfully changed, or how to navigate through an app to find all the interesting states. The user (Claude Code) has to manually direct every step.

**Target state**: Spectra intelligently scores what matters on screen, detects meaningful changes, navigates apps to discover content, crops to focus areas, captures all UI states (loading/error/empty/populated), and produces marketing-ready output — all cross-platform.

---

## 2. Architecture Overview

Seven new modules plus a shared image utility, each independent with clean interfaces:

```
src/
├── core/
│   └── types.ts           # MODIFIED: add navigate() to Driver interface
├── media/
│   ├── png.ts             # NEW: minimal PNG decode/encode (zlib-based, ~300 LOC)
│   ├── capture.ts         # Enhanced: element-level + region capture
│   ├── pipeline.ts        # NEW: lossless-then-encode video pipeline
│   ├── ffmpeg.ts          # Enhanced: hardware accel, CRF control
│   ├── recorder.ts        # Enhanced: platform-aware recording
│   └── clean.ts           # NEW: status bar cleanup, chrome removal
├── intelligence/
│   ├── importance.ts      # Element importance scoring using AX metadata
│   ├── change.ts          # Perceptual change detection (dHash + structural diff)
│   ├── navigation.ts      # App navigation graph + BFS crawler
│   ├── framing.ts         # Smart crop / framing for captures
│   ├── states.ts          # UI state detection and triggering
│   └── types.ts           # Shared types for intelligence module
```

**Dependency flow**: intelligence modules consume `Element[]` and `Snapshot` from core types. Media modules consume intelligence output (regions, scores, crop rects). `src/media/png.ts` is the shared image utility used by both change detection and framing. No circular deps. No new external dependencies — everything built from scratch using Node.js built-ins + existing AX/CDP infrastructure.

**Core type change**: `Driver` interface gains an optional `navigate?(url: string): Promise<void>` method. This is additive (optional method) — existing drivers that don't implement it won't break. `CdpDriver` already has `navigate()` as a concrete method, so it automatically satisfies the interface.

---

## 3. Module Designs

### 3.1 Importance Scoring (`src/intelligence/importance.ts`)

Scores each `Element` in a snapshot by how important it is for content capture. Uses the AX metadata Spectra already has — no vision model needed.

**Scoring heuristics** (from UEyes CHI 2023 research):

| Signal | Weight | Source |
|--------|--------|--------|
| Semantic role (button, link, heading, image) | 0.30 | `element.role` |
| Position — top-left bias, above-fold | 0.20 | `element.bounds` |
| Interactivity (has actions) | 0.15 | `element.actions.length` |
| Label quality (has meaningful text) | 0.15 | `element.label` |
| Content density (element count in spatial region) | 0.10 | spatial clustering of `elements[]` by bounds proximity |
| Visual prominence (large bounds area) | 0.10 | `element.bounds` area |

```typescript
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

export interface RegionOfInterest {
  bounds: [number, number, number, number]
  score: number
  elements: string[]    // element IDs in this region
  label: string         // human-readable: "Main navigation", "Hero section"
}

export function scoreElements(elements: Element[], viewport: Viewport): ImportanceScore[]
export function findRegions(scores: ImportanceScore[], elements: Element[]): RegionOfInterest[]
```

**Key design decisions**:
- Role weights are configurable per-platform (web heading hierarchy differs from macOS menu bar)
- "Above fold" is computed from viewport dimensions passed as param
- Regions are computed by spatial clustering of high-scoring elements (connected components within 20px)
- No ML, no Python, no external dependencies — pure TypeScript heuristics

### 3.2 Minimal PNG Codec (`src/media/png.ts`)

Shared image utility used by both change detection and framing. **~300 LOC, its own implementation unit with dedicated tests.**

**Decode** (PNG buffer → raw RGBA pixels):
1. Parse PNG chunks (IHDR, IDAT, IEND)
2. Inflate concatenated IDAT data using `node:zlib` (built-in)
3. Reconstruct filter bytes per row (None, Sub, Up, Average, Paeth)
4. Output: `{ width, height, data: Uint8Array }` (RGBA, 4 bytes/pixel)

**Encode** (raw RGBA pixels → PNG buffer):
1. Apply filter bytes per row (use Sub filter — simplest, good compression)
2. Deflate with `node:zlib`
3. Write IHDR + IDAT + IEND chunks with CRC32
4. Output: `Buffer` (valid PNG)

**Scope constraints**:
- Supports non-interlaced RGBA (color type 6) and RGB (color type 2) only — sufficient for CDP screenshots and simulator output
- No Adam7 interlacing support (not needed — CDP/simctl output non-interlaced)
- No indexed color, grayscale-only, or 16-bit depth

```typescript
export interface RawImage {
  width: number
  height: number
  data: Uint8Array    // RGBA, 4 bytes per pixel
}

export function decodePng(buffer: Buffer): RawImage
export function encodePng(image: RawImage): Buffer
export function cropImage(image: RawImage, x: number, y: number, w: number, h: number): RawImage
export function resizeNearest(image: RawImage, targetW: number, targetH: number): RawImage
export function toGrayscale(image: RawImage): Uint8Array  // 1 byte per pixel
```

### 3.3 Change Detection (`src/intelligence/change.ts`)

Answers: "Has the screen changed enough to warrant a new capture?"

**Two-tier approach**:

1. **Fast path — dHash (difference hash)**: Generate a 64-bit hash from image gradient patterns. Hamming distance < 5 = "same screen, skip capture." O(1) comparison. Uses `decodePng` + `resizeNearest` + `toGrayscale` from `src/media/png.ts`.

2. **Semantic path — Structural diff**: Compare two `Snapshot.elements[]` arrays. Detect additions, removals, role/label changes, position shifts. Small position shifts (< 5px) = noise. Element appearing/disappearing = meaningful.

**Important**: All image analysis paths require PNG input. Screenshots must be taken as PNG (not JPEG) before feeding into dHash or framing. The `CaptureIntent.outputFormat` setting only affects final output — internal analysis always uses PNG.

```typescript
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

// Fast visual comparison (PNG buffer → PNG buffer)
export function perceptualHash(pngBuffer: Buffer): bigint
export function hashDistance(a: bigint, b: bigint): number

// Semantic comparison (snapshot → snapshot)
export function diffSnapshots(before: Snapshot, after: Snapshot): ChangeResult

// Combined: visual pre-filter then semantic analysis
export function detectChange(
  beforeBuffer: Buffer, afterBuffer: Buffer,
  beforeSnap: Snapshot, afterSnap: Snapshot,
  threshold?: number
): ChangeResult
```

**dHash implementation** (built from scratch, ~20 LOC using png.ts):
1. Decode PNG → RawImage via `decodePng()`
2. Resize to 9x8 via `resizeNearest()`
3. Convert to grayscale via `toGrayscale()`
4. Compare adjacent horizontal pixels: left > right = 1, else 0
5. Pack 64 bits into a BigInt
6. Hamming distance = popcount(a XOR b)

### 3.4 Navigation Engine (`src/intelligence/navigation.ts`)

Discovers and traverses all reachable screens/states in an app.

**For web (CDP)**:
- Parse AX snapshot for navigable elements: links (`role: link`), buttons, tabs, menu items
- Build a graph: current URL/state → element → resulting URL/state
- BFS traversal with visited-state deduplication (state = URL + fingerprint of role+label pairs, NOT element IDs which are dynamic in React/Angular)
- Scroll-to-discover: scroll viewport by 80% height, wait for stable tree, check for new elements
- Max depth configurable (default: 3 levels from start)

**For macOS (native)**:
- Parse AX tree for interactive elements with navigation-like roles
- Focus on menu bar items, tab groups, sidebar items, toolbar buttons
- Navigate by performing actions, snapshot after each, backtrack via undo or re-navigate

**For iOS/watchOS (simulator)**:
- Parse simulated AX tree for tappable elements
- Navigate by simulating taps, swipes (Digital Crown scroll for watchOS)
- Backtrack via simulated back gesture or re-launch

```typescript
export interface NavigationGraph {
  nodes: Map<string, ScreenNode>
  edges: NavigationEdge[]
  root: string
}

export interface ScreenNode {
  id: string              // hash of URL + visible element fingerprint
  url?: string
  snapshot: Snapshot
  screenshot: Buffer
  importance: number      // average importance score of elements
  visited: boolean
}

export interface NavigationEdge {
  from: string
  to: string
  action: { elementId: string; type: ActionType; label: string }
}

export interface CrawlOptions {
  maxDepth: number        // default: 3
  maxScreens: number      // default: 50
  scrollDiscover: boolean // default: true
  captureEach: boolean    // default: true
  changeThreshold: number // default: 0.15
}

export async function crawl(driver: Driver, options?: CrawlOptions): Promise<NavigationGraph>
export async function discoverByScroll(driver: Driver, maxScrolls?: number): Promise<ScreenNode[]>
```

**Web backtracking**: After visiting a link/screen, backtrack by calling `driver.navigate(previousUrl)` (uses the optional `navigate()` on the Driver interface). If `navigate()` is not available (native/sim), backtrack by re-performing the inverse action or restarting from the root.

**Scroll termination**: `discoverByScroll` exits when: (a) no new elements detected after 3 consecutive scrolls, OR (b) `maxScrolls` reached (default: 20), OR (c) scroll position doesn't change (bottom of page).

**Security**:
- Navigation sandboxed to connected target — same-origin only by default
- `CrawlOptions.allowExternal: boolean` (default: false) to opt-in to cross-origin links
- `CrawlOptions.allowFormSubmit: boolean` (default: false) — explicit opt-in for form interaction
- Password fields detected: if any element has `role: textbox` with label matching /password|secret|token/i, that screen is flagged in the manifest as `sensitiveContent: true` and capture is skipped by default
- No credential input ever — even with `allowFormSubmit`, password-type fields are never interacted with

### 3.5 Smart Framing (`src/intelligence/framing.ts`)

Crops captures to focus on the important content, removing chrome/whitespace.

**Approach**: Given a screenshot buffer + importance scores + regions of interest, compute the optimal crop rectangle.

```typescript
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

export function frame(
  screenshot: Buffer,
  scores: ImportanceScore[],
  elements: Element[],
  options?: FrameOptions
): FrameResult

export function autoFrame(
  screenshot: Buffer,
  scores: ImportanceScore[],
  elements: Element[],
): FrameResult[]  // returns top-N best crops
```

**Crop algorithm**:
1. Find regions of interest from importance scores
2. For each target region, expand bounds by padding
3. If aspect ratio specified, expand minimally to fit ratio while keeping region centered
4. Crop raw pixels via `cropImage()` from `src/media/png.ts`
5. Re-encode cropped region via `encodePng()` from `src/media/png.ts`

**Platform-specific framing**:
- Web: Can also use CDP `clip` parameter for server-side element capture (no decode needed)
- macOS: Use `CGWindowListCreateImage` with bounds rect via native bridge
- iOS/watchOS: Crop from `simctl io screenshot` output

### 3.6 State Detection (`src/intelligence/states.ts`)

Detects and triggers different UI states for comprehensive capture.

**Detectable states** (from AX tree analysis):

| State | Detection method |
|-------|-----------------|
| Loading | Elements with role "progressbar", "busy", labels containing "loading", "spinner" |
| Empty | Few content elements, presence of "empty", "no items", "get started" labels |
| Error | Elements with "error", "failed", "alert" roles or labels |
| Populated | Content elements present, no loading indicators |
| Focused | `element.focused === true` on an interactive element |

**For web (CDP) — state triggering**:
- **Error state**: Intercept network via `Fetch.enable`, return 500 for API calls
- **Loading state**: Throttle network via `Network.emulateNetworkConditions`
- **Empty state**: Execute JS to clear content containers
- **Hover/Focus**: Use Input domain (already exists in CdpDriver)

```typescript
export type UIState = 'loading' | 'empty' | 'error' | 'populated' | 'focused' | 'unknown'

export interface StateDetection {
  state: UIState
  confidence: number
  indicators: string[]  // element IDs that signal this state
}

export interface StateTrigger {
  state: UIState
  platform: Platform
  trigger: () => Promise<void>
  restore: () => Promise<void>
}

export function detectState(snapshot: Snapshot): StateDetection
export function createStateTriggers(driver: Driver, platform: Platform): StateTrigger[]
```

**Restore failure handling**: Each `StateTrigger.restore()` is wrapped in try/catch. On failure, the trigger is marked as `failed` and the session context logs the failure. The driver is left in its current state — subsequent captures will see the unrestored state, which is detectable via `detectState()`. No cascading failures.

**Ordering with clean.ts**: `prepareForCapture()` (from clean.ts) runs FIRST (cosmetic: scrollbars, status bar, cursor). State triggers run SECOND (functional: network, DOM). Restore is reverse order. This is enforced in the `spectra_discover` orchestrator, not in the modules themselves.

**CSP-aware fallback**: If JS execution fails (CSP blocks inline scripts), the empty-state trigger falls back to network interception — returning empty JSON arrays for API responses instead of DOM manipulation.

**Security**: State triggering only works in the connected session. Network interception is scoped to the page session. JS execution is sandboxed to the page context via `Runtime.evaluate` — never raw `eval()`. No system-level changes.

### 3.7 Intelligence Types (`src/intelligence/types.ts`)

Shared types across intelligence modules.

```typescript
export interface Viewport {
  width: number
  height: number
  devicePixelRatio: number
}

export interface CaptureIntent {
  mode: 'auto' | 'targeted' | 'walkthrough' | 'states'
  target?: string         // element ID, region label, or URL
  includeStates?: UIState[]
  maxCaptures?: number
  outputFormat?: 'png' | 'jpeg'
  quality?: number        // 1-100 for jpeg
}

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
}
```

---

## 4. Enhanced Media Pipeline

### 4.1 Enhanced Screenshot (`src/media/capture.ts`)

Extend existing `screenshot()` to support:
- Element-level capture (CDP `clip` param or native bounds crop)
- Region capture (from importance scoring)
- Device pixel ratio awareness (retina output)
- Format selection (PNG for quality, JPEG for size)

### 4.2 Video Pipeline (`src/media/pipeline.ts`)

Two-phase video capture:

1. **Capture phase**: Lossless recording at native resolution
   - Web: CDP `Page.startScreencast` or FFmpeg window capture
   - macOS: ScreenCaptureKit via native bridge (or FFmpeg avfoundation)
   - iOS/watchOS: `xcrun simctl io recordVideo`

2. **Encode phase**: Re-encode for distribution
   - Hardware acceleration: `h264_videotoolbox` on macOS
   - CRF 20 for quality, CRF 28 for size
   - 60fps for animations, 30fps for static UI
   - `yuv420p` pixel format for compatibility

```typescript
export interface VideoOptions {
  fps: 30 | 60
  quality: 'lossless' | 'high' | 'medium'
  hardware: boolean       // use VideoToolbox
  maxDuration?: number    // seconds, safety limit
}

export interface VideoResult {
  path: string
  duration: number
  size: number
  codec: string
}
```

### 4.3 Cleanup (`src/media/clean.ts`)

Professional capture polish:

- **Simulator status bar**: `xcrun simctl status_bar` — set 9:41, full battery, full signal before capture
- **Scrollbar hiding**: CDP `Emulation.setScrollbarsHidden(true)` before web captures
- **Cursor removal**: Ensure no cursor artifacts in screenshots
- **Viewport normalization**: Standard viewport sizes for consistent output

```typescript
export interface CleanOptions {
  hideScrollbars?: boolean
  cleanStatusBar?: boolean
  hideCursor?: boolean
  viewport?: { width: number; height: number }
}

export async function prepareForCapture(driver: Driver, platform: Platform, options?: CleanOptions): Promise<void>
export async function restoreAfterCapture(driver: Driver, platform: Platform): Promise<void>
```

---

## 5. MCP Tool Enhancements

### 5.1 Enhanced `spectra_capture`

Add intelligence-powered capture modes:

```typescript
// New params
interface CaptureParams {
  sessionId: string
  type: 'screenshot' | 'start_recording' | 'stop_recording'
  // NEW:
  mode?: 'full' | 'element' | 'region' | 'auto'
  elementId?: string
  region?: string         // region label from importance scoring
  aspectRatio?: string    // "16:9", "4:3", "1:1"
  clean?: boolean         // apply cleanup (hide scrollbars, etc)
  quality?: 'lossless' | 'high' | 'medium'
}
```

### 5.2 New `spectra_discover`

Auto-navigate and capture an entire app. This is the main orchestrator.

```typescript
interface DiscoverParams {
  sessionId: string
  maxDepth?: number
  maxScreens?: number
  captureStates?: boolean   // also capture loading/error/empty states
  outputDir?: string
}

interface DiscoverResult {
  screens: number
  captures: number
  manifest: CaptureManifest
  sensitive: string[]       // URLs/screens flagged as containing credentials
}
```

**Orchestration sequence** (pseudocode):

```
1. Get driver + session from context
2. Take initial snapshot + screenshot
3. prepareForCapture(driver, platform)     ← clean.ts (cosmetic)
4. scoreElements(snapshot.elements, viewport) ← importance.ts
5. detectState(snapshot)                    ← states.ts
6. frame(screenshot, scores, elements)      ← framing.ts (auto-crop)
7. Save capture entry to manifest

8. IF captureStates:
   a. triggers = createStateTriggers(driver, platform)
   b. FOR each trigger:
      - trigger.trigger()
      - Wait for stable tree
      - Capture + score + frame
      - trigger.restore() (wrapped in try/catch)
      - Save capture entry

9. graph = crawl(driver, { maxDepth, maxScreens })  ← navigation.ts
   (crawl internally: for each new screen node)
   a. detectChange(prev, current)           ← change.ts
   b. IF changed: score + detect state + frame + capture
   c. IF captureStates: trigger state variants
   d. Add to manifest

10. restoreAfterCapture(driver, platform)   ← clean.ts (restore)
11. Return manifest with all captures
```

### 5.3 New `spectra_analyze`

Score the current screen and identify regions of interest:

```typescript
interface AnalyzeParams {
  sessionId: string
}

interface AnalyzeResult {
  state: UIState
  regions: Array<{
    label: string
    score: number
    bounds: [number, number, number, number]
    elements: number
  }>
  topElements: Array<{
    id: string
    role: string
    label: string
    importance: number
  }>
}
```

---

## 6. Security

| Concern | Mitigation |
|---------|-----------|
| Navigation follows external links | URL allowlist, same-origin only by default |
| State triggers execute JS | Sandboxed to page context, no `eval` of user strings |
| Network interception | Scoped to CDP session, no system proxy changes |
| File system writes | All output goes to `.spectra/` or configured `artifacts/` directory |
| Credential exposure | Screenshots may capture sensitive data — warn in MCP tool response |
| Video recording duration | Max duration limit (default 5 min) to prevent runaway recording |
| Native bridge commands | Allowlisted command set, no arbitrary shell execution |
| Simulator state changes | Status bar overrides restored after capture |

---

## 7. Testing Strategy

Each module gets its own test file with unit tests using Vitest. Integration tests use mock drivers.

| Module | Test approach |
|--------|--------------|
| importance.ts | Unit: score known element arrays, verify role/position weights |
| change.ts | Unit: dHash known images, structural diff known snapshots |
| navigation.ts | Integration: mock driver returns scripted snapshots per action |
| framing.ts | Unit: crop rect computation for known element layouts |
| states.ts | Unit: detect state from known snapshot patterns |
| pipeline.ts | Integration: verify ffmpeg command construction (skip actual encode in CI) |
| clean.ts | Unit: verify CDP commands issued for cleanup |
| MCP tools | Integration: full tool handler with mock driver |

---

## 8. Implementation Order

Designed for parallel subagent execution with clear dependency boundaries:

**Chunk 1 — Foundation** (no dependencies, fully parallel):
1. `src/core/types.ts` — add optional `navigate?()` to Driver interface
2. `src/intelligence/types.ts` — shared intelligence types
3. `src/media/png.ts` + tests — minimal PNG decode/encode/crop/resize (~300 LOC)
4. `src/intelligence/importance.ts` + tests — element scoring

**Chunk 2 — Detection** (depends on Chunk 1 png.ts + types):
5. `src/intelligence/change.ts` + tests — dHash + structural diff
6. `src/intelligence/states.ts` + tests — state detection
7. `src/intelligence/framing.ts` + tests — smart crop (uses png.ts)

**Chunk 3 — Navigation & Media** (depends on Chunks 1-2):
8. `src/intelligence/navigation.ts` + tests — crawl engine (uses change detection)
9. `src/media/clean.ts` + tests — capture cleanup
10. `src/media/pipeline.ts` + tests — video pipeline
11. Enhanced `src/media/capture.ts` — element/region capture, CDP clip support
12. Enhanced `src/cdp/page.ts` — add `clip` param to `screenshot()`

**Chunk 4 — MCP Integration** (depends on all above):
13. Enhanced `spectra_capture` tool
14. New `spectra_discover` tool + tests (orchestrator)
15. New `spectra_analyze` tool + tests
16. Export new types from `src/index.ts`

---

## 9. What This Does NOT Include

- No external ML models or Python dependencies
- No cloud services or API calls
- No breaking changes to existing MCP tools (new params are all optional)
- No new npm dependencies (everything built from Node.js built-ins + existing deps)
- One additive core type change: optional `navigate?()` on `Driver` interface (non-breaking)
