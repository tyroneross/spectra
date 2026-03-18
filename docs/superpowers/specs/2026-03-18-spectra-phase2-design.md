# Spectra Phase 2 — Native Platforms Design

## Overview

Phase 2 adds macOS, iOS simulator, and watchOS simulator automation to Spectra. A persistent Swift binary (`spectra-native`) communicates with TypeScript over JSON-RPC (stdin/stdout). The existing `Driver` interface means core/MCP layers route to CdpDriver or NativeDriver transparently. Full media capture (screenshots + video) included for all native platforms.

**Prerequisite:** Phase 1 complete (125 tests passing). Web automation via CDP working end-to-end.

**Testable outcomes:**
- "Open TextEdit, type hello, click Format menu" works via macOS AX automation
- "Toggle dark mode in iOS simulator" works via simctl + AX
- Screenshot and video capture work for macOS apps and simulators

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Swift ↔ TS communication | JSON-RPC over stdin/stdout | Simplest, proven (LSP pattern), no ports/sockets |
| Scope | Full Phase 2 (macOS + iOS + watchOS + media) | Single cycle, all native platforms |
| Build strategy | `npm run build:native` script | Explicit compilation, tests skip gracefully if binary absent |
| Test strategy | Integration tests against real apps/sims | Custom SwiftUI test app as fixture, real AX access |
| Test targets | Custom SwiftUI test app | Most predictable, known element structure |
| Media scope | Full (screenshots + video) | Complete feature set for native platforms |

---

## Architecture

### Component Map

MCP tool handlers (`handleConnect`, `handleAct`, etc.) directly create and manage drivers. Core utilities (session manager, resolve, serialize, normalize) are consumed by MCP handlers and drivers — core does not route between drivers.

```
MCP Tool Handlers (create drivers, manage sessions)
    ├── uses → Core utilities (session, resolve, serialize, normalize)
    ├── creates → CDP Driver (Phase 1) → Chrome/Chromium
    └── creates → Native Driver (Phase 2) → spectra-native (Swift binary)
                   │                          ├── AXBridge (macOS AX)
                   │                          ├── SimBridge (xcrun simctl)
                   │                          ├── MediaCapture (screenshots + video)
                   │                          ├── AppTarget (app discovery)
                   │                          └── Types (JSON-RPC protocol)
                   └── SimDriver variant → same binary, simctl path
```

### Dependency Direction

```
mcp/tools/*.ts → native/driver.ts | cdp/driver.ts (MCP handlers pick driver)
mcp/tools/*.ts → core/session.ts, core/resolve.ts, core/serialize.ts
native/driver.ts → native/bridge.ts → spectra-native subprocess
native/driver.ts → core/normalize.ts (role normalization)
media/capture.ts → native/bridge.ts (native screenshots/video)
media/capture.ts → cdp/page.ts (web screenshots — existing)
media/ffmpeg.ts → nothing (external binary)
native/swift/* → nothing (standalone binary)
```

No circular dependencies. Native module is a leaf like CDP.

---

## Swift Binary (`spectra-native`)

### Source & Build

**Source:** `native/swift/` in project root.

**Build command:** `npm run build:native`
```bash
swiftc native/swift/main.swift native/swift/AXBridge.swift \
  native/swift/AppTarget.swift native/swift/SimBridge.swift \
  native/swift/MediaCapture.swift native/swift/Types.swift \
  -framework Foundation -framework ApplicationServices \
  -framework CoreGraphics -framework ScreenCaptureKit \
  -o ~/.spectra/bin/spectra-native
```

**Cache:** Binary stored at `~/.spectra/bin/spectra-native`. Source hash stored at `~/.spectra/bin/.source-hash`. Recompile only when hash changes.

### Protocol

Newline-delimited JSON over stdin/stdout. Stderr reserved for debug logging.

**Request format:**
```json
{"id": 1, "method": "snapshot", "params": {"app": "TextEdit"}}
```

**Response format (success):**
```json
{"id": 1, "result": {"elements": [...], "window": {"id": 123, "title": "Untitled", "bounds": [0, 0, 800, 600]}}}
```

**Response format (error):**
```json
{"id": 1, "error": {"code": -1, "message": "App not running: TextEdit"}}
```

### Methods

| Method | Params | Returns | Platform |
|--------|--------|---------|----------|
| `ping` | — | `{ pong: true }` | all |
| `snapshot` | `{ app: string }` or `{ pid: number }` | `{ elements: NativeElement[], window: WindowInfo }` | macOS |
| `act` | `{ app, elementId, action, value? }` | `{ success, error? }` | macOS |
| `find` | `{ app, role?, label? }` | `{ elements: NativeElement[] }` | macOS |
| `screenshot` | `{ app: string }` | `{ path, format: "png" }` | macOS |
| `simDevices` | — | `{ devices: SimDevice[] }` | iOS/watchOS |
| `simScreenshot` | `{ deviceId }` | `{ path }` | iOS/watchOS |
| `simRecord` | `{ deviceId, action: "start"\|"stop" }` | `{ path? }` | iOS/watchOS |
| `simTap` | `{ deviceId, x, y }` | `{ success }` | iOS/watchOS |
| `startRecording` | `{ app }` | `{ recordingId }` | macOS (ScreenCaptureKit) |
| `stopRecording` | `{ recordingId }` | `{ path }` | macOS (ScreenCaptureKit) |

### Swift Modules

**`main.swift`** — stdin read loop using `readLine()`, dispatches to method handlers, writes JSON responses to stdout. Uses `DispatchQueue` for concurrent request processing.

**`AXBridge.swift`** — Core macOS accessibility:
- `snapshot(pid:)` → `AXUIElementCreateApplication(pid)` → recursive tree walk → `NativeElement[]`
- `performAction(pid:, elementPath:, action:)` → `AXUIElementPerformAction` (press, showMenu) or `AXUIElementSetAttributeValue` (setValue)
- Element identification: array index path from root (e.g., `[0, 2, 1]` = first child → third child → second child). Stable within a single AX tree snapshot.
- `inferActions(role:)` → explicit role-to-action mapping:

| AX Role | Spectra Actions |
|---------|----------------|
| AXButton | press |
| AXTextField, AXTextArea | setValue |
| AXCheckBox, AXSwitch | press |
| AXSlider | increment, decrement |
| AXPopUpButton, AXComboBox | press, showMenu |
| AXLink | press |
| AXRadioButton, AXTab | press |
| AXMenuItem | press |
| AXStaticText, AXImage, AXGroup | *(none — non-interactive)* |

**`AppTarget.swift`** — App discovery:
- `findApp(name:)` → `NSWorkspace.shared.runningApplications` filtered by `localizedName`
- Returns PID for `AXUIElementCreateApplication`
- Error if app not running: `"App not running: {name}. Launch it first."`

**`SimBridge.swift`** — Simulator control via `xcrun simctl`:
- `listDevices()` → `xcrun simctl list devices --json` → parse for booted devices
- `screenshot(udid:, path:)` → `xcrun simctl io {udid} screenshot {path}`
- `recordVideo(udid:, path:)` → spawn background process, return PID
- `stopRecording(pid:)` → send SIGINT to recording process
- `tap(udid:, x:, y:)` → `xcrun simctl io {udid} tap {x} {y}`
- watchOS: same commands, screenshots use `--mask=black`

**`MediaCapture.swift`** — Native media:
- macOS window screenshot: `screencapture -l {windowId} -x {path}` (silent, window-specific)
- macOS video: ScreenCaptureKit API — `SCStreamConfiguration` targeting specific window, output to MOV file
- Requires Screen Recording permission (separate from Accessibility)

**`Types.swift`** — Codable structs:
- `Request` (id, method, params as `[String: AnyCodable]`)
- `Response` (id, result or error)
- `NativeElement` (role, label, value, enabled, focused, actions, bounds, children index)
- `WindowInfo` (id, title, bounds)
- `SimDevice` (udid, name, state, runtime)

### Permissions

**Accessibility:** Required for AX tree access. Checked on startup. Clear error:
```
"Accessibility permission not granted. Open System Settings → Privacy & Security → Accessibility and add Terminal (or your IDE)."
```

**Screen Recording:** Required for video capture only. Checked when `startRecording` is called. Screenshots via `screencapture` don't need this permission.

---

## TypeScript Bridge (`src/native/`)

### `bridge.ts` — NativeBridge

Singleton that manages the Swift subprocess lifecycle.

**`ensureBinary()`** — Checks `~/.spectra/bin/spectra-native` exists and `.source-hash` matches current source. Calls `compiler.compile()` if stale. Throws with build instructions if compilation fails.

**`spawn()`** — `child_process.spawn` with `stdio: ['pipe', 'pipe', 'pipe']`. Sets up readline on stdout for line-based JSON parsing. Stderr piped to debug log.

**`send<T>(method, params)`** — Writes JSON to stdin, returns `Promise<T>`. Request timeout: 5s. Error message: `"Native request '{method}' timed out after 5s. The target app may be unresponsive."`

**`close()`** — Sends `{"method": "quit"}`, waits 2s, then SIGTERM if still alive.

**Health monitoring:**
- Heartbeat: `ping` every 30s. If no `pong` within 2s → kill and restart.
- Crash detection: listen for process `exit` event. On unexpected exit, mark sessions as disconnected, re-spawn on next operation.
- Auto-restart: transparent to callers. Re-spawn subprocess, active sessions reconnect by app name/PID.

### `driver.ts` — NativeDriver

Implements the `Driver` interface from `core/types.ts`.

**`connect(target)`** — Ensures binary is running via bridge. Sends `snapshot` to verify target app is accessible. Stores app name/PID for subsequent calls.

**`snapshot()`** — Calls bridge `snapshot` → maps `NativeElement[]` to `Element[]`:
- `normalizeRole(nativeEl.role, 'macos')` for role mapping
- Generate sequential IDs (`e1`, `e2`, ...) matching CDP pattern
- Map bounds from window-relative coordinates
- Build `Snapshot` with `platform: 'macos'`
- **ID ↔ tree path mapping:** The driver maintains an internal `Map<string, number[]>` that maps each sequential ID to its tree index path (e.g., `e3 → [0, 2, 1]`). Built during depth-first traversal of the Swift response. This map is rebuilt on every `snapshot()` call — it is not stable across snapshots. The `act()` call uses the map from the most recent snapshot.

**`act(elementId, action, value?)`** — Looks up tree path from the ID map built during the last `snapshot()`. If the element ID is not found (stale snapshot), throws: `"Element '{id}' not found. Take a new snapshot — the UI may have changed."`. Calls bridge `act` with the tree path → takes post-action snapshot (which rebuilds the ID map) → returns `ActResult`.

**`screenshot()`** — Calls bridge `screenshot` → reads file → returns `Buffer`.

**`close()`** — Releases app reference. Does NOT stop the bridge (shared by multiple sessions).

### `compiler.ts` — Binary Compilation

**`compile()`** — Runs `swiftc` with all `.swift` files from `native/swift/` (excluding TestApp/). Outputs to `~/.spectra/bin/spectra-native`.

**`isStale()`** — Computes SHA-256 hash of all Swift source files, compares to `~/.spectra/bin/.source-hash`.

**`compileTestApp()`** — Builds the test fixture app separately: `swiftc native/swift/TestApp/*.swift -o ~/.spectra/bin/spectra-test-app`.

### `sim.ts` — Simulator Management

**`listDevices()`** — Calls bridge `simDevices` → returns typed `SimDevice[]`.

**`getBootedDevice(name)`** — Finds a booted simulator matching the name (e.g., "iPhone 16", "Apple Watch").

**`SimDriver`** — Variant of NativeDriver for simulator targets:
- `connect(target)` — parses `sim:iPhone 16` → finds booted device → stores UDID
- `snapshot()` — For iOS: walks Simulator.app AX tree for sim content. For watchOS: returns empty elements (limited AX) with screenshot path.
- `act()` — `simTap` at element center coordinates
- `screenshot()` — `simScreenshot` → read file → Buffer

---

## Media Module (`src/media/`)

### `capture.ts` — MediaCapture

Unified API for screenshots and video across all platforms.

```typescript
interface ScreenshotOptions {
  format?: 'png' | 'jpeg'
  quality?: number  // jpeg only, 0-100
}

interface ScreenshotResult {
  buffer: Buffer
  path?: string     // if saved to disk
  format: string
}

interface RecordOptions {
  format?: 'mp4' | 'mov'
}

interface RecordHandle {
  stop(): Promise<string>    // path to final video
  cancel(): Promise<void>    // discard
}
```

**`screenshot(driver, platform, options?)`** — Routes to correct capture method:
- web → `driver.screenshot()` (existing CDP)
- macos → bridge `screenshot` (screencapture)
- ios/watchos → bridge `simScreenshot` (simctl)

**`startRecording(driver, platform, options?)`** — Returns `RecordHandle`:
- web → CDP screencast → frame collector → ffmpeg stitch on stop
- macos → bridge `startRecording` (ScreenCaptureKit)
- ios/watchos → bridge `simRecord` with action "start"

### `recorder.ts` — RecordHandle Implementations

**`WebRecordHandle`** — Collects CDP screencast frames, stitches to MP4 via ffmpeg on `stop()`.

**`NativeRecordHandle`** — Holds recordingId from bridge, calls `stopRecording` on `stop()`, returns path.

**`SimRecordHandle`** — Holds simctl recording process, sends SIGINT on `stop()`, returns output path.

**Cleanup:** All RecordHandle implementations auto-stop on session close. `SessionManager.close()` iterates active recording handles and calls `stop()`. Orphaned ffmpeg/simctl processes are killed if the parent handle is garbage-collected without stopping.

### `ffmpeg.ts` — FFmpeg Detection & Transcode

**`detectFfmpeg()`** — `which ffmpeg` → returns path or null. Caches result.

**`requireFfmpeg()`** — Throws clear error if not found:
```
"ffmpeg not found. Video recording requires ffmpeg.\nInstall: brew install ffmpeg"
```

**`transcode(input, output, options?)`** — `ffmpeg -i {input} -c:v libx264 -pix_fmt yuv420p {output}`. Normalizes MOV/webm to MP4.

---

## MCP & Platform Detection Updates

### `context.ts` Updates

Current detection:
- URL → web
- App name → macos

New detection:
- `sim:<device name>` prefix → call `simDevices`, find booted device matching name
- Platform determined from simctl runtime string: match `com.apple.CoreSimulator.SimRuntime.iOS-*` → ios, `com.apple.CoreSimulator.SimRuntime.watchOS-*` → watchos
- Exact match rule: `runtime.includes('iOS')` → ios, `runtime.includes('watchOS')` → watchos
- If no booted device matches: `"No booted simulator matching '{name}'. Run 'xcrun simctl boot {name}' first."`
- If device name is ambiguous (multiple matches): `"Multiple simulators match '{name}': {list}. Use the full device name."`

Examples:
- `sim:iPhone 16` → finds booted iPhone 16, runtime contains "iOS" → platform `ios`
- `sim:Apple Watch Series 10` → finds booted watch, runtime contains "watchOS" → platform `watchos`

### Driver Routing

`handleConnect` updated to:
1. `detectPlatform(target)` → returns `{ platform, driverType: 'cdp' | 'native' | 'sim' }`
2. Create appropriate driver: `CdpDriver`, `NativeDriver`, or `SimDriver`
3. Rest of flow unchanged — `driver.connect()`, `driver.snapshot()`, serialize, return

---

## Custom Test App

### Location

`native/swift/TestApp/TestApp.swift` — single-file SwiftUI app.

### UI Structure

**Window title:** "Spectra Test"

All elements set `accessibilityIdentifier` for reliable test matching (e.g., `spectra.controls.clickButton`, `spectra.forms.submitButton`).

**Tab 1 — Controls:**
- Button: "Click Me" with counter label ("Clicked: 0") — id: `spectra.controls.clickButton`
- TextField: "Enter text" placeholder — id: `spectra.controls.textField`
- Toggle/Switch: "Dark Mode" — id: `spectra.controls.darkModeSwitch`
- Slider: 0-100, label shows current value — id: `spectra.controls.slider`

**Tab 2 — Lists:**
- 5 static items: "Item 1" through "Item 5" — ids: `spectra.lists.item1` through `spectra.lists.item5`
- Each item has disclosure indicator

**Tab 3 — Forms:**
- TextField: "Name" — id: `spectra.forms.nameField`
- TextField: "Email" — id: `spectra.forms.emailField`
- Picker/PopUpButton: "Country" with 3 options (US, UK, CA) — id: `spectra.forms.countryPicker`
- Button: "Submit" — id: `spectra.forms.submitButton`

### Build

```bash
npm run build:test-app
→ swiftc native/swift/TestApp/TestApp.swift \
    -framework SwiftUI -framework AppKit \
    -o ~/.spectra/bin/spectra-test-app
```

### Test Lifecycle

Each integration test:
1. Launches `spectra-test-app` as a subprocess
2. Waits for window to appear (AX tree accessible)
3. Runs automation (snapshot, act, verify)
4. Kills the app process
5. Fresh app per test — no state leakage

---

## File Structure

```
spectra/
├── src/
│   ├── core/                   # Existing — no changes
│   ├── cdp/                    # Existing — no changes
│   ├── native/                 # NEW
│   │   ├── bridge.ts           # NativeBridge — subprocess + JSON-RPC
│   │   ├── driver.ts           # NativeDriver implements Driver
│   │   ├── compiler.ts         # Swift compilation + hash cache
│   │   └── sim.ts              # SimDriver + simulator device management
│   ├── media/                  # NEW
│   │   ├── capture.ts          # MediaCapture unified API
│   │   ├── recorder.ts         # RecordHandle per platform
│   │   └── ffmpeg.ts           # ffmpeg detection + transcode
│   └── mcp/
│       └── context.ts          # UPDATE — sim: prefix detection
├── native/
│   └── swift/
│       ├── main.swift          # stdin read loop, request dispatch
│       ├── AXBridge.swift      # AXUIElement tree walk + actions
│       ├── AppTarget.swift     # NSRunningApplication lookup
│       ├── SimBridge.swift     # xcrun simctl wrappers
│       ├── MediaCapture.swift  # screencapture + ScreenCaptureKit
│       ├── Types.swift         # Codable JSON-RPC structs
│       └── TestApp/
│           └── TestApp.swift   # SwiftUI test fixture
├── tests/
│   ├── native/                 # NEW — integration tests
│   │   ├── bridge.test.ts      # Binary spawn, JSON-RPC, heartbeat, crash recovery
│   │   ├── driver.test.ts      # NativeDriver against test app
│   │   ├── sim.test.ts         # SimDriver against booted simulator
│   │   └── compiler.test.ts    # Compilation, hash check, staleness
│   └── media/                  # NEW — integration tests
│       ├── capture.test.ts     # Screenshots across platforms
│       └── recorder.test.ts    # Video recording + transcode
├── package.json                # UPDATE — add build:native, build:test-app scripts
└── plugin.json                 # No changes
```

**New files:** 7 TypeScript (src), 7 Swift, 6 test files = 20 files total.
**Modified files:** `context.ts`, `package.json` = 2 files.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| AX permission UX | Users confused by macOS permission dialogs | Check on startup, give actionable error with exact System Settings path |
| iOS sim AX tree quality | Elements poorly labeled or missing | Fall back to coordinate-based tap, flag to user |
| watchOS limited AX | Can only use simctl + coordinates | Set expectations: screenshot/video + coordinate taps only |
| Swift compilation fails | User lacks Xcode CLI tools | Check for `swiftc` before attempting, clear install instructions |
| ScreenCaptureKit permissions | Separate from Accessibility permission | Check when video requested, not on startup. Screenshots work without it |
| ffmpeg not installed | Video transcode fails | Screenshots work without it. Clear `brew install ffmpeg` message |
| Test app AX tree varies by macOS version | Tests break on OS updates | Pin expected roles/labels, allow flexible element count assertions |

---

## Non-Goals (Phase 2)

- Android support
- Remote device automation
- Cross-browser (Chromium only)
- Session replay / self-healing (Phase 3c)
- Library exports / algorithmic resolution (Phase 3b)
- Network/Emulation CDP domains (Phase 3c)
