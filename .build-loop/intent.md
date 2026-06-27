<!-- intent_run_id: bl-spectra-composite-mcp-20260627 -->
# Intent — MCP-driveable window-isolated composite recorder

## North star
Make the window-isolated composite recorder (`~/.spectra/bin/spectra-composite-capture`, source `native/swift/composite-capture/`) driveable by Claude directly through the Spectra MCP surface, so a clean two-window side-by-side recording no longer depends on codex or full-display avfoundation. The avfoundation MCP path (`src/media/pipeline.ts`) captures the whole display and goes black when the display sleeps; only the standalone ScreenCaptureKit binary isolates windows, and historically only codex could drive it.

## Update intent
- Add a `record-composite` action to the `spectra_demo` MCP tool that shells to the composite binary with the matching flags and returns the artifact path + a session artifact entry.
- Params: appA, titleA, labelA, appB, titleB, labelB, durationSeconds, fps (60), spotlight (none|a|b), cursor (true), maxWidth (1600), crf, outPath.
- Register the action+params in BOTH the zod `DemoSchema` (handler validation) AND the `server.tool` flat input shape (so the MCP server advertises them) — the auditor previously caught a tool-shape gate mismatch.
- Wrap the binary invocation in `caffeinate -dis` so the display does not sleep mid-capture (the black-frame fix).
- Add a post-capture black-frame guard: probe mean luminance (ffmpeg signalstats YAVG) and warn when the output is all-black.

## Out of scope (this build)
- `macos/Spectra` SwiftUI UI files (other owner).
- Web UI (parallel worktree owns it).
- Changing the existing avfoundation `spectra_capture` recording path.

## Constraints
- Native + ffmpeg only — no new npm deps.
- Branch hygiene → main; auto-commit.
- Do not collide with the live `codex-03` worktree (separate branch `rally/codex-03`).

## Triggers
- uiTarget: null (MCP tool surface, not UI)
- platform: macOS (ScreenCaptureKit binary)
- riskSurfaceChange: false (arg-array spawn, no auth/secrets/network/persistence boundary)
- promptAuthoring: false
- structuredWriting: false

## Activation gate
The running MCP server in the user's session is stale; the new `record-composite` action is NOT exposed until a Claude Code restart (rebuilding dist does not hot-reload the live server). Runtime capture-verify needs a GUI session (codex or the user post-restart).
