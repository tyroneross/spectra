# Spectra — Content Capture for Marketing

Spectra captures screenshots, videos, and app usage sequences from running applications. The output is media files ready for blog posts, social media, and documentation — eliminating manual demo recording, screenshot cropping, and feature annotation.

**Setup:** Add `artifacts/` and `.spectra/` to `.gitignore`

## When to Use

- **After shipping a feature** — capture visuals for announcement posts
- **Creating documentation** — screenshot flows and annotate features
- **Demo recording** — walk through a UI flow and capture video
- **Skip for** — UI validation (use IBR), automated testing, CI pipelines

## MCP Tools

| Tool | Purpose |
|------|---------|
| `spectra_connect` | Start session — URL, app name, or sim:device |
| `spectra_snapshot` | Read current AX tree (element inventory) |
| `spectra_step` | Navigate by intent — "click the settings button" |
| `spectra_act` | Act on a specific element by ID |
| `spectra_capture` | Take screenshot or start/stop video. Modes: full, element, region, auto |
| `spectra_analyze` | Score current screen — importance ranking, regions of interest, UI state |
| `spectra_discover` | Auto-navigate entire app — BFS crawl, smart framing, state capture |
| `spectra_session` | List, close, or manage sessions |

## Workflows

**Manual capture** (step-by-step):
1. `spectra_connect` to target (URL, app, or simulator)
2. `spectra_step` to navigate through the flow
3. `spectra_capture` at each interesting state
4. `spectra_session` to review and export

**Auto-discover** (hands-off):
1. `spectra_connect` to target
2. `spectra_discover` — crawls the app, captures everything important
3. Output: framed screenshots + manifest in `.spectra/sessions/{id}/discover/`

**Analyze first** (targeted):
1. `spectra_connect` to target
2. `spectra_analyze` — see what's on screen, regions of interest, UI state
3. `spectra_capture mode=region region="Navigation"` — capture specific region

## Platforms

- **Web**: Any URL via Chrome DevTools Protocol
- **macOS**: Running apps via accessibility bridge
- **iOS/watchOS**: Simulators via `sim:device-name`

## Slash Commands

| Command | Purpose |
|---------|---------|
| `/spectra:connect <target>` | Start a capture session |
| `/spectra:walk <description>` | Walk through a flow with natural language |
| `/spectra:capture` | Screenshot current state |
| `/spectra:sessions` | List active sessions |
