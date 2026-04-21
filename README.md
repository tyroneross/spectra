# Spectra

Content capture for marketing — screenshots, videos, and app usage sequences for blog posts, social media, and documentation.

Works across **web** (Chrome DevTools Protocol), **macOS** (accessibility bridge), **iOS** and **watchOS** (simulators).

## Install

### Via Claude Code plugin marketplace (recommended)

```
/plugin marketplace add tyroneross/spectra
/plugin install spectra@spectra
```

### Manual install (development / library use)

**Requirements:** Node.js 22+, macOS (for native features), Xcode CLI tools (for Swift compilation)

```bash
git clone https://github.com/tyroneross/spectra.git
cd spectra
npm install
npm run build
```

### Native bridge (macOS/iOS/watchOS automation)

```bash
# Compile the Swift binary to ~/.spectra/bin/spectra-native
npm run build:native

# Optional: compile the SwiftUI test fixture
npm run build:test-app
```

**macOS permissions required:**
- System Settings → Privacy & Security → **Accessibility** — add your terminal app
- System Settings → Privacy & Security → **Screen Recording** — add your terminal app (for video capture)

### Dashboard (web UI)

```bash
cd web-ui
npm install
cd ..
npm run serve    # → http://localhost:4300
```

---

## Claude Code Plugin

Spectra is a Claude Code plugin. Install via the marketplace (see above) or locally for development:

```bash
# From another project, point Claude Code at the Spectra directory
claude --plugin-dir /path/to/spectra
```

Or add to `.claude/settings.json`:

```json
{
  "plugins": ["/path/to/spectra"]
}
```

### Slash Commands

| Command | Purpose |
|---------|---------|
| `/spectra:connect <target>` | Start a capture session |
| `/spectra:walk <description>` | Walk through a flow with natural language |
| `/spectra:capture` | Screenshot current state |
| `/spectra:sessions` | List active sessions |

---

## MCP Tools

### `spectra_connect`

Start a new UI automation session.

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `target` | string | yes | URL, app name, or `sim:device` identifier |
| `name` | string | | Human-readable session name |
| `record` | boolean | | Start video recording immediately |

**Examples:**
```
target: "https://myapp.vercel.app"       → web (CDP)
target: "Finder"                          → macOS native (AX)
target: "sim:iPhone 16 Pro"              → iOS simulator
target: "sim:Apple Watch Series 10"      → watchOS simulator
```

**Returns:** `{ sessionId, platform, target, name }`

---

### `spectra_snapshot`

Get the current accessibility tree snapshot.

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `sessionId` | string | yes | Active session ID |
| `screenshot` | boolean | | Include base64 screenshot |

**Returns:** Serialized AX tree — compact element list with roles, labels, bounds, actions.

---

### `spectra_act`

Perform an action on a specific element.

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `sessionId` | string | yes | Active session ID |
| `elementId` | string | yes | Element ID from snapshot (e.g., `"e4"`) |
| `action` | enum | yes | `click`, `type`, `clear`, `select`, `scroll`, `hover`, `focus` |
| `value` | string | | Text to type or scroll amount in px |

**Returns:** `{ success, snapshot }` — updated snapshot after the action.

---

### `spectra_step`

Natural language navigation — describe what to do, Spectra finds the element and executes.

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `sessionId` | string | yes | Active session ID |
| `intent` | string | yes | What to do, e.g., `"click the Log In button"` |

**Returns:** `{ resolved, elementId, action, confidence, snapshot }` — plus optional screenshot.

Uses the Jaro-Winkler resolution engine to fuzzy-match intents to AX tree elements.

---

### `spectra_capture`

Take a screenshot or manage video recording. Supports intelligent framing modes.

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `sessionId` | string | yes | Active session ID |
| `type` | enum | yes | `screenshot`, `start_recording`, `stop_recording` |
| `mode` | enum | | Capture mode: `full` (default), `element`, `region`, `auto` |
| `elementId` | string | | Target element for `mode=element` |
| `region` | string | | Region label for `mode=region` (e.g., `"Navigation"`, `"Form"`) |
| `aspectRatio` | string | | Output aspect ratio: `"16:9"`, `"4:3"`, `"1:1"` |
| `clean` | boolean | | Apply visual cleanup before capture (default: true) |
| `quality` | enum | | `lossless`, `high`, `medium` |

**Capture modes:**
- **`full`** — standard full-page screenshot
- **`element`** — crops to a single element by ID
- **`region`** — crops to a detected region by label (run `spectra_analyze` first to see available regions)
- **`auto`** — automatically frames the most important content on screen

**Visual cleanup** (`clean: true`):
- Hides scrollbars (web)
- Cleans simulator status bar — 9:41, full battery, full signal (iOS/watchOS)
- Removes cursor artifacts (web)

**Returns:** `{ path, format, crop?, label?, cleanApplied }`

---

### `spectra_analyze`

Score the current screen — element importance, regions of interest, UI state.

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `sessionId` | string | yes | Active session ID |
| `viewport` | object | | `{ width, height, devicePixelRatio }` (default: 1280x800@1x) |

**Returns:**
```json
{
  "state": "populated",
  "stateConfidence": 0.833,
  "regions": [
    { "label": "Navigation", "score": 0.712, "bounds": [0, 0, 1280, 60], "elementCount": 8 },
    { "label": "Form", "score": 0.645, "bounds": [200, 300, 400, 250], "elementCount": 5 }
  ],
  "topElements": [
    { "id": "e3", "role": "heading", "label": "Welcome", "importance": 0.891 },
    { "id": "e7", "role": "button", "label": "Get Started", "importance": 0.856 }
  ],
  "totalElements": 42
}
```

**UI states detected:** `loading`, `error`, `empty`, `populated`, `focused`, `unknown`

**Importance scoring** uses 6 weighted heuristics from UEyes CHI 2023 eye-tracking research:
- Semantic role (30%) — headings, buttons, links score highest
- Position (20%) — top-left bias, above-fold bonus
- Interactivity (15%) — elements with actions
- Label quality (15%) — meaningful text labels
- Content density (10%) — elements surrounded by related content
- Visual prominence (10%) — larger elements score higher

---

### `spectra_discover`

Auto-navigate and capture an entire app. BFS crawls through links, buttons, and tabs — captures and frames each screen.

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `sessionId` | string | yes | Active session ID |
| `maxDepth` | number | | Max navigation depth (default: 3) |
| `maxScreens` | number | | Max screens to discover (default: 50) |
| `captureStates` | boolean | | Also capture loading/error/empty states (default: false) |
| `clean` | boolean | | Apply visual cleanup (default: true) |
| `outputDir` | string | | Custom output directory |

**How it works:**
1. Takes initial screenshot + AX snapshot
2. Scores elements by importance
3. Detects UI state (populated, loading, error, etc.)
4. Auto-frames and saves the best region
5. Finds navigable elements (links, buttons, tabs, menu items)
6. BFS crawls to each, repeating steps 2-4
7. Deduplicates screens by role+label fingerprint (stable across React/Angular)
8. Detects and flags sensitive screens (password fields, API keys)
9. Writes manifest with all captures

**Security:**
- Same-origin only by default
- Never interacts with password/credential fields
- Flags sensitive screens in manifest (skips capture)

**Returns:** `{ screens, captures, sensitive, manifestPath, outputDir }`

**Output:** `{outputDir}/screen-*.png`, `{outputDir}/framed-*.png`, `{outputDir}/manifest.json`

---

### `spectra_session`

Manage active sessions.

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `action` | enum | yes | `list`, `get`, `close`, `close_all` |
| `sessionId` | string | | Required for `get` and `close` |

---

## Library API

Spectra exports a full programmatic API for use by other tools:

### Drivers

```typescript
import { CdpDriver, NativeDriver, SimDriver } from 'spectra'

// Web — Chrome DevTools Protocol
const web = new CdpDriver({ browser: { headless: true } })
await web.connect({ url: 'https://myapp.vercel.app' })
const snap = await web.snapshot()    // → Snapshot { elements, platform, timestamp, metadata }
const buf = await web.screenshot()   // → Buffer (PNG)
await web.navigate('https://myapp.vercel.app/about')
await web.act('e4', 'click')         // → ActResult { success, snapshot }
await web.disconnect()

// macOS — Accessibility bridge
const mac = new NativeDriver()
await mac.connect({ appName: 'Finder' })

// iOS/watchOS — Simulator
const sim = new SimDriver()
await sim.connect({ simulator: 'iPhone 16 Pro' })
```

### Intelligence — Importance Scoring

```typescript
import { scoreElements, findRegions } from 'spectra'
import type { Viewport, ImportanceScore, RegionOfInterest } from 'spectra'

const viewport: Viewport = { width: 1280, height: 800, devicePixelRatio: 2 }
const scores: ImportanceScore[] = scoreElements(snapshot.elements, viewport)
// → [{ elementId: 'e3', score: 0.891, factors: [...] }, ...]

const regions: RegionOfInterest[] = findRegions(scores, snapshot.elements)
// → [{ label: 'Navigation', score: 0.712, bounds: [0,0,1280,60], elements: ['e1','e2',...] }]
```

### Intelligence — Change Detection

```typescript
import { perceptualHash, hashDistance, diffSnapshots, detectChange } from 'spectra'

// Fast visual comparison (dHash — 64-bit gradient hash)
const hash1 = perceptualHash(screenshotBuffer1)  // → bigint
const hash2 = perceptualHash(screenshotBuffer2)
const distance = hashDistance(hash1, hash2)        // → number (0 = identical, >10 = different)

// Semantic comparison (AX tree structural diff)
const diff = diffSnapshots(snapshot1, snapshot2)
// → { changed: true, score: 0.35, type: 'significant', details: [{kind:'added',...}] }

// Combined pipeline: dHash pre-filter → structural diff
const change = detectChange(buf1, buf2, snap1, snap2, 0.15)
// → ChangeResult { changed, score, type, details }
```

### Intelligence — State Detection

```typescript
import { detectState, createStateTriggers } from 'spectra'
import type { UIState, StateDetection, StateTriggerOptions } from 'spectra'

const state: StateDetection = detectState(snapshot)
// → { state: 'populated', confidence: 0.83, indicators: ['e5', 'e8', ...] }

// CDP state triggers — inject loading/error/empty UI for capture
const triggers = createStateTriggers({
  conn: cdpConnection,       // from driver.getConnection()
  sessionId: 'target-id',
  platform: 'web',
})
// → StateTrigger[] — each has trigger() and restore()

for (const t of triggers) {
  await t.trigger()          // inject simulated UI state
  // ... capture screenshot ...
  await t.restore()          // restore original page
}
```

### Intelligence — Smart Framing

```typescript
import { frame, autoFrame } from 'spectra'
import type { FrameOptions, FrameResult } from 'spectra'

// Auto-frame to best content region
const result: FrameResult = frame(screenshotBuffer, scores, elements)
// → { crop: [x, y, w, h], buffer: Buffer, label: 'Navigation' }

// Frame a specific element
const elementFrame = frame(buf, scores, elements, {
  target: 'element',
  elementId: 'e7',
  padding: 16,
  aspectRatio: 16 / 9,
})

// Get multiple crop suggestions
const frames: FrameResult[] = autoFrame(buf, scores, elements)
// → top 5 regions sorted by importance score
```

### Intelligence — Navigation

```typescript
import { crawl, discoverByScroll } from 'spectra'
import type { NavigationGraph, CrawlOptions } from 'spectra'

const graph: NavigationGraph = await crawl(driver, {
  maxDepth: 3,
  maxScreens: 50,
  scrollDiscover: true,
  changeThreshold: 0.15,
  allowExternal: false,
  allowFormSubmit: false,
})
// → { nodes: Map<id, ScreenNode>, edges: NavigationEdge[], root: string }

// Scroll to discover lazy-loaded content
const newScreens = await discoverByScroll(driver, 20)
```

### Media — PNG Codec

Zero-dependency PNG decode/encode built on `node:zlib`:

```typescript
import { decodePng, encodePng, cropImage, resizeNearest, toGrayscale } from 'spectra'
import type { RawImage } from 'spectra'

const raw: RawImage = decodePng(pngBuffer)
// → { width, height, data: Uint8Array (RGBA, 4 bytes/pixel) }

const cropped = cropImage(raw, 100, 50, 400, 300)   // x, y, w, h
const small = resizeNearest(raw, 9, 8)                // nearest-neighbor
const gray: Uint8Array = toGrayscale(raw)             // 1 byte/pixel
const encoded: Buffer = encodePng(cropped)             // → valid PNG buffer
```

### Media — Capture Cleanup

```typescript
import { prepareForCapture, restoreAfterCapture } from 'spectra'
import type { CleanOptions, CleanState } from 'spectra'

// Prepare environment for clean screenshots
const state: CleanState = await prepareForCapture(cdpConnection, sessionId, 'web', {
  hideScrollbars: true,   // Emulation.setScrollbarsHidden
  hideCursor: true,       // CSS injection
  cleanStatusBar: true,   // xcrun simctl status_bar (iOS/watchOS)
  viewport: { width: 1280, height: 800 },
})
// state.applied → ['scrollbars', 'cursor', 'viewport']

// ... take screenshots ...

await restoreAfterCapture(state)  // reverses all cleanup (reverse order, fault-tolerant)
```

### Media — Video Pipeline

```typescript
import { buildCaptureArgs, buildEncodeArgs } from 'spectra'
import type { VideoOptions } from 'spectra'

// Build FFmpeg arguments for lossless capture
const captureArgs = buildCaptureArgs('web', '/tmp/raw.mkv', {
  fps: 60, quality: 'lossless', hardware: false,
})
// → ['-f', 'avfoundation', '-framerate', '60', '-i', '1:none', '-c:v', 'libx264rgb', '-crf', '0', ...]

// Build FFmpeg arguments for optimized encoding
const encodeArgs = buildEncodeArgs('/tmp/raw.mkv', '/tmp/output.mp4', {
  fps: 30, quality: 'high', hardware: true,
})
// → ['-i', '/tmp/raw.mkv', '-c:v', 'h264_videotoolbox', '-b:v', '5M', '-pix_fmt', 'yuv420p', ...]
```

### Resolution Engine

```typescript
import { resolve } from 'spectra'

const result = resolve(snapshot.elements, 'click the submit button', {
  bias: 'spatial',        // 'semantic' | 'spatial'
  threshold: 0.4,
})
// → { elementId: 'e12', confidence: 0.87, method: 'jaro-winkler' }
```

### Session Management

```typescript
import { SessionManager } from 'spectra'

const manager = new SessionManager()
const session = await manager.create({ name: 'my-capture', platform: 'web' })
await manager.addStep(session.id, { intent: 'click login', elementId: 'e3', action: 'click' })
const sessions = manager.list()
```

### Serialization

```typescript
import { serializeSnapshot, serializeElement, normalizeRole } from 'spectra'

const compact = serializeSnapshot(snapshot)   // → compact string representation
const role = normalizeRole('AXButton', 'macos')  // → 'button' (cross-platform)
```

---

## Core Types

```typescript
interface Element {
  id: string
  role: string                              // normalized: 'button', 'link', 'heading', etc.
  label: string
  value: string | null
  enabled: boolean
  focused: boolean
  actions: ActionType[]                     // 'click' | 'type' | 'clear' | 'select' | 'scroll' | 'hover' | 'focus'
  bounds: [number, number, number, number]  // [x, y, width, height]
  parent: string | null
}

interface Snapshot {
  platform: Platform        // 'web' | 'macos' | 'ios' | 'watchos'
  elements: Element[]
  timestamp: number
  metadata: SnapshotMetadata
}

interface Driver {
  connect(target: DriverTarget): Promise<void>
  snapshot(): Promise<Snapshot>
  act(elementId: string, action: ActionType, value?: string): Promise<ActResult>
  screenshot(): Promise<Buffer>
  navigate?(url: string): Promise<void>
  getConnection?(): { conn: unknown; sessionId: string | null }
  close(): Promise<void>
  disconnect(): Promise<void>
}
```

---

## Project Structure

```
spectra/
├── src/
│   ├── core/           # Types, session manager, resolve engine, serialize, normalize
│   ├── cdp/            # Chrome DevTools Protocol (connection, browser, 7 domain wrappers)
│   ├── intelligence/   # Capture optimization
│   │   ├── spatial.ts      # Shared: edgeDistance, regionLabel, boundingBox, clusterElements
│   │   ├── types.ts        # 18 shared interfaces
│   │   ├── importance.ts   # 6-factor element scoring (UEyes CHI 2023)
│   │   ├── change.ts       # dHash perceptual hash + structural diff
│   │   ├── states.ts       # UI state detection + CDP triggers
│   │   ├── framing.ts      # Smart crop with aspect ratio enforcement
│   │   └── navigation.ts   # BFS crawl + scroll discovery
│   ├── mcp/            # MCP server + 8 tool handlers
│   ├── media/          # PNG codec, capture, cleanup, video pipeline
│   └── native/         # Swift bridge, native driver, simulator driver
├── native/swift/       # Swift source for native binary (AXBridge, SimBridge)
├── web-ui/             # Next.js dashboard (browse, manage, export captures)
├── commands/           # Claude Code slash commands
├── skills/             # Claude Code skills
├── tests/              # Vitest test suite (30 files, 329 tests)
├── artifacts/          # Capture output (gitignored)
└── .spectra/           # Session data, playbooks, archive (gitignored)
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run build:native` | Compile Swift binary |
| `npm run build:test-app` | Compile SwiftUI test fixture |
| `npm test` | Run all tests (Vitest) |
| `npm run serve` | Launch dashboard at localhost:4300 |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SPECTRA_DEBUG` | Set to `1` for verbose debug logging in navigation and discovery |

## Platforms

| Platform | Driver | Target Format | Features |
|----------|--------|---------------|----------|
| Web | `CdpDriver` | Any URL | Full CDP: screenshot, navigate, act, state triggers, cleanup |
| macOS | `NativeDriver` | App name (e.g., `"Finder"`) | AX tree, actions, screenshot via native bridge |
| iOS | `SimDriver` | `sim:iPhone 16 Pro` | Simulator AX, screenshot, status bar cleanup |
| watchOS | `SimDriver` | `sim:Apple Watch Series 10` | Simulator AX, screenshot, Digital Crown |

## Codex

This package now ships an additive Codex plugin surface alongside the existing Claude Code package. The Claude package remains authoritative for Claude behavior; the Codex package adds a parallel `.codex-plugin/plugin.json` install surface without changing the Claude runtime.

Package root for Codex installs:
- the repository root (`.`)

Primary Codex surface:
- skills from `./skills` when present
- MCP config from `inline `mcpServers` metadata` when present

Install the package from this package root using your current Codex plugin install flow. The Codex package is additive only: Claude-specific hooks, slash commands, and agent wiring remain unchanged for Claude Code.

