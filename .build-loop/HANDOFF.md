# Handoff — Spectra v1 menu-bar app

This file is the contract between THIS dispatch (commits 9ccddb1..dce4f42)
and the NEXT build-loop dispatch.

## What this dispatch landed (TypeScript foundation)

| Commit | Chunk | Files |
|---|---|---|
| 9ccddb1 | C0 — wire video recording end-to-end | src/media/recordings.ts, src/mcp/tools/capture.ts (+/start_/stop_recording), src/mcp/tools/session.ts (abort recording on close), tests/media/recordings.test.ts (7 tests) |
| e50b266 | C1 — HTTP daemon transport + bearer auth + CLI | src/cli/{index,token}.ts, src/mcp/{http,version}.ts, src/mcp/server.ts (extract startStdio + getMcpServer), bin/spectra, package.json + plugin.json → 0.3.0, tests/cli/token.test.ts (10), tests/mcp/http.test.ts (6) |
| dce4f42 | C2 — repo launcher | src/launcher/{detect,web,macos,index,types}.ts, src/mcp/context.ts (+launches), src/mcp/tools/connect.ts (+repoPath param), src/mcp/tools/session.ts (kill launches on close), src/core/types.ts (+Session.launchedProcess), tests/launcher/{detect,web,macos}.test.ts (21) |
| (none — docs only) | C2.5 — benchmark schemas | .build-loop/experiments/{walkthrough-bench,video-bench}/{tasks,flows}.yaml + README.md + runner.ts.PLAN.md |

Verified: 458/458 vitest tests pass · tsc clean · end-to-end smoke (curl initialize → MCP responds, stdio MCP still works).

## What is explicitly NOT done in this dispatch

Honest accounting per `feedback_verify_before_claiming.md`:

| Chunk | Status | Why deferred |
|---|---|---|
| C3 — SwiftUI menu-bar shell | NOT STARTED | Greenfield Xcode project + signing + XCTest cycle is multi-hour wall-clock. Cannot ship in one orchestrator turn alongside C0/C1/C2. |
| C4 — launchd LaunchAgent | NOT STARTED | Requires C3 to load + verify; not parallelizable. |
| C5 — Swift LLM driver + Keychain + spectra_llm_step endpoint | PARTIAL: endpoint NOT shipped on the daemon side | Daemon endpoint depends on C5 client wiring spec; would ship a stub. Keychain biometric requires C3 signing. |
| C6 — Makefile + DMG + scripts | NOT STARTED | Depends on C3/C5 produced artifacts. |
| C7.a — Walkthrough DOE | DEFERRED (schemas in .build-loop/experiments/walkthrough-bench/) | Requires C5 endpoint + live Claude API. |
| C7.b — Video DOE | DEFERRED (schemas in .build-loop/experiments/video-bench/) | Requires real Screen Recording permission + first-cold avfoundation triage. |

User verification at the end of THIS dispatch:
- ✅ `node dist/cli/index.js daemon --port N` binds, returns version, gates /mcp by bearer.
- ✅ Stdio MCP (Claude Code path) unchanged — `echo initialize | node dist/mcp/server.js` returns valid JSON-RPC.
- ✅ `npm run build` produces a usable `dist/` (tracked, ready for plugin install).
- ❌ `Spectra.app` / `Spectra.dmg` do NOT exist yet. Criteria 1, 2, 3, 4, 6, 7, 8 require subsequent dispatches.

## Next-dispatch entry point

Use this as the brief:

> Resume the spectra build at `~/dev/git-folder/spectra`. C0/C1/C2 have shipped (see `.build-loop/HANDOFF.md`). Execute C3 (SwiftUI menu-bar shell) → C4 (launchd) → C5 (Swift LLM driver + `spectra_llm_step` daemon endpoint) → C6 (Makefile + DMG) → C7.a + C7.b (DOE Iterate per `.build-loop/experiments/`) → Phase 4 Review against the 8 success criteria in `.build-loop/goal.md`.
>
> The plan, intent, and architectural locks are in `.build-loop/{plan,intent,goal}.md`. The benchmark targets and DOE protocols are in `.build-loop/experiments/`. Do not re-derive architectural decisions L1–L4. Long-run policy authorizes the full DOE budget for criteria 7+8.

## Discovered scope changes (apply in next dispatch)

1. **Existing capture tool stub message replaced.** Was: `"Video recording available in Phase 3a for web."` Now: real start/stop. Any docs (README, CLAUDE.md) referencing the stub need updating in C3+.

2. **Version was misaligned.** package.json was `0.1.0`, plugin.json was `0.2.1`; both bumped to `0.3.0`. McpServer.serverInfo.version now reads from package.json at runtime so future drift is impossible.

3. **Storage path on launchd-spawned daemon.** `src/core/storage.ts` walks up from `process.cwd()` looking for `.git`/`package.json`/`.spectra` markers. A launchd-spawned daemon has CWD = `$HOME`, which produces an unwanted `~/.spectra/sessions/` fallback. Two options for next dispatch:
   - **A:** Thread `repoPath` through every tool call and use it as the storage base (cleaner; bigger schema diff).
   - **B:** Daemon process tracks "current repo" per session (set at connect, reused thereafter). Less schema churn but more state. Default to A.

4. **Session-ID for MCP-over-HTTP.** SDK's `StreamableHTTPServerTransport` in stateful mode rejects the second request with `"Mcp-Session-Id header is required"` (verified via smoke). The Swift `DaemonClient` must capture the `mcp-session-id` response header after `initialize` and echo it on every subsequent request. Documented; not yet implemented (C3 territory).

## Status markers (per CLAUDE.md)

- ✅ C0/C1/C2 implementation verified by passing tests + tsc + end-to-end curl smoke.
- ⚠️ The 1 pre-existing tests/native/compiler.test.ts flake (Swift compile under parallel vitest worker CPU contention) is environment-only; passes in isolation; not caused by these chunks.
- ❓ C5's `spectra_llm_step` daemon endpoint is a forward-reference in C2.5's benchmark runner plan — must exist before the walkthrough DOE can run.
