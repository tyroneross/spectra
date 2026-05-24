# Handoff — Spectra v1 menu-bar app

This file is the contract between dispatches. It tracks what's done, what's
deferred, and the precise next steps.

## What dispatches 1+2 have landed

### Dispatch 1 (commits 9ccddb1..2201077)

| Commit | Chunk | Description |
|---|---|---|
| 9ccddb1 | C0 | Wire video recording end-to-end (start/stop_recording handlers, RecordingRegistry singleton, idempotent stop) |
| e50b266 | C1 | HTTP daemon transport (StreamableHTTPServerTransport on POST /mcp) + bearer auth via ~/.spectra/daemon.token + CLI subcommand `spectra daemon` |
| dce4f42 | C2 | Repo launcher (Next.js / Vite / static / macOS) wired into `spectra_connect` via repoPath param |
| 2201077 | C2.5 | Benchmark schemas at .build-loop/experiments/{walkthrough-bench,video-bench}/ + runner.ts plans (deferred to C7) |

### Dispatch 2 (commits ada4c47..eee7bbd, this dispatch)

| Commit | Chunk | Description |
|---|---|---|
| ada4c47 | C3 | SwiftUI menu-bar shell (Spectra.app). MenuBarExtra(.window), DaemonClient with `mcp-session-id` round-trip, recents in UserDefaults, accessibility-permission first-run panel, 8 XCTest cases |
| 9b37887 | C5 (daemon side) | `spectra_llm_step` MCP tool — executes a fully-formed action plan; daemon never sees the API key. 7 vitest cases |
| (same as above) | C6 | Makefile + scripts/build-and-refresh.sh + scripts/postinstall.sh + ExportOptions.plist. Produces Spectra.app + Spectra.dmg at repo root (ad-hoc signed) |
| eee7bbd | C4 | LaunchAgentManager.swift (install/bootout/reinstall) + Install daemon CTA in popover + scripts/install-daemon.sh fallback + 5 XCTest cases |

Verified at the close of dispatch 2:
- ✅ npm test: 465/465 vitest pass (was 458 at end of dispatch 1; +7 from llm-step)
- ✅ tsc clean
- ✅ xcodebuild test (ad-hoc sign): 13/13 XCTest pass
- ✅ Spectra.app + Spectra.dmg at repo root (612K, ad-hoc signed)
- ✅ npm run build:dmg:adhoc succeeds end-to-end
- ✅ End-to-end smoke from dispatch 1 still passes (stdio MCP unchanged; HTTP daemon binds and gates /mcp by bearer)

## What is explicitly NOT done

Honest accounting per `feedback_verify_before_claiming.md`:

| Chunk | Status | Why deferred |
|---|---|---|
| C5 client (Swift LLM driver + Keychain) | NOT STARTED | Two real-world blockers: (1) macOS Keychain biometric (`SecAccessControl` kSecAccessControlBiometryCurrentSet) requires a real Apple Development cert + Keychain Sharing entitlement + Team ID match; ad-hoc signed bundles fail per `feedback_macos_keychain_signing.md`. (2) End-to-end test requires the user's live `ANTHROPIC_API_KEY`. The daemon-side `spectra_llm_step` is ready and waiting (see C5 daemon-side commit). |
| C7.a Walkthrough DOE | DEFERRED | Requires C5-client to drive the Anthropic API; cannot complete the 16-cell × 8-task design (~128 runs) from a non-interactive orchestrator session |
| C7.b Video DOE | DEFERRED | Requires (a) ScreenCaptureKit permission grant via System Settings (one-time user prompt), (b) ~50 minutes of real-time 60s recordings × 16 cells × 3 flows |
| codesign --verify --deep --strict on Spectra.app (criterion 1 verbatim) | BLOCKED ON USER STEP | The "Mac Development" provisioning profile for `dev.spectra.app` does not exist in the user's Keychain. Either: open `macos/Spectra.xcodeproj` in Xcode once with the Apple ID added under Settings → Accounts, OR generate the profile manually from developer.apple.com. After that, `npm run build:dmg` (signed path) will succeed. |

## Discovered scope changes

### From dispatch 1, still open
1. **Storage path on launchd-spawned daemon (`src/core/storage.ts`).** Walks up from `process.cwd()`; under launchd CWD = `$HOME` → unwanted `~/.spectra/sessions/` fallback. **Workaround in dispatch 2:** the LaunchAgentManager plist does NOT set `WorkingDirectory`, so daemon CWD is $HOME by default. The SwiftUI app sets `repoPath` on every `spectra_connect` call, which the launcher uses — but the storage path for capture/discover artifacts is still resolved off CWD. **Next dispatch:** thread `repoPath` through `SessionManager.create()` to record `Session.storageRoot` and have `tools/capture.ts` + `tools/discover.ts` consult it. ~6 callsites in `src/mcp/tools/*.ts`. Option A from prior HANDOFF.

### From dispatch 2 (new)
2. **Signed-build provisioning profile gap.** Documented above. Build pipeline is in place; the signing handshake is a one-time user step. NOT a code bug.

3. **PostInstall fires DMG-open only under `CLAUDE_PLUGIN_INSTALL=1`.** The plugin marketplace currently does NOT set this env var. **Next dispatch:** either (a) drop the env-var gate and always open the DMG when running with macOS terminal in foreground (detected via `[ -t 1 ]`), or (b) document the env var as a contract the marketplace should set. Current behavior: postinstall mirrors `dist/` → `~/.spectra/dist/` (the load-bearing piece), and silently skips the DMG-open prompt. Users will discover the DMG via plugin docs.

## Next-dispatch entry point

Use this brief:

> Resume the spectra build at `~/dev/git-folder/spectra`. C0–C4 + C5-daemon + C6 have shipped through dispatch 2 (see `.build-loop/HANDOFF.md`). Execute:
>
> 1. **C5-client** — `macos/Spectra/LLM/AnthropicClient.swift`, `WalkthroughPlanner.swift`, `PromptBuilder.swift`, `macos/Spectra/Storage/KeychainStore.swift` (biometric SecAccessControl), `macos/Spectra/Views/SettingsView.swift` (paste-API-key UI), then wire "Run walkthrough" button to drive the spectra_llm_step daemon endpoint that already exists.
> 2. **C2.6** — thread `repoPath` through `SessionManager.create()` and capture.ts/discover.ts so launchd-spawned daemon writes artifacts to `<repoPath>/.spectra/sessions/` instead of `$HOME/.spectra/sessions/`.
> 3. **Signed build** — open `macos/Spectra.xcodeproj` once in Xcode to provision the dev.spectra.app Mac Development profile, then `npm run build:dmg` (NOT --adhoc) and confirm `codesign --verify --deep --strict Spectra.app` exits 0 (criterion 1).
> 4. **C7.a** — implement `.build-loop/experiments/walkthrough-bench/runner.ts` per its `runner.ts.PLAN.md`; produces `runs.jsonl` + `verdict.md`; locks winner in `src/mcp/tools/walkthrough.ts` planner defaults.
> 5. **C7.b** — same shape for `.build-loop/experiments/video-bench/`. Locks winning `VideoOptions` in `src/media/pipeline.ts`.
>
> Architectural decisions L1–L4 + Plan + Intent are locked in `.build-loop/{plan,intent,goal}.md`. Long-run policy authorizes the full DOE budget for criteria 7+8.

## v1 success criteria scorecard (against goal.md)

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | `Spectra.app` + `Spectra.dmg` at repo root + codesign --verify clean | ⚠️ Partial | Both artifacts exist (ad-hoc signed). `codesign --verify --deep --strict` requires user-side Xcode provisioning step. |
| 2 | App icon → popover with Start/Stop/Save + repo picker (recents + Browse) + instructions + recents list | ✅ | All UI implemented in C3; popover renders + the four sections (header, repo picker, instructions, sessions list, action buttons) all wired. Visual smoke from a signed-launch run remains pending. |
| 3 | Selecting travel-planner launches dev server + scopes captures + starts recording | ⚠️ | Wiring complete (C2 launcher + C3 startSession), but storage path still rooted at daemon CWD pending C2.6. |
| 4 | Type "open the home page…" → executed walkthrough driven by Claude | ❌ | Blocked on C5-client. `Run walkthrough` button is currently disabled until that ships. |
| 5 | Existing Claude Code stdio path still works | ✅ | Stdio path unchanged from dispatch 1; smoke tested via `echo initialize \| node dist/mcp/server.js`. |
| 6 | Killing Spectra.app doesn't orphan daemon | ✅ (architecturally) | LaunchAgent runs the daemon outside the app process; app quit has no effect on daemon lifecycle. Untested end-to-end. |
| 7 | Walkthrough quality ≥85% / ≤3.5s/step / ≤2900 tokens/step | ❌ | Cannot measure without C5-client + live LLM. C7.a DOE deferred. |
| 8 | Video quality 1080p30 h264 / ≤8 MB/min / SSIM ≥0.94 / 0 dropped / <25% CPU | ❌ | Cannot measure without ScreenCaptureKit permission + 50 minutes of live recording. C7.b DOE deferred. |

## User-side verification commands

After dispatch 2:
- `npm test` → 465/465 pass
- `npm run build:dmg:adhoc` → produces Spectra.app + Spectra.dmg at repo root
- `bash scripts/install-daemon.sh` → bootstraps the LaunchAgent + daemon
- `curl -s http://127.0.0.1:47823/api/version` → `{"apiVersion":1,"daemonVersion":"0.3.0"}`
- `launchctl print gui/$(id -u)/dev.spectra.daemon` → shows the daemon
- Open `Spectra.app` from `/Applications` → menu-bar icon appears + popover opens

To unblock criterion 1:
1. Open `macos/Spectra.xcodeproj` in Xcode
2. Select the Spectra target → Signing & Capabilities → Team → "Tyrone Ross"
3. Xcode provisions automatically; close Xcode
4. `npm run build:dmg` (signed path)
5. `codesign --verify --deep --strict Spectra.app` → exits 0

To unblock criteria 4 + 7 + 8:
- C5-client + C7 DOE are next-dispatch work. The orchestrator cannot complete the live-Anthropic-API + live-ScreenCaptureKit-permission paths non-interactively.
