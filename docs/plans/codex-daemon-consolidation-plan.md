# Spectra Daemon Consolidation Plan

Date: 2026-06-27
Author: Codex
Scope: independent migration plan for consolidating Spectra onto one persistent GUI-session daemon, one internal core library, and thin adapters.

## Governing Thought

Spectra should become a daemon-owned capture system: the persistent GUI-session daemon owns all mutable state, CDP sessions, native capture workers, live recordings, keep-awake assertions, and TCC permission checks; MCP, CLI, menu-bar, and slash-command surfaces become thin clients over a frozen daemon contract.

This is a breaking internal architecture change. The migration should not attempt to make the current five surfaces "agree" by sharing helpers while they can still execute capture independently. It should remove direct capture execution from every adapter and make "call the daemon" the only route to GUI capture.

## Repo Ground Truth

Current Spectra has useful scaffolding but not the target architecture:

- `src/mcp/http.ts` already exposes a loopback Streamable HTTP MCP server at `/mcp` plus unauthenticated `/api/health` and `/api/version`.
- `src/cli/index.ts` still defaults to stdio MCP server mode and treats `daemon` as one subcommand, so the CLI is not yet a daemon client.
- `src/mcp/context.ts` creates in-process `SessionManager`, driver maps, and launch maps for MCP handlers, so MCP currently owns runtime state.
- `src/core/session.ts` is a good starting point for daemon state, but the core operation boundary is still spread across MCP tool handlers.
- `macos/Spectra/Daemon/LaunchAgentManager.swift` already installs a per-user LaunchAgent into `gui/<uid>` and runs `node .../cli/index.js daemon`, which is the correct GUI-session launch shape.
- `macos/Spectra/Net/DaemonClient.swift` currently talks to the daemon by wrapping MCP JSON-RPC calls, not a daemon-native core API.
- `src/media/pipeline.ts` still records web/macos video through full-display `ffmpeg -f avfoundation`, which must be eliminated for the target architecture.
- `src/media/composite-recorder.ts` directly spawns `~/.spectra/bin/spectra-composite-capture` with a `caffeinate` wrapper. That path must be removed as a public/internal adapter route.
- `native/swift/main.swift` already has JSON-RPC worker stubs for `startRecording` and `stopRecording`, but they are not implemented.
- `native/swift/composite-capture/CompositeCapture.swift` contains valuable ScreenCaptureKit window recording code, but it is packaged as a standalone fixed-duration CLI instead of a daemon-owned live worker.

## Target Architecture

The final architecture has four layers with one-way dependencies:

1. **Daemon core library**: TypeScript operations that own sessions, drivers, launches, recordings, artifacts, permissions, and native worker lifecycle.
2. **Daemon process**: Loopback HTTP/SSE server plus LaunchAgent lifecycle, auth, health, GUI-session validation, and native worker supervision.
3. **Native capture worker**: Swift JSON-RPC process spawned only by the daemon inside the same GUI session; owns ScreenCaptureKit, AX, simulator capture, TCC probes, and keep-awake assertions.
4. **Thin adapters**: MCP over Streamable HTTP, CLI, menu-bar app, and slash commands. They validate user-facing arguments, call the daemon contract, and format responses. They do not own sessions, drivers, recordings, native workers, or capture subprocesses.

The daemon process may mount the MCP Streamable HTTP adapter on the same loopback server, but MCP handlers must not reach directly into driver maps or native workers. They call the daemon core through the same semantic contract as the CLI/menu-bar client. In-process calls are acceptable only behind an interface whose HTTP behavior is covered by contract tests.

## Frozen Daemon Contract

This contract is the parallel-build boundary. Frontend and backend can add fields marked optional, but cannot rename endpoints, remove fields, or change status/error semantics without updating this document first.

### Transport and Auth

- Base URL: `http://127.0.0.1:47823`.
- Bind: loopback only. Reject non-loopback Host headers.
- Token file: `~/.spectra/daemon.token`, mode `0600`.
- Auth: all `/api/v1/*`, `/api/v1/events`, and `/mcp` requests require `Authorization: Bearer <token>`.
- No auth: `GET /api/version` and `GET /api/health`.
- Content type: JSON for request/response APIs; `text/event-stream` for events and MCP SSE.
- Client version header: clients should send `X-Spectra-Contract: daemon.v1`.
- Migration versioning: bump existing `apiVersion` from `1` to `2` because adapters will stop using in-process MCP state and move to `/api/v1`.

### Response Envelope

All `/api/v1/*` JSON endpoints return one of:

```ts
type ApiOk<T> = {
  ok: true
  apiVersion: 2
  requestId: string
  data: T
}

type ApiError = {
  ok: false
  apiVersion: 2
  requestId: string
  error: {
    code:
      | 'E_UNAUTHORIZED'
      | 'E_VERSION_SKEW'
      | 'E_GUI_SESSION_REQUIRED'
      | 'E_TCC_ACCESSIBILITY_REQUIRED'
      | 'E_TCC_SCREEN_RECORDING_REQUIRED'
      | 'E_NATIVE_WORKER_UNAVAILABLE'
      | 'E_TARGET_NOT_FOUND'
      | 'E_SESSION_NOT_FOUND'
      | 'E_RECORDING_ACTIVE'
      | 'E_RECORDING_NOT_FOUND'
      | 'E_INVALID_ARGUMENT'
      | 'E_TIMEOUT'
      | 'E_INTERNAL'
    message: string
    details?: unknown
    retryable: boolean
  }
}
```

`/api/version` and `/api/health` remain raw JSON for backward-compatible probing:

```ts
type VersionResponse = {
  apiVersion: 2
  daemonVersion: string
  contractVersion: 'daemon.v1'
}

type HealthResponse = {
  ok: boolean
  pid: number
  uptime: number
  daemonVersion: string
  apiVersion: 2
  guiSession: {
    uid: number
    launchdDomain: string
    available: boolean
    reason?: string
  }
  nativeWorker: {
    running: boolean
    pid?: number
    version?: string
    lastError?: string
  }
  permissions: PermissionStatus
  activeSessions: number
  activeRecordings: number
}
```

### Shared Types

```ts
type Platform = 'web' | 'macos' | 'ios' | 'watchos'
type CapturePreset = 'docs' | 'demo' | 'social' | 'app-store'
type CaptureMode = 'full' | 'element' | 'region' | 'auto'
type ActionType = 'click' | 'type' | 'clear' | 'select' | 'scroll' | 'hover' | 'focus'

type Target =
  | { kind: 'web'; url: string; browser?: { width?: number; height?: number } }
  | { kind: 'macos'; appName: string; title?: string }
  | { kind: 'simulator'; deviceName: string; platform?: 'ios' | 'watchos' }
  | { kind: 'repo'; repoPath: string; targetHint?: string }

type WindowSelector = {
  windowId?: number
  pid?: number
  appName?: string
  bundleIdentifier?: string
  title?: string
}

type WindowRef = WindowSelector & {
  windowId: number
  pid: number
  appName: string
  title: string
  bounds: [number, number, number, number]
  onScreen: boolean
}

type PermissionStatus = {
  accessibility: {
    status: 'granted' | 'denied' | 'unknown'
    checkedAt: number
    subject: 'spectra-native'
  }
  screenRecording: {
    status: 'granted' | 'denied' | 'unknown'
    checkedAt: number
    subject: 'spectra-native'
  }
  issues: Array<{ code: string; message: string }>
}
```

### Required Endpoints

**Permissions and windows**

- `GET /api/v1/permissions` -> `PermissionStatus`.
- `POST /api/v1/permissions/request` with `{ accessibility?: boolean; screenRecording?: boolean }` -> `PermissionStatus`.
- `GET /api/v1/windows?appName=&pid=&title=` -> `{ windows: WindowRef[] }`.

The daemon must fail recording start with a typed TCC error when permission is missing. Permission prompting belongs to the daemon/native worker, not MCP, CLI, or the menu-bar app. The native worker should use AX trust checks for Accessibility and ScreenCaptureKit/CoreGraphics preflight plus a real capture/black-frame guard for Screen Recording, because a boolean preflight alone is not enough to prove usable output.

**Sessions**

- `POST /api/v1/sessions`
  - Request: `{ target: Target; name?: string; recordOnConnect?: RecordingStartRequest }`
  - Response: `ConnectResult`
- `GET /api/v1/sessions` -> `{ sessions: SessionSummary[] }`
- `GET /api/v1/sessions/:sessionId` -> `{ session: Session; run: CaptureRunManifest }`
- `DELETE /api/v1/sessions/:sessionId` -> `{ success: true }`
- `DELETE /api/v1/sessions` -> `{ success: true; closed: number }`

`ConnectResult` must include `{ sessionId, platform, elementCount, snapshot, target, captureWindow? }`. For web sessions, the daemon launches Chrome visibly in the GUI session and stores a `captureWindow` hint by PID/window title. Full-display video recording is not a valid fallback.

**Interaction and inspection**

- `POST /api/v1/sessions/:sessionId/snapshot`
  - Request: `{ screenshot?: boolean }`
  - Response: `{ snapshot: Snapshot; serialized: string; elementCount: number; screenshot?: string }`
- `POST /api/v1/sessions/:sessionId/actions`
  - Request: `{ elementId: string; action: ActionType; value?: string }`
  - Response: `{ success: boolean; error?: string; snapshot: Snapshot; serialized: string }`
- `POST /api/v1/sessions/:sessionId/steps`
  - Request: `{ intent: string }`
  - Response: existing `spectra_step` result shape, with structured final snapshot when available.
- `POST /api/v1/sessions/:sessionId/llm-steps`
  - Request: `{ actions: Array<{ type: ActionType; elementId: string; value?: string; intent?: string; waitAfterMs?: number }>; continueOnError?: boolean }`
  - Response: existing `LlmStepResult` shape.
- `POST /api/v1/sessions/:sessionId/discover`
  - Request: existing discover options.
  - Response: existing discover result shape.

**Still captures**

- `POST /api/v1/sessions/:sessionId/captures`
  - Request: `{ type: 'screenshot'; mode?: CaptureMode; elementId?: string; region?: string; aspectRatio?: string; clean?: boolean; quality?: 'lossless' | 'high' | 'medium'; preset?: CapturePreset }`
  - Response: `{ path: string; relativePath: string; format: 'png' | 'jpeg'; crop?: [number, number, number, number]; label?: string; cleanApplied?: boolean; preset?: CapturePreset }`

Still screenshots may continue to use the active driver where appropriate: CDP page screenshots for web, native window screenshots for macOS, and simulator screenshots for simulators. Live video recording is the path that must never use full-display avfoundation.

**Live recordings**

- `POST /api/v1/sessions/:sessionId/recordings`
  - Request: `RecordingStartRequest`
  - Response: `RecordingStartResult`
- `POST /api/v1/sessions/:sessionId/recordings/:recordingId/stop`
  - Request: `{ preset?: CapturePreset }`
  - Response: `RecordingStopResult`

```ts
type RecordingStartRequest = {
  mode: 'window' | 'composite' | 'simulator'
  preset?: CapturePreset
  fps?: 30 | 60
  codec?: 'h264' | 'hevc'
  bitrate?: '4M' | '8M'
  hardware?: boolean
  maxDurationMs?: number
  source?:
    | { kind: 'session-window' }
    | { kind: 'window'; window: WindowSelector }
    | { kind: 'composite'; panes: [
        { role: 'left'; window: WindowSelector; label?: string },
        { role: 'right'; window: WindowSelector; label?: string }
      ]; spotlight?: 'none' | 'left' | 'right'; cursor?: boolean; maxWidth?: number }
    | { kind: 'simulator'; deviceId?: string }
}

type RecordingStartResult = {
  recordingId: string
  sessionId: string
  state: 'recording'
  startedAt: number
  source: 'screen-capture-kit' | 'simctl'
  keepAwake: { active: boolean; assertionId?: string }
  fps: number
  codec: string
  bitrate?: string
}

type RecordingStopResult = {
  recordingId: string
  sessionId: string
  state: 'saved'
  path: string
  relativePath: string
  durationMs: number
  sizeBytes: number
  codec: string
  fps: number
  width?: number
  height?: number
  droppedFrames?: number
  validation: {
    cfr?: boolean
    blackFrameGuard: {
      checked: boolean
      allBlack: boolean
      meanLuma?: number
      sampleCount?: number
    }
  }
}
```

There is no `display` or `avfoundation` recording mode in the contract. If a client asks for a full display recording, the daemon returns `E_INVALID_ARGUMENT` with guidance to select a session window or composite windows.

**Events**

- `GET /api/v1/events?sessionId=&since=` streams SSE events.
- Required event names: `session.created`, `session.closed`, `recording.state`, `artifact.created`, `permission.changed`, `daemon.health`.
- Adapters may poll instead of streaming, but event field names are frozen for future live UI.

**MCP**

- `POST /mcp`, `GET /mcp`, and `DELETE /mcp` remain Streamable HTTP MCP endpoints with bearer auth.
- MCP tool names can remain stable (`spectra_connect`, `spectra_snapshot`, `spectra_act`, `spectra_step`, `spectra_capture`, `spectra_session`, `spectra_discover`, `spectra_walkthrough`, `spectra_llm_step`, `spectra_library`, `spectra_demo`, terminal `spectra_record`).
- MCP handlers translate tool arguments into `/api/v1` calls or the equivalent in-process daemon-client interface. They do not allocate `SessionManager`, `Driver`, `NativeBridge`, or recording registries.

## File Ownership

### Frontend Owned by Claude

Claude owns adapter and schema surfaces:

- MCP tool definitions and handlers: `src/mcp/server.ts`, `src/mcp/tools/*.ts`, `src/mcp/resources.ts`, and MCP adapter tests except auth/health-only daemon tests.
- CLI command surface and client calls: `src/cli/index.ts`, `bin/spectra`, CLI help text, and CLI adapter tests.
- Slash commands: `commands/*.md`.
- Menu-bar client-to-daemon calls and Codable models: `macos/Spectra/Net/DaemonClient.swift`, `macos/Spectra/Net/DaemonModels.swift`, `macos/Spectra/ViewModels/SpectraViewModel.swift`, `macos/Spectra/LLM/WalkthroughPlanner.swift`, and their app-level tests.
- Request/response schema codification: the eventual shared schema file, proposed as `src/contract/daemon.ts` or equivalent, unless both agents explicitly agree to a different path.

### Backend Owned by Codex

Codex owns daemon execution, core, capture, state, auth, health, lifecycle, and backend tests:

- Core state and operations:
  - `src/core/types.ts`
  - `src/core/session.ts`
  - `src/core/storage.ts`
  - `src/core/actions.ts`
  - `src/core/resolve.ts`
  - `src/core/serialize.ts`
  - `src/core/cache.ts`
  - `src/core/normalize.ts`
  - new `src/core/engine.ts`
  - new `src/core/operations/*.ts`
- Daemon process:
  - new `src/daemon/http.ts`
  - new `src/daemon/routes.ts`
  - new `src/daemon/auth.ts`
  - new `src/daemon/health.ts`
  - new `src/daemon/lifecycle.ts`
  - new `src/daemon/permissions.ts`
  - new `src/daemon/events.ts`
  - `src/cli/token.ts` or its daemon-owned replacement
  - `src/mcp/version.ts` for daemon/API versioning
- CDP/session backend:
  - `src/cdp/*.ts`
  - `src/launcher/*.ts`
- Native bridge and media backend:
  - `src/native/bridge.ts`
  - `src/native/driver.ts`
  - `src/native/sim.ts`
  - `src/native/compiler.ts`
  - `src/media/capture.ts`
  - `src/media/recordings.ts`
  - `src/media/pipeline.ts`
  - `src/media/composite-layout.ts`
  - `src/media/ffmpeg.ts`
  - `src/media/png.ts`
  - `src/media/presets.ts`
  - `src/media/production.ts`
  - `src/media/spotlight.ts`
- Swift native worker:
  - `native/swift/*.swift`
  - `native/swift/composite-capture/*.swift` until refactored or deleted
  - new `native/swift/RecordingCapture.swift`
  - new `native/swift/Permissions.swift`
  - new `native/swift/KeepAwake.swift`
- Daemon lifecycle in macOS app:
  - `macos/Spectra/Daemon/LaunchAgentManager.swift`
  - `macos/SpectraTests/LaunchAgentManagerTests.swift`
- Build/install/runtime scripts:
  - daemon/native parts of `package.json`
  - `scripts/install-daemon.sh`
  - `scripts/postinstall.sh`
  - `scripts/verify_cross_agent.sh`
- Backend tests:
  - `tests/core/*.test.ts`
  - `tests/cdp/*.test.ts`
  - `tests/native/*.test.ts`
  - `tests/media/*.test.ts`
  - daemon auth/health/API tests under `tests/daemon/*.test.ts` or migrated `tests/mcp/http.test.ts`

### Shared Contract Rule

This document is the contract until the frontend-owned schema file exists. After that file exists, schema edits require both agents to acknowledge the change in Rally before implementation. Codex may implement backend validators against the contract, but Claude owns the client-facing schema source.

## Migration Phases

### Phase 0 - Freeze Contract and Add Test Harness

Goal: make the daemon API the build boundary before either side rewires surfaces.

Backend work:

- Add daemon API contract tests using a fake core and fake native worker.
- Add health/auth tests for raw `/api/version`, raw `/api/health`, and enveloped `/api/v1/*`.
- Add a fake in-process `DaemonClient` interface that backend routes and future MCP handlers can share.

Frontend work:

- Codify the request/response schemas from this plan.
- Create mock-daemon tests for CLI/menu-bar/MCP adapters.

Verification:

- `npm test` for contract/auth tests.
- Swift unit tests for model decoding against sample JSON.
- No GUI capture required in this phase.

### Phase 1 - Build the Backend Daemon Core

Goal: move runtime ownership out of MCP context into `SpectraCore`.

Backend work:

- Create `SpectraCore` with operations for connect, snapshot, act, step, llm-step, capture screenshot, start/stop recording, discover, session list/get/close, and artifact registration.
- Move state ownership into the core: `SessionManager`, driver map, launch map, recording map, CDP browser handles, and native worker handle.
- Keep old MCP handlers untouched during this phase to avoid frontend file contention.
- Add `/api/v1` routes that call `SpectraCore`.
- Make web sessions visible by default in the daemon (`BrowserManager` should not default to headless for daemon-managed sessions) and store a capture window hint by PID/title.

Verification:

- Core unit tests with fake drivers.
- API tests for session lifecycle using fake drivers.
- Existing core/session tests remain green.
- No runtime ScreenCaptureKit verification yet.

### Phase 2 - Convert Adapters to Thin Clients

Goal: route MCP, CLI, menu-bar app, and slash commands through the daemon contract.

Frontend work:

- Replace MCP handler internals with calls to the daemon client interface.
- Convert CLI default behavior from "start stdio MCP server" to "call running daemon" for user commands. Keep `spectra daemon` only as the service entrypoint used by LaunchAgent and explicit foreground debugging.
- Move menu-bar app calls from MCP JSON-RPC wrapping to `/api/v1` endpoints.
- Keep slash commands as prompts that invoke MCP tools; those MCP tools now delegate to the daemon.

Backend work:

- Support adapter requests in the daemon API and keep compatibility endpoints alive during the transition.
- Ensure `spectra daemon` still starts the daemon host for LaunchAgent.

Verification:

- Frontend mock-daemon tests pass.
- `scripts/verify_cross_agent.sh` is updated to exercise `/api/v1` plus `/mcp`.
- Cross-check: Codex verifies no frontend adapter imports `SessionManager`, `CdpDriver`, `NativeBridge`, `recordings`, or `recordComposite`.

### Phase 3 - Move Native Recording into the Daemon Worker

Goal: make ScreenCaptureKit live recording a daemon-owned capability and remove direct standalone capture execution.

Backend work:

- Refactor `native/swift/composite-capture/CompositeCapture.swift` into reusable worker code without `@main` CLI ownership.
- Implement Swift JSON-RPC methods in `native/swift/main.swift`:
  - `permissionsStatus`
  - `permissionsRequest`
  - `listWindows`
  - `startRecording`
  - `stopRecording`
  - `abortRecording`
- Add `KeepAwake.swift` using daemon/worker-owned power assertions for no-display-sleep and no-idle-sleep during active recordings. Adapters must not wrap commands in `caffeinate`.
- Add `RecordingCapture.swift` for live start/stop ScreenCaptureKit recording of a session window or two composite windows.
- Keep simulator recording daemon-owned; if `simctl` remains, it is invoked only by the daemon/native worker.
- Add TCC gating in the daemon before recording start and black-frame validation after stop.

Verification:

- `npm run build:native` or replacement native build command succeeds.
- Unit tests cover worker JSON-RPC request/response parsing and Node bridge restart behavior.
- Runtime capture verification requires a real macOS GUI session launched through `gui/<uid>`:
  - `GET /api/health` reports `guiSession.available=true`.
  - `GET /api/v1/permissions` reports Screen Recording and Accessibility status.
  - `POST /api/v1/sessions/:id/recordings` starts SCK recording.
  - stop returns an mp4 with non-black frames and sane dimensions.

### Phase 4 - Delete Retired Capture Paths

Goal: make unsupported routes impossible to call accidentally.

Delete or replace:

- `src/media/composite-recorder.ts` direct spawn path.
- `tests/media/composite-recorder.test.ts` tests for `buildCaffeinatedCommand`.
- `src/native/compiler.ts` composite-only functions and exports: `COMPOSITE_BINARY_PATH`, `compileComposite`, `ensureCompositeBinary`, and composite hash handling.
- `package.json` script `build:composite`.
- `src/mcp/tools/demo.ts` direct `recordComposite` call path; frontend should reroute `record-composite` semantics to daemon recording if the public action remains.
- Web/macos avfoundation recording branches in `src/media/pipeline.ts`, including `buildAvfoundationDeviceListArgs`, `parseAvfoundationScreenInput`, `discoverAvfoundationScreenInput`, and web/macos `buildCaptureArgs` recording behavior.
- Tests that assert web/macos recording uses `ffmpeg -f avfoundation`.
- Public exports in `src/index.ts` for retired avfoundation helpers.

Keep or replace:

- ffmpeg encode/post-processing helpers can stay if they operate on daemon-produced raw/window recordings.
- Terminal `spectra_record` asciicast behavior stays separate from GUI media recording.
- Still screenshot logic stays where it is safe and driver-specific.

Verification:

- `rg "spectra-composite-capture|ensureCompositeBinary|buildCaffeinatedCommand|avfoundation|Capture screen" src tests package.json native scripts` returns only migration docs or explicit historical notes.
- `npm test` and `npm run build` pass.
- Runtime GUI recording still passes after deletion.

### Phase 5 - LaunchAgent and End-to-End GUI Verification

Goal: prove all surfaces route through the persistent GUI-session daemon.

Backend work:

- Harden `LaunchAgentManager.swift` and `scripts/install-daemon.sh` so LaunchAgent remains the canonical daemon startup path.
- Add health fields proving GUI session, native worker, permissions, active sessions, and active recordings.
- Ensure shutdown aborts active recordings and releases keep-awake assertions.

Frontend work:

- Menu-bar app install/start/retry flow calls health and permission endpoints.
- CLI reports daemon reachability and permission status without spawning capture.
- MCP tools return the same user-facing shapes as before while delegating to daemon.

Verification:

- LaunchAgent installed and bootstrapped in `gui/<uid>`.
- Menu-bar app can start a repo session, run walkthrough, stop recording, and reveal artifacts.
- CLI can list sessions, connect, capture screenshot, start/stop recording, and close session by calling daemon.
- MCP over `/mcp` can run `spectra_connect`, `spectra_capture`, and `spectra_session`, and the daemon health active counts change accordingly.
- Runtime capture verification must run from a real logged-in macOS GUI session. A headless/subagent context can initiate calls, but capture execution must occur in the daemon process and native worker launched in `gui/<uid>`.

## Integration and Merge Plan

1. Merge the contract/schema first. No behavior changes.
2. Backend creates `/api/v1` daemon core with fake-driver tests while frontend builds clients against a mock daemon.
3. Frontend migrates MCP/CLI/menu-bar adapters to the daemon client after backend routes are available.
4. Backend lands native worker recording and permission handling behind the already-frozen recording endpoints.
5. Frontend reroutes any remaining user-facing composite/demo commands to the recording endpoints.
6. Backend deletes standalone binary and avfoundation paths after all adapters have moved.
7. Both agents cross-check:
   - Claude checks backend responses against schemas and adapter needs.
   - Codex checks frontend for direct imports of backend execution modules.

No phase should edit files owned by the other agent without a Rally handoff. If a contract issue appears, pause implementation, update the contract, and then resume.

## Top Risks and Controls

1. **TCC permission attaches to the wrong process.** Control: all ScreenCaptureKit and AX calls run in the stable native worker path, not Node, MCP, CLI, or a transient standalone binary. Health reports the TCC subject.
2. **Daemon is started outside the GUI session.** Control: health exposes GUI-session status and recording start fails with `E_GUI_SESSION_REQUIRED`.
3. **Web sessions remain headless.** Control: daemon-managed web sessions launch visible Chrome for capture-capable sessions and store PID/window hints.
4. **Adapters keep old direct paths.** Control: deletion phase plus `rg` checks for retired symbols.
5. **SCK live recording refactor is larger than expected.** Control: preserve existing composite code as reusable worker internals first, then delete the CLI `@main` only after daemon start/stop passes GUI runtime verification.
6. **Black output despite successful process exit.** Control: post-stop black-frame guard is required before marking a recording saved.
7. **Parallel implementation drift.** Control: the contract section above is frozen; schemas and backend API tests must use the same sample fixtures.

## Done Definition

The consolidation is complete when:

- Only the daemon core owns sessions, drivers, native worker processes, and active recordings.
- MCP, CLI, menu-bar, and slash commands cannot execute GUI capture except by calling the daemon contract.
- Web/macos live recording no longer uses full-display avfoundation.
- Standalone `spectra-composite-capture` direct spawning is gone.
- Keep-awake and TCC checks are daemon/native-worker responsibilities.
- Runtime recording verification passes from a real macOS GUI session launched under `gui/<uid>`.
