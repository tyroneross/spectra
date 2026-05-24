# Intent — Spectra menu-bar app (XL build)

## Goal
Add a native macOS menu-bar SwiftUI app `Spectra.app` on top of the existing spectra MCP server. The app exposes Start / Stop / Save from a menu-bar icon, lets the user pick a target repo (recents + Browse) which launches the repo's app and scopes captures under `<repo>/.spectra/sessions/...`, and accepts plain-language instructions that the **app-side LLM driver** turns into walkthrough steps executed by the daemon.

v1 platforms: web (Next.js/Vite/static) + macOS app target. iOS deferred to v1.1.

## North star
The user's customers (engineers shipping marketing media + walkthroughs) currently rely on Claude Code stdio MCP. The menu-bar app makes spectra a first-class macOS surface — no terminal required, no `claude` session required, just an installed app that points at a repo and records.

## Locked architectural decisions (NOT for re-derivation in Phase 2)

| ID | Decision |
|---|---|
| L1.transport | Add `StreamableHTTPServerTransport` as second transport. New CLI subcommand `spectra daemon --port <p>`. Stdio path untouched. |
| L1.auth | Bearer token at `~/.spectra/daemon.token` (mode 0600), generated at daemon start, required on every state-changing endpoint. |
| L1.io | v1 = request/response + 250–500ms polling of `spectra_session action="get"`. SSE deferred to v2. |
| L2.llm | LLM driver lives **in the SwiftUI app**, not the daemon. App holds Anthropic API key in macOS Keychain. Daemon never sees the key. |
| L2.endpoint | Walkthrough tool gains `planner: "rules" \| "client"` param. New `spectra_llm_step` endpoint accepts a fully-formed action plan and executes transactionally. |
| L3.launcher | New `src/launcher/` module. v1 = Next.js / Vite / static web + macOS apps. iOS deferred. |
| L3.lifecycle | `launchedProcess?: { pid, killOnDisconnect }` field on existing `Session` type. Close-session tears down the spawned dev server. |
| L4.app-location | `Spectra.app` installs to `/Applications` via DMG drag. NEVER inside `${CLAUDE_PLUGIN_ROOT}`. |
| L4.daemon-hosting | Daemon stays as Node, run via launchd (`~/Library/LaunchAgents/dev.spectra.daemon.plist`, KeepAlive + RunAtLoad). |
| L4.packaging | Mirror Secrets Vault — `Makefile` builds Release via `xcodebuild`, `hdiutil create` produces `Spectra.dmg`, `scripts/build-and-refresh.sh` copies `.app` + `.dmg` to repo root and verifies codesign. Team ID `7AK2KDLAVP`. |

## Critical Phase 1 findings (in-flight scope)

1. **MCP SDK 1.27.1** is installed. `StreamableHTTPServerTransport` exists at `node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js` — stateful or stateless modes supported. Verified L1 is implementable as designed.
2. **`spectra_capture` recording is currently a stub.** `src/mcp/tools/capture.ts` returns `"Video recording available in Phase 3a for web"` for `start_recording`/`stop_recording`. The lower-level pipeline at `src/media/pipeline.ts` is implemented (ffmpeg avfoundation capture + libx264 / VideoToolbox encode). **Wiring this is a prerequisite for criterion 8 (video DOE)** — added as chunk C0 below.
3. **No `~/dev/git-folder/spectra/macos/` Xcode project exists.** Greenfield Swift app — copy Secrets Vault's `xcodebuild` invocation pattern but don't reuse its source tree.
4. **No CLI entrypoint exists** for spectra. The MCP server starts immediately on `node dist/mcp/server.js` (no subcommand parsing). Adding `spectra daemon` requires lifting `main()` behind a small CLI shim.
5. **Storage path resolves to project root via `.git` / `package.json` / `.spectra` markers** (`src/core/storage.ts`). Daemon must be told the working repo per-request — daemon CWD on launchd is `$HOME`, so we need `repoPath` in connect/walkthrough params OR per-session base path threading.
6. **Plugin version drift**: `package.json: 0.1.0` vs `plugin.json: 0.2.1`. Bump both to align before tagging the release.

## Capability shortlist (Phase 1)
- `@modelcontextprotocol/sdk` 1.27.1 (transport, Server, McpServer)
- node:http (built-in transport mount, no Express/Fastify dep)
- Anthropic SDK (`@anthropic-ai/sdk` — app-side, NOT daemon)
- SwiftUI `MenuBarExtra` (macOS 14+)
- `NWListener` (HTTP via `Network.framework`) — for in-app diagnostic UI if needed
- Apple Keychain Services / `SecAccessControl` — for API key storage
- launchd / launchctl — for daemon lifecycle
- `xcodebuild` / `hdiutil` / `codesign` — for build + packaging
- ffmpeg avfoundation + h264_videotoolbox — for video capture/encode (DOE factors)
- Foundation `URLSession` — for app→daemon HTTP

## Risk-surface change: true
Crosses: process trust boundary (new daemon endpoint), credential storage (Keychain), filesystem write outside repo (`~/.spectra/`, `~/Library/LaunchAgents/`), code-signed binary, dev server spawn (untrusted command surface — `npm run dev` of arbitrary repo).

## Triggers
- `uiTarget`: native macOS (`MenuBarExtra` popover)
- `platform`: macos
- `migrationSource`: n/a (greenfield app shell, daemon extension)
- `structuredWriting`: false
- `promptAuthoring`: true (criterion 7 DOE includes system-prompt-structure factor)
- `promptEditingExisting`: false
- `riskSurfaceChange`: true
