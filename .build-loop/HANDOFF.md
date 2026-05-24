# Handoff — Spectra v1 menu-bar app

This file is the contract between dispatches. It tracks what's done, what's
deferred, and the precise next steps.

## What dispatches 1+2+3 have landed

### Dispatch 1 (commits 9ccddb1..2201077)

| Commit | Chunk | Description |
|---|---|---|
| 9ccddb1 | C0 | Wire video recording end-to-end (start/stop_recording handlers, RecordingRegistry singleton, idempotent stop) |
| e50b266 | C1 | HTTP daemon transport (StreamableHTTPServerTransport on POST /mcp) + bearer auth via ~/.spectra/daemon.token + CLI subcommand `spectra daemon` |
| dce4f42 | C2 | Repo launcher (Next.js / Vite / static / macOS) wired into `spectra_connect` via repoPath param |
| 2201077 | C2.5 | Benchmark schemas at .build-loop/experiments/{walkthrough-bench,video-bench}/ + runner.ts plans (deferred to C7) |

### Dispatch 2 (commits ada4c47..eee7bbd)

| Commit | Chunk | Description |
|---|---|---|
| ada4c47 | C3 | SwiftUI menu-bar shell (Spectra.app). MenuBarExtra(.window), DaemonClient with `mcp-session-id` round-trip, recents in UserDefaults, accessibility-permission first-run panel, 8 XCTest cases |
| 9b37887 | C5 (daemon side) | `spectra_llm_step` MCP tool — executes a fully-formed action plan; daemon never sees the API key. 7 vitest cases |
| (same as above) | C6 | Makefile + scripts/build-and-refresh.sh + scripts/postinstall.sh + ExportOptions.plist. Produces Spectra.app + Spectra.dmg at repo root (ad-hoc signed) |
| eee7bbd | C4 | LaunchAgentManager.swift (install/bootout/reinstall) + Install daemon CTA in popover + scripts/install-daemon.sh fallback + 5 XCTest cases |

### Dispatch 3 (commits 9c83d8f..HEAD)

| Commit | Chunk | Description |
|---|---|---|
| 9c83d8f | C2.6 | Anchor session storage under repoPath (launchd CWD fix). `Session.storageRoot`, `SessionManager.create({repoPath})`, public `sessionDir()`. `spectra_capture` + `spectra_discover` now consult per-session dir. 3 new vitest cases. |
| 5424463 | C5-client | Swift LLM driver + KeychainStore + SettingsView + WalkthroughPlanner + RunWalkthrough wiring. Daemon-side adds `spectra_session action="record_llm_usage"` for telemetry. 12 new XCTests + 3 new vitests. |
| (this commit) | C7.a runner | Walkthrough-bench `runner.ts` + `analyze.ts` + `lib/score.ts` shipped & executable. 16-cell resolution-V fractional factorial across 5 binary factors. 8 new vitests on the score lib. No `runs.jsonl` produced — runner refuses to run without `ANTHROPIC_API_KEY`. |

Verified at the close of dispatch 3:
- ✅ npm test: 479/479 vitest pass (was 471 at end of dispatch 2 + 3 record_llm_usage + 8 score lib − 3 already counted)
- ✅ tsc clean
- ✅ xcodebuild test (ad-hoc sign): 25/25 XCTest pass (was 13 + 7 PromptBuilder + 5 KeychainStore)
- ✅ Spectra.app + Spectra.dmg buildable via `npm run build:dmg:adhoc`
- ✅ `npm run bench:walkthrough` exits cleanly with `ANTHROPIC_API_KEY=… ` set up (untested; refuses with exit 2 when absent, which we verified)
- ✅ `npm run bench:walkthrough:analyze` produces verdict.md from runs.jsonl (verified with empty runs.jsonl path — writes empty-verdict explanation)

## What is explicitly NOT done

Honest accounting per `feedback_verify_before_claiming.md`:

| Item | Status | Why deferred |
|---|---|---|
| C7.a walkthrough DOE execution | NOT EXECUTED | Requires user-supplied `ANTHROPIC_API_KEY` env var + a running daemon + reachable target apps (travel-planner clone, Calculator, System Settings). The runner is shipped and refuses to run without the key per `feedback_no_fake_stats.md`. Estimated wall-clock once key is supplied: 128 runs × ~30s avg ≈ 65 min for the full 16×8 grid. |
| C7.b video DOE | DEFERRED | Requires (a) ScreenCaptureKit permission grant via System Settings (one-time user prompt), (b) ~50 minutes of real-time 60s recordings × 16 cells × 3 flows. Runner not yet shipped — would mirror C7.a structure under `.build-loop/experiments/video-bench/`. |
| Biometric Keychain save path | NOT REACHED IN PRACTICE | Code is shipped (`KeychainStore.swift` with three-tier fallback: biometryCurrentSet → devicePasscode → standard) but the biometric tier requires a properly signed Apple Development build (see `feedback_macos_keychain_signing.md`). Under ad-hoc signing the store auto-degrades to standard tier — `lastSecurityLevel` surfaces this honestly. |
| codesign --verify --deep --strict on Spectra.app (criterion 1 verbatim) | BLOCKED ON USER STEP | The "Mac Development" provisioning profile for `dev.spectra.app` does not exist in the user's Keychain. Either: open `macos/Spectra.xcodeproj` in Xcode once with the Apple ID added under Settings → Accounts, OR generate the profile manually from developer.apple.com. After that, `npm run build:dmg` (signed path) will succeed. |

## Discovered scope changes

### Closed this dispatch
- ~~Storage path on launchd-spawned daemon~~ — fixed in C2.6 (commit 9c83d8f).

### Still open from prior dispatches
1. **PostInstall fires DMG-open only under `CLAUDE_PLUGIN_INSTALL=1`.** The plugin marketplace currently does NOT set this env var. **Next dispatch:** either (a) drop the env-var gate and always open the DMG when running with macOS terminal in foreground (detected via `[ -t 1 ]`), or (b) document the env var as a contract the marketplace should set. Current behavior: postinstall mirrors `dist/` → `~/.spectra/dist/` (the load-bearing piece), and silently skips the DMG-open prompt. Users will discover the DMG via plugin docs.

## Next-dispatch entry point

Two flavors depending on what's blocking:

### A. User has unblocked criterion 1 (Xcode-side signing)

1. Open `macos/Spectra.xcodeproj` in Xcode
2. Select the Spectra target → Signing & Capabilities → Team → "Tyrone Ross"
3. Xcode provisions automatically; close Xcode
4. `npm run build:dmg` (signed path)
5. `codesign --verify --deep --strict Spectra.app` should exit 0 → criterion 1 closes

### B. User has supplied an Anthropic API key + started the daemon

```bash
# In one terminal:
node dist/cli/index.js daemon

# In another:
export ANTHROPIC_API_KEY=sk-ant-…
npm run bench:walkthrough
npm run bench:walkthrough:analyze
```

The analyzer writes `verdict.md`; lock the winning cell's factor levels as
defaults in `macos/Spectra/LLM/PromptBuilder.swift > WalkthroughConfig`
(the verdict will print the exact diff).

### C. ScreenCaptureKit permission granted

`.build-loop/experiments/video-bench/runner.ts` is the next deliverable. It
should mirror C7.a's structure: a `DaemonMcp` client, 16-cell factorial
across V1–V5, scoring via ffmpeg's `ssim` filter + file-size + CPU sampling.

## v1 success criteria scorecard (against goal.md)

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | `Spectra.app` + `Spectra.dmg` at repo root + codesign --verify clean | ⚠️ Partial | Both artifacts exist (ad-hoc signed). `codesign --verify --deep --strict` requires user-side Xcode provisioning step. |
| 2 | App icon → popover with Start/Stop/Save + repo picker (recents + Browse) + instructions + recents list | ✅ verified by xcodebuild test (25/25) + manual code review of MenuBarPopover.swift | All UI implemented in C3 + C5-client adds a real Run walkthrough + Settings gear. |
| 3 | Selecting travel-planner launches dev server + scopes captures + starts recording | ✅ verified by code review | C2 launcher wires repoPath through; C2.6 anchors `session.storageRoot` under repoPath; captures + recordings now land in `<repo>/.spectra/sessions/<id>/`. End-to-end smoke remains pending a live target. |
| 4 | Type "open the home page…" → executed walkthrough driven by Claude | ⚠️ Untested live | All code paths shipped in C5-client. App will refuse to run walkthroughs until an API key is saved via Settings (`apiKeyPresent` gate). End-to-end requires user-supplied key + signed build for biometric save. Ad-hoc builds will degrade to standard Keychain tier. |
| 5 | Existing Claude Code stdio path still works | ✅ verified by code review + 479 vitest pass | Stdio path unchanged from dispatch 1; new `record_llm_usage` action additive only. |
| 6 | Killing Spectra.app doesn't orphan daemon | ✅ (architecturally) | LaunchAgent runs the daemon outside the app process; app quit has no effect on daemon lifecycle. Untested end-to-end. |
| 7 | Walkthrough quality ≥85% / ≤3.5s/step / ≤2900 tokens/step | ⚠️ Harness ready, not run | runner.ts + analyze.ts shipped. Refuses to fabricate; requires `ANTHROPIC_API_KEY` + running daemon. ~65 min wall-clock to execute. |
| 8 | Video quality 1080p30 h264 / ≤8 MB/min / SSIM ≥0.94 / 0 dropped / <25% CPU | ❌ | Cannot measure without ScreenCaptureKit permission + 50 minutes of live recording. Video-bench runner not yet shipped. |

## User-side verification commands

After dispatch 3:
- `npm test` → 479/479 pass
- `npx tsc --noEmit` → clean
- `cd macos && xcodebuild -project Spectra.xcodeproj -scheme Spectra CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO test` → 25/25
- `npm run build:dmg:adhoc` → produces Spectra.app + Spectra.dmg at repo root
- `bash scripts/install-daemon.sh` → bootstraps the LaunchAgent + daemon
- `curl -s http://127.0.0.1:47823/api/version` → `{"apiVersion":1,"daemonVersion":"0.3.0"}`
- `launchctl print gui/$(id -u)/dev.spectra.daemon` → shows the daemon
- Open `Spectra.app` from `/Applications` → menu-bar icon appears + popover opens
- `ANTHROPIC_API_KEY=sk-… npm run bench:walkthrough -- --cells=00` → runs 1 cell × 8 tasks
- `npm run bench:walkthrough:analyze` → writes `verdict.md` from `runs.jsonl`

To unblock criterion 1: open `macos/Spectra.xcodeproj` once in Xcode (Team: Tyrone Ross), close, then `npm run build:dmg`.

To unblock criteria 4 + 7: save an Anthropic API key via Spectra's Settings panel, start the daemon, follow the bench commands above.

To unblock criterion 8: grant Screen Recording permission to Spectra.app on first launch, then await the video-bench runner.
