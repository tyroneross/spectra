# Spectra — AI-Native UI Automation Engine

## Overview

Spectra is a standalone UI automation engine built from scratch for LLM-driven interaction. It replaces Playwright/Puppeteer with an AI-native alternative where the accessibility tree is the primary state representation, Claude is the primary resolution engine, and a unified element format works identically across web, macOS, iOS simulator, and watchOS simulator.

Distributed as a Claude Code plugin with library exports for programmatic consumption by other tools (Showcase, etc.).

## Problem

No single automation tool handles web + native macOS + iOS/watchOS simulator in one API. Existing tools (Playwright, Puppeteer) were designed for test engineers writing selectors, not for LLMs reasoning about UI. Their state representations (full DOM) waste tokens, their APIs (locator chains) don't map to natural language, and they only work on web.

## Goals

- Single API to automate web apps, macOS apps, iOS simulators, and watchOS simulators
- AI-native: AX tree as primary state (~200 tokens per page vs ~50K for DOM), intent-based actions
- Three interaction modes: deterministic (selector), guided (natural language step), described flow (multi-step narrative)
- Stateful sessions with snapshots, screenshots, and video capture
- Custom CDP client built for AI consumption, not test assertion
- Claude Code plugin with MCP tools, slash commands, and library exports

## Non-Goals (Phase 1)

- Session replay (designed for, not built — Phase 2)
- Android support
- Remote device automation
- Cross-browser support (Chromium only via CDP)
- Test runner / assertion framework
- Self-healing selectors (Phase 2, pairs with replay)

---

## Architecture

### Single Package, Clean Internal Boundaries

One `package.json`, one build. Internal modules separated by directory with clean import boundaries. Extract to separate packages later when modules are mature.

```
spectra/
├── src/
│   ├── core/           # Session manager, state representation, resolution engine, flow planner
│   ├── cdp/            # Custom CDP client (WebSocket, browser lifecycle, domain bindings)
│   ├── native/         # TypeScript bridge to persistent Swift subprocess
│   ├── media/          # Screenshot, video, transcode (ffmpeg)
│   └── mcp/            # MCP server, tool handlers
├── native/
│   └── swift/          # Swift CLI source → compiled to spectra-native binary
├── commands/           # Slash commands (connect, walk, capture, sessions)
├── skills/             # Plugin skills
├── plugin.json         # Claude Code plugin manifest
├── package.json
└── tsconfig.json
```

### Dependency Direction

```
mcp/ → core/ → cdp/ | native/
mcp/ → media/
core/ → media/
cdp/ → nothing (standalone)
native/ → nothing (standalone)
media/ → nothing (ffmpeg external)
```

No circular dependencies. Leaf modules (cdp, native, media) have zero internal imports.

### Platform Drivers

Both `cdp/` and `native/` implement a shared `Driver` interface:

```typescript
interface Driver {
  connect(target: DriverTarget): Promise<void>
  snapshot(): Promise<Snapshot>
  act(elementId: string, action: Action): Promise<ActResult>
  screenshot(): Promise<Buffer>
  startRecording(): Promise<RecordHandle>
  close(): Promise<void>
}
```

Core doesn't know which driver it's using. It receives a Driver, calls snapshot/act, and works with the unified element format.

---

## Core Module

### Session Manager

A session is a stateful connection to a target (browser tab, macOS app, simulator device) that tracks every action and its result.

**Session lifecycle:** create → connect → [step, step, step...] → close

**Per-step data:**
- Action taken (click, type, navigate, scroll, etc.)
- Target element (id, role, label, selector)
- AX tree snapshot (full element list, pre-action and post-action)
- Screenshot (PNG)
- Timestamp, duration, success/failure

**Per-session data:**
- Session ID (nanoid), human-readable name
- Target (URL, app name, device identifier)
- Platform (web, macos, ios, watchos)
- All steps in order
- Video recording path (if enabled)
- Created/updated timestamps

**Storage:**
- Project context: `.spectra/sessions/<session-id>/`
- No project context: `~/.spectra/sessions/<session-id>/`
- Detection: walk up from cwd looking for `.git`, `package.json`, or `.spectra/`. If found, use project path. Otherwise global.

**Session file structure:**
```
.spectra/sessions/login-walkthrough/
├── session.json        # Metadata + step history
├── step-001.png
├── step-002.png
├── step-003.png
├── recording.mp4       # Optional video
└── snapshots/
    ├── step-001.json   # AX tree at step 1
    ├── step-002.json   # AX tree at step 2
    └── step-003.json
```

**Replay readiness (Phase 2):** The session.json format stores enough data (element selectors, action types, input values) that a future replay engine can re-execute the session deterministically without an LLM.

### Resolution Engine

Two-path element resolution:

**Path 1 — Claude resolution (Claude Code context):**
The MCP tool returns the compact AX snapshot to Claude. Claude reads the element list, identifies the target, and calls `spectra_act` with the element ID. Resolution happens in Claude's existing inference — zero extra API calls.

**Path 2 — Algorithmic resolution (library context, Phase 3):**
For programmatic consumers without an LLM in the loop. Deferred to Phase 3 alongside library exports. Phase 1 only implements the Claude resolution path. The interface below supports both paths — Phase 1 implements `claude` mode only, Phase 3 adds `algorithmic` mode with:
1. **Role filter** — match "button" against element roles, eliminate non-matches
2. **Label similarity** — Jaro-Winkler distance between intent text and element labels
3. **Spatial hints** — parse positional language ("top", "first", "next to X")
4. Score = weighted combination. Threshold > 0.7 → execute. Below 0.7 → throw ambiguity error with ranked candidates.

**Interface:**
```typescript
interface ResolveOptions {
  intent: string
  elements: Element[]
  mode: 'claude' | 'algorithmic'
}

interface ResolveResult {
  element: Element           // Best match
  confidence: number         // 0-1
  candidates?: Element[]     // If ambiguous, ranked alternatives
}
```

### Flow Planner

For Mode 3 (described flows). Breaks a natural language description into executable steps.

In Claude Code: Claude receives the flow description + current snapshot and returns a step sequence. Each step is executed via the guided path (snapshot → Claude picks element → act → verify).

In library mode: Not supported. Library consumers use Mode 1 (deterministic) or Mode 2 (guided with algorithmic resolution).

---

## CDP Module

### Custom CDP Client

Direct WebSocket connection to Chrome DevTools Protocol. No Puppeteer, no Playwright. Built for AI state consumption.

**What makes it different:**
- Primary output is AX tree snapshots, not locator objects
- State representation is ~200 tokens (AX tree) not ~50K (DOM)
- ~11KB WebSocket overhead per operation vs ~326KB (Playwright)
- AX-tree-based wait strategy: "page is ready" = AX tree stabilized (no new elements for N ms)

**Browser lifecycle:**
1. Find or launch Chrome with `--remote-debugging-port`
2. Connect WebSocket to `ws://localhost:{port}/devtools/browser/{id}`
3. Create page target via `Target.createTarget`
4. Attach to page session via `Target.attachToTarget`
5. Enable required domains
6. On close: close page target, disconnect WebSocket, optionally kill Chrome process

**CDP domains — Phase 1 (must have):**

| Domain | Methods | Purpose |
|--------|---------|---------|
| Accessibility | getFullAXTree, queryAXTree | Read AX tree — primary state |
| Input | dispatchMouseEvent, dispatchKeyEvent | Click, type, scroll |
| Page | navigate, captureScreenshot, setLifecycleEventsEnabled | Navigation, screenshots, load detection |
| Target | createTarget, attachToTarget, getTargets | Tab/iframe management |
| DOM | getDocument, getBoxModel, querySelector | Element coordinates for click targeting |
| Runtime | evaluate, callFunctionOn | JS execution for edge cases |

**CDP domains — Phase 2 (deferred):**
- Network (request monitoring, network idle wait)
- Emulation (viewport size, device metrics, user agent)
- Browser (version info, window management)

**Frame handling:**
Each iframe gets its own CDP session. Spectra maintains a frame tree and can target elements within nested iframes using composite IDs: `{frameIndex}:{elementId}`.

### AX Tree Wait Strategy

Instead of Playwright's "actionability" checks (visible, stable, enabled, receives events), Spectra uses AX tree stabilization:

1. After navigation or action, poll `Accessibility.getFullAXTree` at 100ms intervals
2. Compare consecutive snapshots by building a fingerprint of interactive elements: the set of `{role, label, enabled}` tuples for all elements with a non-empty `actions` list
3. "Stable" = same fingerprint set for 300ms (element count alone is insufficient — a spinner disappearing while content loads keeps count the same)
4. Timeout after 10s → proceed with current tree + warning flag in snapshot metadata

This is simpler and more reliable for AI use — the AX tree reflects what a screen reader would see, which is exactly what we want.

---

## Native Module

### Persistent Swift Subprocess

A compiled Swift binary (`spectra-native`) that runs as a long-lived subprocess. TypeScript communicates via JSON over stdin/stdout.

**Why persistent (not spawn-per-call):**
- ~100ms saved per call (no process start, AX connection overhead)
- In a 10-step walkthrough, that's 1-2 seconds faster
- AX connection to target app maintained across calls
- One Accessibility permission prompt, not repeated

**Protocol:**
```
TypeScript → stdin:  {"id": 1, "method": "snapshot", "params": {"app": "Safari"}}
Swift → stdout:      {"id": 1, "result": {"elements": [...], "window": {...}}}

TypeScript → stdin:  {"id": 2, "method": "act", "params": {"element": "e4", "action": "press"}}
Swift → stdout:      {"id": 2, "result": {"success": true}}
```

JSON-RPC style: request ID for correlation, method + params in, result out. Errors return `{"id": N, "error": {"code": ..., "message": ...}}`.

**Swift binary capabilities:**

Reading (AXUIElement):
- `snapshot` — walk AX tree, return all elements with role, label, value, enabled, focused, actions, bounds
- `find` — query elements by role, label substring, or accessibility identifier
- `window` — get window ID, title, bounds for a target app

Acting:
- `press` — AXUIElementPerformAction(kAXPressAction) — click buttons, toggle checkboxes
- `setValue` — AXUIElementSetAttributeValue(kAXValueAttribute) — type into text fields
- `increment/decrement` — AXUIElementPerformAction for sliders, steppers
- `showMenu` — open popup/context menus
- `mouseClick` — CGEvent at coordinates (fallback when AX action isn't available)
- `keyType` — CGEvent keyboard input (for keyboard shortcuts, special keys)

Simulator (xcrun simctl):
- `simDevices` — list available simulators, find booted ones
- `simScreenshot` — capture simulator screenshot
- `simRecord` — start/stop video recording
- `simTap` — tap at coordinates (for watchOS or when AX isn't available)

**Platform targeting:**

| Target | How Swift finds it |
|--------|-------------------|
| macOS app by name | NSRunningApplication lookup → PID → AXUIElementCreateApplication(pid) |
| macOS app by PID | Direct AXUIElementCreateApplication(pid) |
| iOS simulator | Find Simulator.app window → walk AX tree of simulator content |
| watchOS simulator | simctl only (limited AX access) |

**Permissions:** Requires Accessibility permission in System Settings → Privacy & Security → Accessibility. One-time setup. Swift binary checks on startup and returns a clear error if not granted.

**Health & Recovery:**
- **Request timeout:** 5 seconds per call. If the Swift binary doesn't respond (e.g., hung AX call on unresponsive app), TypeScript kills the request and returns an error.
- **Crash detection:** Listen for process `exit` event. If the subprocess exits unexpectedly, mark all active native sessions as disconnected.
- **Auto-restart:** On next native operation after a crash, spawn a new subprocess automatically. Sessions reconnect to their target app (by PID or name). If the target app also crashed, return a clear error.
- **Heartbeat:** TypeScript sends a `ping` every 30s. If no `pong` within 2s, treat as unresponsive and restart.

---

## Media Module

### Unified Capture API

```typescript
interface MediaCapture {
  screenshot(driver: Driver, options?: ScreenshotOptions): Promise<ScreenshotResult>
  startRecording(driver: Driver, options?: RecordOptions): Promise<RecordHandle>
  transcode(input: string, output: string, options?: TranscodeOptions): Promise<void>
  thumbnail(videoPath: string, outputPath: string): Promise<void>
  duration(videoPath: string): Promise<number>
}
```

**Platform-specific capture:**

| Platform | Screenshot | Video |
|----------|-----------|-------|
| Web | CDP `Page.captureScreenshot` (PNG/JPEG) | CDP screencast → ffmpeg → MP4 |
| macOS | `screencapture -l <windowId> -x` | ScreenCaptureKit (via Swift binary) → MOV → ffmpeg → MP4. Note: `screencapture -v` is screen-wide, not window-specific. Window-targeted video requires ScreenCaptureKit API in the Swift binary. |
| iOS sim | `xcrun simctl io <udid> screenshot` | `xcrun simctl io <udid> recordVideo` → MP4 |
| watchOS sim | `xcrun simctl io <udid> screenshot --mask=black` | `xcrun simctl io <udid> recordVideo` → MP4 |

**Transcode:** All video normalized to MP4 (h264, yuv420p) via ffmpeg. External binary dependency — Spectra checks for it on startup and gives a clear install instruction if missing.

**RecordHandle:**
```typescript
interface RecordHandle {
  stop(): Promise<string>   // Returns path to final video file
  cancel(): Promise<void>   // Discard recording
}
```

---

## MCP Server & Plugin

### MCP Tools

Six tools exposed to Claude:

**spectra_connect** — Start a session
```
Input:  { target: string, name?: string, record?: boolean }
Output: { sessionId, platform, elementCount, snapshot }
```
- `target` = URL (→ web), app name (→ macOS), "sim:iPhone 16" (→ iOS), "sim:Apple Watch" (→ watchOS)
- Automatically detects platform from target string
- Returns initial AX snapshot so Claude can immediately see the UI

**spectra_snapshot** — Get current state
```
Input:  { sessionId, screenshot?: boolean }
Output: { elements: Element[], screenshot?: base64 }
```
- Returns compact AX tree in unified format
- Optional screenshot (base64 PNG) for hybrid vision

**spectra_act** — Perform an action
```
Input:  { sessionId, elementId: string, action: string, value?: string }
Output: { success, snapshot, screenshot? }
```
- Actions: click, type, clear, select, scroll, hover, focus
- Returns post-action snapshot for verification

**spectra_step** — Natural language step (snapshot + resolve + act)
```
Input:  { sessionId, intent: string }
Output: { snapshot (pre), candidates: Element[], action?: string, autoExecuted?: boolean }
```
- Takes a snapshot, returns the AX tree + candidate elements matching the intent
- **Single match (confidence > 0.9):** Auto-executes the action and returns result with `autoExecuted: true`. One round-trip.
- **Multiple candidates or low confidence:** Returns candidates for Claude to pick, then Claude calls `spectra_act`. Two round-trips.
- Confidence scoring in Phase 1 uses exact label matching only (no fuzzy). Exact match on role + label = 1.0, partial label match = 0.5, no match = 0.0.

**spectra_capture** — Media capture
```
Input:  { sessionId, type: "screenshot" | "start_recording" | "stop_recording" }
Output: { path, format, size? }
```

**spectra_session** — Session management
```
Input:  { action: "list" | "get" | "close" | "close_all", sessionId?: string }
Output: { sessions? | session? | success }
```

### Slash Commands

| Command | Purpose |
|---------|---------|
| `/spectra:connect` | Start a session with interactive target selection |
| `/spectra:walk` | Describe a flow in natural language, Spectra executes + captures |
| `/spectra:capture` | Quick screenshot or video of current session |
| `/spectra:sessions` | List and manage active/stored sessions |

### Plugin Manifest

```json
{
  "name": "spectra",
  "description": "AI-native UI automation across web, macOS, iOS, and watchOS",
  "mcpServers": {
    "spectra": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"],
      "tools": ["spectra_connect", "spectra_snapshot", "spectra_act", "spectra_step", "spectra_capture", "spectra_session"]
    }
  },
  "commands": ["commands/*.md"],
  "skills": ["skills/*.md"]
}
```

---

## Unified State Format

### Element Schema

```typescript
interface Element {
  id: string              // Stable within session: "e1", "e2", ...
  role: string            // Normalized: button, textfield, link, checkbox, switch, slider, tab, select, heading, image, text, group
  label: string           // Human-readable label (from accessibility name)
  value: string | null    // Current value (inputs, sliders, switches)
  enabled: boolean
  focused: boolean
  actions: string[]       // Available: press, setValue, increment, decrement, showMenu
  bounds: [number, number, number, number]  // x, y, width, height
  parent: string | null   // Parent element ID (for disambiguation: "Save in modal" vs "Save in toolbar")
}
```

### Compact Serialization

MCP tools return elements in a compact text format optimized for token efficiency:

```
# Page: http://localhost:3000/login
# Platform: web | Elements: 8

[e1] heading "Welcome Back"
[e2] textfield "Email address" empty, focused
[e3] textfield "Password" empty, secure
[e4] button "Log In" enabled
[e5] button "Sign Up" enabled
[e6] link "Forgot your password?"
[e7] link "Login with Google"
[e8] link "Login with GitHub"
```

Properties only shown when they carry information: `enabled` only shown on buttons (assumed for links), `value` only shown when non-null, `focused` only shown when true.

### Role Normalization

| Spectra role | Web (CDP AX) | macOS (AXUIElement) | iOS/watchOS |
|-------------|-------------|--------------------|-----------:|
| button | button | AXButton | Button trait |
| textfield | textbox | AXTextField/AXTextArea | TextField trait |
| link | link | AXLink | Link trait |
| checkbox | checkbox | AXCheckBox | — |
| switch | switch | AXSwitch | AXSwitch |
| slider | slider | AXSlider | AXSlider |
| tab | tab | AXTab/AXRadioButton | — |
| select | combobox/listbox | AXPopUpButton/AXComboBox | Picker |
| heading | heading | AXStaticText (heading subrole) | Header trait |

---

## Phasing

### Phase 1 — Core + Web (MVP)

Deliver a working web automation engine with Claude Code plugin.

- Custom CDP client: connect, navigate, AX snapshot, click, type, screenshot
- Session manager: create, step history, snapshots, screenshots
- Unified state format and compact serialization
- MCP server with all 6 tools
- Slash commands: connect, walk, capture, sessions
- Storage: .spectra/ in project

**Testable outcome:** "Walk through the login flow on localhost:3000 and capture screenshots" works end-to-end.

### Phase 2 — Native Platforms

Add macOS and iOS simulator support.

- Swift binary: persistent subprocess, AX tree reading, AXPerformAction, CGEvent
- TypeScript bridge: JSON-RPC over stdin/stdout
- macOS app automation: snapshot + act
- iOS simulator: snapshot + act + simctl
- watchOS simulator: simctl screenshot/video + coordinate taps
- Media: native screenshot and video capture

**Testable outcome:** "Open Safari, navigate to google.com" and "Toggle dark mode in the iOS simulator" both work.

### Phase 3a — Media & Vision

- Video recording across all platforms (ScreenCaptureKit for macOS window-specific)
- Transcode pipeline (ffmpeg)
- Hybrid vision: screenshot fallback when AX tree is insufficient

**Testable outcome:** Record a 30-second walkthrough video on web and macOS, output as MP4.

### Phase 3b — Library Exports & Algorithmic Resolution

- Library API exports for Showcase and other consumers
- Algorithmic resolution engine (Jaro-Winkler, role filter, spatial hints)
- Showcase integration: Showcase imports Spectra for automated walkthroughs

**Testable outcome:** `import { createSession } from 'spectra'` works from another project.

### Phase 3c — Replay & Resilience

- Session replay engine (re-execute recorded sessions deterministically)
- Self-healing selectors for replay (re-resolve when elements shift)
- Network domain (request monitoring, network idle wait)
- Emulation domain (viewport, device metrics)

**Testable outcome:** Replay a recorded login flow after UI changes, self-heal selector drift.

---

## External Dependencies

**Required:**
- Chrome/Chromium (for CDP — user's existing install)
- Xcode Command Line Tools (for xcrun simctl, swift compiler)
- Node.js 22+ (LTS — required for built-in WebSocket)

**Required for full functionality:**
- ffmpeg + ffprobe (video transcode — `brew install ffmpeg`)

**System permissions:**
- Accessibility (System Settings → Privacy → Accessibility) — for native AX access
- Screen Recording (System Settings → Privacy → Screen Recording) — for native video capture

**Zero npm dependencies for core automation.** WebSocket is Node.js 22+ built-in. CDP is JSON over WebSocket. Swift binary is compiled from source. The only external runtime dependency is Chrome.

---

## Key Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| CDP edge cases (iframe state, crash recovery, WebSocket drops) | Web automation unreliable | Start with happy path, add resilience incrementally. Log all CDP traffic for debugging. |
| AXUIElement permission UX | Users confused by macOS permission dialogs | Clear first-run setup guide. Check permission on startup, give actionable error. |
| iOS simulator AX tree quality | Elements may be poorly labeled or missing | Fall back to screenshot + coordinate-based interaction. Flag to user. |
| watchOS limited AX access | Can only use simctl + coordinates | Set expectations: watchOS is screenshot/video capture + coordinate taps only. |
| Scope creep | Project never ships | Strict phasing. Phase 1 is web-only and must work before Phase 2 starts. |
| Chrome version compatibility | CDP protocol changes between Chrome versions | Pin to stable CDP protocol version. Test against Chrome stable channel. |

---

## Resolved Design Decisions

1. **Chrome launch strategy:** Launch a dedicated Chromium instance with a unique user data directory (`~/.spectra/chromium-profile/`). Never touch the user's existing Chrome. Use `--headless=new` by default, `--headless=false` when the user wants to see the browser (e.g., during walkthroughs). Spectra manages the process lifecycle — launch on `spectra_connect`, kill on session close or Spectra exit.
2. **WebSocket:** Require Node.js 22+ (LTS since April 2025) and use the built-in `WebSocket` global. Zero npm dependencies for the CDP client.
3. **Swift binary distribution:** Compile on first use (same pattern as IBR). Requires Xcode Command Line Tools. Cache compiled binary at `~/.spectra/bin/spectra-native`. Recompile when source hash changes.
4. **Snapshot storage:** Full snapshots per step (not diffs). Storage is cheap, debugging and replay need full state. A 50-step session with full snapshots is ~1MB of JSON — negligible.

## Open Questions (to resolve during implementation)

1. **Chromium discovery** — How to find the Chromium binary? Check common paths (`/Applications/Google Chrome.app`, `chromium` in PATH, Homebrew). Fallback to prompting the user.
2. **iframe composite ID in compact format** — Should the compact text format show frame context? e.g., `[f1:e3] button "Submit"` vs just `[e3]`. Defer until iframe support is implemented.
