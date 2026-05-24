# Plan — Spectra v1 menu-bar app

Architectural decisions L1–L4 are locked (see `.build-loop/intent.md`). Phase 2 does NOT re-derive them.

## Chunk graph

```
C0 ──► C1 ──► C2 ──┬─► C3 ──► C4 ──► C5 ──► C6 ──► C7 (DOE Iterate)
              │     │
              └─► C2.5 (benchmarks) ─┘
```

C0 is a prerequisite for criterion 8. C2 and C2.5 can run in parallel after C1. C5 must come after C1 (HTTP integration test surface). C7 is Iterate-phase DOE, not Execute.

## Chunks

### C0 — Wire video recording end-to-end (prerequisite for criterion 8)

**Owner files:**
- `src/mcp/tools/capture.ts` (extend recording branch)
- `src/media/recordings.ts` (new — RecordingRegistry singleton tracking active recordings per session)
- `src/media/pipeline.ts` (add ffprobe-based duration; surface dropped-frame count from ffmpeg stderr)
- `tests/media/recordings.test.ts` (new)
- `tests/mcp/capture-recording.test.ts` (new)

**Contract:**
- `spectra_capture type="start_recording"` → returns `{ recordingId, path, startedAt }`. Spawns ffmpeg process via `startRecording()`. Registers handle in `RecordingRegistry` keyed by sessionId.
- `spectra_capture type="stop_recording"` → looks up handle, calls `stop()`, runs `encodeRecording()`, returns `{ path, durationMs, sizeBytes, codec, fps, droppedFrames }`. Saves under `<storagePath>/sessions/<sid>/`.
- Default options: `{ fps: 30, quality: 'high', hardware: true }` — these become the **DOE control point** in C7.
- Recording handle must survive across multiple HTTP requests (in-memory singleton on the daemon process).
- Stop must be idempotent; second stop returns `{ alreadyStopped: true, ...lastResult }`.

**Tests:**
- Unit: RecordingRegistry start/stop/list/cleanup with a `setProcessRunner` fake
- Unit: stop-then-stop returns alreadyStopped
- Integration: `handleCapture` start → stop produces an mp4 with the recorded options (fake runner asserts argv contains expected codec+bitrate+fps)

**modifies_api: true** (capture.ts behavior change — stdio MCP path also affected; criterion 5 regression risk)

**Pay-it-forward: Path B.** Typed contract `RecordingHandle` already exists; extend the registry with a clean interface so DOE in C7 can swap defaults without re-touching handlers.

---

### C1 — HTTP transport + bearer auth + token file

**Owner files:**
- `src/mcp/server.ts` (extract `main()` into a `start({ transport })` function; preserve stdio default)
- `src/cli/index.ts` (new — argv parse: `spectra` → stdio, `spectra daemon [--port N]` → HTTP)
- `src/cli/token.ts` (new — `getOrCreateDaemonToken()` writes `~/.spectra/daemon.token` mode 0600)
- `src/mcp/http.ts` (new — node:http server, bearer middleware, mounts StreamableHTTPServerTransport on `POST /mcp` + `GET /mcp` + `DELETE /mcp`)
- `src/mcp/version.ts` (new — `{ apiVersion: 1, daemonVersion: read package.json }`)
- `bin/spectra` (new — `#!/usr/bin/env node` → `import('../dist/cli/index.js')`)
- `package.json` (add `bin` field; bump version to align with plugin.json `0.2.1` → `0.3.0`)
- `.claude-plugin/plugin.json` (bump to `0.3.0`)
- `tests/cli/token.test.ts` (new)
- `tests/mcp/http.test.ts` (new — supertest-style with node:http)

**Contract — wire format:**
- `GET /api/version` (no auth) → `{ apiVersion, daemonVersion }`
- `POST /mcp` (bearer auth) → MCP StreamableHTTP transport entry
- `GET /mcp` (bearer auth) → SSE event stream (for future v2 push; safe to expose now)
- `DELETE /mcp` (bearer auth) → session termination
- Token: read from `Authorization: Bearer <token>` header. Compare via `crypto.timingSafeEqual`. Token written by daemon to `~/.spectra/daemon.token` (0600) on first start; reused if file exists and is well-formed.
- Default port: **47823** (chosen randomly, documented; configurable via `--port`)
- Bind: `127.0.0.1` ONLY (never 0.0.0.0)

**Tests:**
- Token: round-trip create → reuse, perms == 0o600
- HTTP: missing auth → 401, bad token → 401, valid → 200; version endpoint works without auth; preflight `OPTIONS` returns CORS rejection (no browser origin allowed)

**modifies_api: false** (new HTTP transport, stdio unchanged; criterion 5 regression test: stdio still spawns server identically)

---

### C2 — Web + macOS repo launcher (TS-only)

**Owner files:**
- `src/launcher/index.ts` (new — entry: `launchRepo(repoPath) → Promise<LaunchHandle>`)
- `src/launcher/web.ts` (new — Next.js/Vite/static detector + spawn)
- `src/launcher/macos.ts` (new — `xcodebuild -showBuildSettings` + `open <app>.app`)
- `src/launcher/detect.ts` (new — read `package.json`, presence of `next`/`vite`/`index.html`; presence of `*.xcodeproj` or `*.xcworkspace`)
- `src/launcher/types.ts` (new — `LaunchHandle = { pid, kind: 'web'|'macos', url?, appName?, kill: () => Promise<void> }`)
- `src/core/types.ts` (extend `Session` with `launchedProcess?: { pid: number, killOnDisconnect: boolean }`)
- `src/core/session.ts` (close-session now calls `launchHandle.kill()` if present)
- `src/mcp/tools/connect.ts` (new param `repoPath?: string` — if present, run `launchRepo()` first, then derive target from launch result)
- `src/mcp/tools/connect.ts` (new optional param `launch: boolean = false`)
- `tests/launcher/detect.test.ts`, `tests/launcher/web.test.ts`, `tests/launcher/macos.test.ts`, `tests/mcp/connect-launch.test.ts`

**Contract:**
- `launchRepo('/path/to/travel-planner')` detects Next.js (package.json has `next` dep) → spawns `npm run dev` cwd=repoPath → parses stdout for `localhost:<port>` (regex `/https?:\/\/localhost:(\d+)/`) → returns handle. Timeout 30s.
- `launchRepo('/path/to/some.xcodeproj/..')` runs `xcodebuild -showBuildSettings -workspace <ws>` to find `BUILT_PRODUCTS_DIR + EXECUTABLE_NAME`, then `open <app>.app`.
- Failure mode: scripts/`open` exits non-zero → throw `LauncherError` with a structured `{ kind, reason, hint }`.

**Tests:** Fake-spawn the child process; assert detection logic on fixture package.jsons.

**modifies_api: true** (connect.ts gains params)
**Parallel-safe with C2.5 and C3 after C1 lands.**

---

### C2.5 — Benchmark sets (required before any C7 DOE)

**Owner files:**
- `.build-loop/experiments/walkthrough-bench/tasks.yaml` (new — ≥8 tasks)
- `.build-loop/experiments/walkthrough-bench/README.md` (new — how to run)
- `.build-loop/experiments/walkthrough-bench/runner.ts` (new — loads tasks, runs them via the daemon HTTP API, scores success against ground-truth predicates)
- `.build-loop/experiments/video-bench/flows.yaml` (new — 3 flows × 60s each)
- `.build-loop/experiments/video-bench/runner.ts` (new — drives each flow via daemon, captures with provided VideoOptions, computes SSIM via ffmpeg `ssim` filter + reads file size)
- `.build-loop/experiments/lib/score.ts` (new — shared scoring utilities)

**Tasks (walkthrough-bench/tasks.yaml schema):**
```yaml
tasks:
  - id: tp-home-camps-1
    surface: web
    target: ~/dev/git-folder/travel-planner
    instruction: "open the home page, scroll to the camp list, click the first card"
    success_predicate: { ax_query: "heading", contains: "Camp" }
  - id: spectra-web-ui-1
    surface: web
    target: ~/dev/git-folder/spectra/web-ui
    instruction: "..."
    success_predicate: { ... }
  - id: macos-calc-add-1
    surface: macos
    target: "Calculator"
    instruction: "type 2 plus 3 equals"
    success_predicate: { ax_query: "value", contains: "5" }
  # ... at least 8 total, mix of surfaces and difficulty
```

**Flows (video-bench/flows.yaml schema):**
```yaml
flows:
  - id: textform-60s
    target: ~/dev/git-folder/travel-planner
    script:
      - { intent: "open form", wait_ms: 2000 }
      - { intent: "type lorem ipsum × 30 lines", wait_ms: 1000 }
      - { intent: "scroll", repeat: 10, wait_ms: 500 }
  # 3 flows total: text-heavy form fill, scrollable list, dashboard with refresh
```

**Modifies_api: false** (new files only)

---

### C3 — SwiftUI menu-bar shell

**Owner files:**
- `macos/Spectra.xcodeproj/` (new — xcodegen `project.yml`-generated, committed)
- `macos/project.yml` (new — single macOS target, deployment 14.0, signing 7AK2KDLAVP)
- `macos/Spectra/SpectraApp.swift` (new — `@main`, `MenuBarExtra` window-style)
- `macos/Spectra/Views/MenuBarPopover.swift` (new — Start/Stop/Save + repo picker + instructions field + recents list)
- `macos/Spectra/Views/RepoPicker.swift` (new)
- `macos/Spectra/Views/AccessibilityPanel.swift` (new — one-time prompt)
- `macos/Spectra/ViewModels/SpectraViewModel.swift` (new — `@Observable`, holds daemon client + state)
- `macos/Spectra/Net/DaemonClient.swift` (new — `URLSession`-backed, bearer auth from `~/.spectra/daemon.token`)
- `macos/Spectra/Net/DaemonModels.swift` (new — Codable structs mirroring HTTP API)
- `macos/Spectra/Storage/Recents.swift` (new — UserDefaults-backed)
- `macos/Spectra/Assets.xcassets/AppIcon.appiconset/` + `MenuBarIcon.imageset/`
- `macos/Spectra/Spectra.entitlements` (new — `com.apple.security.app-sandbox` = false; we need filesystem write + Process spawn; this is a developer tool, not a sandboxed Mac App Store app)
- `macos/SpectraTests/DaemonClientTests.swift` (new — XCTest hitting a local mock NWListener server)

**Contract:**
- App polls `GET /api/sessions` every 1s while popover is open. Updates `MenuBarExtra` label icon (red dot when any session has `recording: true`).
- "Start" with repo selected → `POST /mcp` with `tools/call name=spectra_connect arguments={target,repoPath,launch:true,record:true}`. Stores returned sessionId.
- "Stop" → `POST /mcp` tools/call `spectra_capture type=stop_recording`.
- "Save" → opens Finder at the session directory.
- Instructions text field + "Run walkthrough" → C5 wiring.

**modifies_api: false** (consumer of C1 API)
**Parallel-safe with C2.**

---

### C4 — launchd LaunchAgent

**Owner files:**
- `macos/Spectra/Daemon/LaunchAgentManager.swift` (new — installs/loads/unloads `dev.spectra.daemon.plist`)
- `macos/Spectra/Daemon/dev.spectra.daemon.plist.template` (new)
- `scripts/install-daemon.sh` (new — one-shot install fallback if user prefers CLI)
- `macos/SpectraTests/LaunchAgentManagerTests.swift` (new)

**Contract:**
- On first app launch, copy template to `~/Library/LaunchAgents/dev.spectra.daemon.plist` with `ProgramArguments = ["/usr/local/bin/node", "<path-to>/dist/cli/index.js", "daemon"]` and `KeepAlive=true`, `RunAtLoad=true`, then `launchctl bootstrap gui/$(id -u) <plist>`.
- App startup ping: `GET /api/version` with 200ms timeout; if fail → 1s backoff retry × 3, then surface "Daemon not running" with "Reinstall" button.
- Daemon path resolution: `which node` at install time; daemon entry resolves to `~/.spectra/dist/cli/index.js` (copied during postinstall in C6).

**modifies_api: false**

---

### C5 — Swift LLM driver + Keychain + `spectra_llm_step` endpoint

**Owner files:**
- `macos/Spectra/LLM/AnthropicClient.swift` (new — `URLSession` direct to `api.anthropic.com/v1/messages`; model claude-haiku-4-5 default, swappable for DOE in C7)
- `macos/Spectra/LLM/WalkthroughPlanner.swift` (new — takes instruction + AX snapshot, prompts Claude, returns `[ActionPlan]`)
- `macos/Spectra/LLM/PromptBuilder.swift` (new — assembles system prompt; structure is a **DOE factor in C7**)
- `macos/Spectra/Storage/KeychainStore.swift` (new — `SecAccessControl` biometric-protected; uses Keychain Sharing group + Team ID)
- `macos/Spectra/Views/SettingsView.swift` (new — paste-API-key UI; tests key with a single `/v1/messages` call)
- `src/mcp/tools/walkthrough.ts` (add `planner: 'rules' | 'client'` param; default 'rules' for backward-compat)
- `src/mcp/tools/llm-step.ts` (new — `spectra_llm_step` tool; takes `sessionId + actions: ActionPlan[]`; executes transactionally; rolls back nothing because we have no transactions, but returns per-step success/error)
- `src/mcp/server.ts` (register new tool)
- `src/core/llm-usage.ts` (new — persists `<repo>/.spectra/sessions/<id>/llm-usage.json` from app-side payloads)
- `tests/mcp/llm-step.test.ts`

**Contract:**
- App: pull AX snapshot via `spectra_snapshot` → ask Claude for plan → POST `spectra_llm_step` with plan + sessionId → daemon executes each action in order, posts results back to app via response (no streaming in v1).
- Token telemetry: app POSTs `{ steps, input_tokens, output_tokens, cost_estimate, model }` to `spectra_session action="record_llm_usage"` after each turn.
- `planner: 'client'` on `spectra_walkthrough` returns `{ error: "Use spectra_llm_step from a client that holds the LLM key" }` and exits 200 — this is the signal to the app that the daemon expects client-side planning.

**modifies_api: true** (walkthrough.ts schema change; new tool registered)

---

### C6 — Makefile + build-and-refresh.sh + DMG + plugin postinstall

**Owner files:**
- `macos/Makefile` (new — `make dmg` = xcodebuild archive + export + hdiutil)
- `scripts/build-and-refresh.sh` (new — mirrors Secrets Vault's; calls `make -C macos dmg`, copies `Spectra.app` + `Spectra.dmg` to repo root, runs codesign verify)
- `scripts/postinstall.sh` (new — if `/Applications/Spectra.app` missing AND `Spectra.dmg` present in plugin root, open DMG to prompt drag-install; if daemon dist missing, copy `dist/` → `~/.spectra/dist/`)
- `package.json` (add `"build:dmg": "bash scripts/build-and-refresh.sh"` and `"postinstall": "bash scripts/postinstall.sh"`)
- `macos/ExportOptions.plist` (new — Developer ID app export with notarization-ready)
- `.gitignore` (add `Spectra.app/`, `Spectra.dmg`, `macos/build/`)

**Contract:**
- `npm run build:dmg` exit-zero produces both artifacts at repo root, codesign verified.
- Postinstall is idempotent and safe to re-run.

**modifies_api: false**

---

### C7 — DOE Iterate (Phase 5, not Execute)

Two parallel DOE tracks. See `.build-loop/experiments/` for design + runs + verdict files.

#### C7.a — Criterion 7 (text-input walkthrough quality)

**Factors:**
| # | Factor | Levels |
|---|---|---|
| F1 | Snapshot type | AX-only / DOM-only / AX+screenshot |
| F2 | Granularity | 1-action / 3–5-action plan |
| F3 | Retry policy | none / 1-retry+resnapshot / 1-retry+broaden |
| F4 | Prompt structure | terse / role+tools+3-shot |
| F5 | Model | haiku-4-5 / sonnet-4-6 |

**Design:** 5 factors × 2 levels = 32-cell full factorial. Use fractional factorial 2^(5-1) = 16 runs (resolution V, all 2-way interactions clear of main effects).

**Primary metric:** task success % on `walkthrough-bench/tasks.yaml`.
**Secondary:** tokens/step, median latency/step.
**Refinement (1FAT × 6 runs):** finer levels on top-effect factor (likely F1 or F5).

#### C7.b — Criterion 8 (UI video)

**Factors:**
| # | Factor | Levels |
|---|---|---|
| V1 | Codec | h264 / hevc |
| V2 | Bitrate | 4 Mbps / 8 Mbps |
| V3 | FPS | 30 / 60 |
| V4 | Encoder | software / VideoToolbox |
| V5 | Cursor overlay | off / on |

**Design:** 5 factors × 2 levels = 32-cell. Use 2^(5-1) = 16-run fractional factorial.

**Primary metric:** SSIM × inverse(MB/min). 
**Secondary:** sustained CPU%, dropped frames over 5min.
**Refinement:** 1FAT × 6 on top-effect factor (likely V4 or V3).

**modifies_api: true** (winners become defaults in `src/media/pipeline.ts` and `src/mcp/tools/llm-step.ts`)

---

## File ownership (MECE)

| Chunk | Owns | Does NOT own |
|---|---|---|
| C0 | src/mcp/tools/capture.ts, src/media/recordings.ts, src/media/pipeline.ts (additions only), tests/media/*, tests/mcp/capture-recording.test.ts | server.ts, any other tool |
| C1 | src/mcp/server.ts, src/mcp/http.ts, src/mcp/version.ts, src/cli/*, bin/spectra, package.json + plugin.json (version bump), tests/cli/*, tests/mcp/http.test.ts | any tool handler (consumer) |
| C2 | src/launcher/*, src/core/session.ts (small extension), src/core/types.ts (Session.launchedProcess), src/mcp/tools/connect.ts (param add), tests/launcher/*, tests/mcp/connect-launch.test.ts | server.ts |
| C2.5 | .build-loop/experiments/walkthrough-bench/*, .build-loop/experiments/video-bench/*, .build-loop/experiments/lib/* | None |
| C3 | macos/Spectra/** (except LLM/, Daemon/), macos/Spectra.xcodeproj/, macos/project.yml, macos/SpectraTests/DaemonClient* | macos/Spectra/LLM/, macos/Spectra/Daemon/ |
| C4 | macos/Spectra/Daemon/*, scripts/install-daemon.sh, macos/SpectraTests/LaunchAgent* | rest of macos/Spectra/ |
| C5 | macos/Spectra/LLM/*, macos/Spectra/Storage/KeychainStore.swift, macos/Spectra/Views/SettingsView.swift, src/mcp/tools/llm-step.ts, src/mcp/tools/walkthrough.ts (param add), src/mcp/server.ts (tool register), src/core/llm-usage.ts, tests/mcp/llm-step.test.ts | C3's view models |
| C6 | macos/Makefile, scripts/build-and-refresh.sh, scripts/postinstall.sh, macos/ExportOptions.plist, .gitignore additions, package.json scripts | None |

## Integration checkpoints

1. **After C1 lands:** `curl http://127.0.0.1:47823/api/version` returns version. C2, C2.5, C3 can begin.
2. **After C0 + C1:** `curl -X POST` via MCP transport can trigger start/stop_recording end-to-end. C2.5's video-bench runner is unblocked.
3. **After C2 + C3 land:** Manual smoke — launch app, pick travel-planner, observe dev server boots. Criteria 2+3 demonstrable.
4. **After C5:** Criteria 4 demonstrable.
5. **After C6:** Criterion 1 demonstrable.
6. **C7 gates:** Criteria 7+8 measured.

## Caller audit (Scope Auditor)

`modifies_api: true` chunks (C0, C1 [package.json only], C2, C5, C7):
- **C0 capture.ts:** callers = `src/mcp/server.ts` (registers tool), `src/mcp/tools/walkthrough.ts` (uses handleCapture in step loop). Walkthrough callsite uses `type: 'screenshot'` only — no impact. Confirmed in code.
- **C1 package.json/plugin.json version bump:** no code callers; only marketplace + plugin registry consumers — non-breaking.
- **C2 connect.ts:** callers = `src/mcp/server.ts` only. New params optional, default falsy. Existing stdio MCP path untouched. ✅
- **C5 walkthrough.ts:** callers = `src/mcp/server.ts` only. `planner` param defaults to 'rules'. Existing usage unchanged. ✅
- **C5 server.ts (tool register):** additive only. ✅
- **C7 pipeline.ts defaults:** internal default constants change; no breaking signature change. Callers: `src/mcp/tools/capture.ts` only (via C0). ✅

All caller-sites either absorbed into owning chunk or non-breaking by construction. Scope-clean.

## Pay-it-forward gate (Path B everywhere)

- C0: `RecordingHandle` interface already exists in `pipeline.ts`. Extend, don't replace. Path B.
- C1: `Transport` interface from MCP SDK is the typed contract. Compose, don't fork. Path B.
- C2: `Driver` interface is the contract; `LaunchHandle` is a new sibling interface, not a Driver mutation. Path B.
- C5: `ToolContext` carries handlers; `spectra_llm_step` becomes a new tool registration, not a mutation of walkthrough. Path B.

No Path A justifications needed.

## Tier escalation

`risk_reason: security boundary` (C1 bearer auth, C5 Keychain) + `persistence contract` (C0 file outputs, C4 plist) → C1, C4, C5 implementers respawn at `tier: thinking` on first failure.

Synthesis dimensions counted: process boundaries (3: stdio MCP, HTTP daemon, Swift app), trust boundaries (2: API key, daemon token), file outputs (3: token file, plist, recordings) = 8. **Synthesis-dense → orchestrator-inline execution at thinking tier per Phase 1 routing rule.**

## UI Input/Output Contract (criterion 2)

**Inputs:**
| Source | Type | Format |
|---|---|---|
| Menu-bar click | Discrete | Open popover |
| Repo picker — Recents | Selection | `{ name, path, lastUsed }` row |
| Repo picker — Browse | NSOpenPanel | absolute path |
| Instructions field | Free text | string ≤2000 chars |
| Start button | Discrete | requires repo selected |
| Stop button | Discrete | requires active session |
| Save button | Discrete | opens Finder at session dir |
| Settings — API key | SecureField | persists to Keychain |

**Outputs:**
| Surface | Type | Update freq |
|---|---|---|
| Menu-bar icon | Static / animated dot | 1Hz poll while popover open |
| Popover header status | Text — "Idle" / "Recording (12s)" / "Walking through (step 3 of 7)" | 1Hz |
| Recents list | Row list, max 5 | mutation events |
| Walkthrough progress | Step-by-step expandable list | per-step response |
| Error toast | Banner, dismissible | on demand |

**States:** idle, picking-repo, launching, recording, walking-through, saving, error, settings.

**Modality fallback:** all interactive controls keyboard-accessible (Space/Return triggers buttons; arrow keys navigate recents).

**Validation:** repo path must exist and contain a launchable surface (package.json with next/vite OR *.xcodeproj). Instruction non-empty before "Run walkthrough" enables.

**Security:** API key never logged; not included in any error message; not sent in any URL.

**Traceability:** each user action → `os_log` entry with sessionId (no secrets).
