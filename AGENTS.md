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
| `spectra_library` | Manage the persistent capture library — tag, find, gallery, export, status, delete, and migrate-from-showcase |

## Sessions vs Library (two storage dirs, different purposes)

Spectra keeps two top-level directories under `.spectra/`:

- **`.spectra/sessions/<id>/`** — ephemeral step-sequence recordings from `spectra_connect` + `spectra_step` + `spectra_capture`. Use for active UI exploration and walkthroughs.
- **`.spectra/library/`** — persistent, tagged catalog of captures meant for long-term use (blog posts, docs, marketing). Flat `index.json` + `media/<capture-id>/original.<ext>`.

Move or duplicate a session capture into the library by calling `spectra_library action="add" sourcePath=<path> feature=<slug> tags=[...]`. The library schema is forward-compatible with the legacy `showcase` plugin — run `spectra_library action="migrate-from-showcase" showcasePath=./.showcase` to import an existing library in one shot.

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
| `/spectra:library` | Tag, find, export, or migrate captures in the library |
