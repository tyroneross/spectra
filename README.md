# Spectra

Content capture for marketing — screenshots, videos, and app usage sequences for blog posts, social media, and documentation.

Works across **web** (Chrome DevTools Protocol), **macOS** (accessibility bridge), **iOS** and **watchOS** (simulators).

## Install

**Requirements:** Node.js 22+, macOS (for native features), Xcode CLI tools (for Swift compilation)

```bash
git clone https://github.com/tyroneross/spectra.git
cd spectra
npm install
npm run build
```

### Native bridge (macOS/iOS/watchOS automation)

```bash
# Compile the Swift binary to ~/.spectra/bin/spectra-native
npm run build:native

# Optional: compile the SwiftUI test fixture
npm run build:test-app
```

**macOS permissions required:**
- System Settings → Privacy & Security → **Accessibility** — add your terminal app
- System Settings → Privacy & Security → **Screen Recording** — add your terminal app (for video capture)

### Dashboard (web UI)

```bash
cd web-ui
npm install
cd ..
npm run serve    # → http://localhost:4300
```

## Claude Code Plugin

Spectra is a Claude Code plugin. Install locally for development:

```bash
# From another project, point Claude Code at the Spectra directory
claude --plugin-dir /path/to/spectra
```

Or add to `.claude/settings.json`:

```json
{
  "plugins": ["/path/to/spectra"]
}
```

### MCP Tools

| Tool | Purpose |
|------|---------|
| `spectra_connect` | Start session — URL, app name, or `sim:device` |
| `spectra_snapshot` | Read current AX tree (element inventory) |
| `spectra_step` | Navigate by intent — "click the settings button" |
| `spectra_act` | Act on a specific element by ID |
| `spectra_capture` | Take screenshot or start/stop video |
| `spectra_session` | List, close, or manage sessions |

### Slash Commands

| Command | Purpose |
|---------|---------|
| `/spectra:connect <target>` | Start a capture session |
| `/spectra:walk <description>` | Walk through a flow with natural language |
| `/spectra:capture` | Screenshot current state |
| `/spectra:sessions` | List active sessions |

## Library Usage

Spectra exports a programmatic API for use by other tools:

```typescript
import { CdpDriver, NativeDriver, SimDriver, resolve, SessionManager } from 'spectra'

const driver = new CdpDriver()
await driver.connect({ url: 'http://localhost:3000' })
const snapshot = await driver.snapshot()
const screenshot = await driver.screenshot()
await driver.disconnect()
```

## Project Structure

```
spectra/
├── src/
│   ├── core/       # Types, session manager, resolve engine, serialize
│   ├── cdp/        # Chrome DevTools Protocol client (10 files)
│   ├── native/     # Swift bridge, native driver, simulator driver
│   ├── media/      # Screenshot, video, ffmpeg transcode
│   └── mcp/        # MCP server + 6 tool handlers
├── native/swift/   # Swift source for native binary (AXBridge, SimBridge)
├── web-ui/         # Next.js dashboard (browse, manage, export captures)
├── commands/       # Claude Code slash commands
├── skills/         # Claude Code skills
├── tests/          # Vitest test suite (20 files, 170+ tests)
├── artifacts/      # Capture output (gitignored)
└── .spectra/       # Session data, playbooks, archive (gitignored)
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Compile TypeScript to dist/ |
| `npm run build:native` | Compile Swift binary |
| `npm run build:test-app` | Compile SwiftUI test fixture |
| `npm test` | Run all tests |
| `npm run serve` | Launch dashboard at localhost:4300 |

## Platforms

| Platform | Driver | Target Format |
|----------|--------|---------------|
| Web | `CdpDriver` | Any URL |
| macOS | `NativeDriver` | App name (e.g., "Finder") |
| iOS | `SimDriver` | `sim:iPhone 16 Pro` |
| watchOS | `SimDriver` | `sim:Apple Watch Series 10` |
