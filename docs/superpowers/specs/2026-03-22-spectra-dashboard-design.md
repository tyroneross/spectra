# Spectra Dashboard — Design Spec

## Overview

A local web dashboard for browsing, managing, exporting, and orchestrating Spectra captures. Lives inside the Spectra repo at `web-ui/`. Launched via `npx spectra serve` at `http://localhost:4300`.

## Problem

Spectra captures screenshots, videos, and app usage sequences via CLI/MCP tools. The output lands in `artifacts/` as files with no visual browsing, no organization, no export workflow. Users must navigate the filesystem manually to find, review, and use captured media. There's also no way to save reusable capture recipes or manage storage.

## Goals

- Browse all captures across sessions and platforms in a visual gallery
- Manage sessions: review step history, rename, archive, delete
- Export captures as blog-ready packages (ZIP, markdown with images, individual files)
- Save and execute capture playbooks (reusable LLM-driven capture recipes)
- Archive, upload, and manage storage

## Non-Goals

- Remote deployment or multi-user access (local tool only)
- Real-time capture streaming (captures are reviewed after the fact)
- Image editing beyond crop and region highlighting
- Authentication or access control

---

## Architecture

### Stack

- Next.js 16, React 19, App Router
- Tailwind CSS, shadcn/ui components
- Geist Sans / Geist Mono fonts
- Dark mode default
- `sharp` for server-side image processing (crop, resize, overlay rendering in export pipeline)

### Library Import Configuration

`web-ui/package.json` references the parent Spectra package via a local path:

```json
"dependencies": {
  "spectra": "file:.."
}
```

`web-ui/next.config.ts` must include:

```typescript
serverExternalPackages: ['spectra']
```

This ensures Next.js doesn't try to bundle the Spectra library (which spawns native subprocesses). The `dist/` build must be current before running the dashboard.

**Driver lifecycle in server actions:** Each action that uses a driver must create → connect → operate → disconnect within the action scope. No shared driver state across requests. Example:

```typescript
const driver = new CdpDriver()
await driver.connect({ url: target })
// ... perform steps ...
await driver.disconnect()
```

### Data Access

Two paths:

1. **Filesystem reads** — API routes read `artifacts/` and `.spectra/` directly for browsing, listing, searching. Fast, simple, no intermediary.
2. **Library imports** — Server actions import from `spectra` (`CdpDriver`, `NativeDriver`, `SessionManager`) for live actions: executing playbooks, triggering new captures.

No MCP layer. No external database. All state is files on disk.

### Directory Layout

```
spectra/
├── web-ui/
│   ├── app/
│   │   ├── layout.tsx              # Root layout, dark theme, Geist fonts
│   │   ├── page.tsx                # Redirect → /captures
│   │   ├── captures/
│   │   │   ├── page.tsx            # Gallery grid + filter panel
│   │   │   └── [id]/page.tsx       # Detail view (full media + metadata)
│   │   ├── sessions/
│   │   │   ├── page.tsx            # Session cards
│   │   │   └── [id]/page.tsx       # Session timeline replay
│   │   ├── export/page.tsx         # Export pipeline wizard
│   │   ├── guidance/
│   │   │   ├── page.tsx            # Playbook list
│   │   │   └── [id]/page.tsx       # Playbook editor
│   │   ├── archive/page.tsx        # Archive browser + storage stats
│   │   └── api/
│   │       ├── captures/route.ts   # List, search, filter captures
│   │       ├── sessions/route.ts   # List, get, update, delete sessions
│   │       ├── export/route.ts     # Generate export packages
│   │       ├── playbooks/route.ts  # CRUD playbooks
│   │       ├── archive/route.ts    # Archive/restore/delete operations
│   │       └── media/[...path]/route.ts  # Serve images + videos
│   ├── components/
│   │   ├── media-grid.tsx          # Responsive thumbnail grid
│   │   ├── media-card.tsx          # Individual capture card
│   │   ├── media-viewer.tsx        # Full-size overlay viewer
│   │   ├── filter-panel.tsx        # Left sidebar filters
│   │   ├── action-bar.tsx          # Top bar: search, sort, bulk actions
│   │   ├── session-timeline.tsx    # Vertical step-by-step replay
│   │   ├── playbook-editor.tsx     # Step list editor
│   │   ├── export-wizard.tsx       # 3-step export flow
│   │   ├── storage-stats.tsx       # Disk usage breakdown
│   │   └── nav.tsx                 # Top navigation tabs
│   ├── lib/
│   │   ├── data.ts                 # Filesystem readers
│   │   ├── actions.ts              # Server actions (spectra library)
│   │   └── types.ts                # Dashboard-specific types
│   ├── package.json
│   ├── next.config.ts
│   └── tailwind.config.ts
├── src/                            # Existing Spectra source
├── artifacts/                      # Capture output
└── .spectra/
    ├── sessions/                   # Session JSON files
    ├── playbooks/                  # NEW — Playbook JSON files
    └── archive/                    # NEW — Archived captures
```

### Launch

Add `serve` command to Spectra CLI or package.json script:

```bash
npx spectra serve          # starts Next.js dev server on port 4300
npx spectra serve --port 5000  # custom port
```

For development: `cd web-ui && npm run dev`

---

## Screen 1: Captures (Landing)

The default view. Visual gallery of all captured media.

### Layout

Hybrid layout with three zones:

- **Left panel** (240px, collapsible): Filters
- **Main area** (fluid): Media grid
- **Top bar** (fixed): Search + actions

### Filter Panel (Left)

- **Sessions**: Collapsible list of all sessions with capture count badges. Click to filter. "All Sessions" at top.
- **Platform**: Toggle buttons — Web, macOS, iOS, watchOS. Multi-select.
- **Type**: Toggle — Screenshots, Video. Multi-select.
- **Date**: Quick presets (Today, This Week, This Month, All) plus custom range.

Filters compose with AND logic. Active filters shown as removable chips above the grid.

### Media Grid (Main)

Responsive grid (3-5 columns depending on viewport). Each card:

- Thumbnail (16:10 aspect ratio, object-fit cover)
- Filename (truncated, monospace)
- Session name badge (subtle, bottom-left)
- Platform icon (bottom-right)
- Timestamp (relative — "2h ago", "Mar 20")
- Hover: subtle border highlight + quick action icons (open, export, archive)

Clicking a card opens the detail view.

### Action Bar (Top)

- Search input (filters by filename, session name)
- Sort dropdown: Date (newest), Date (oldest), Name A-Z, Session
- Bulk select toggle: when active, cards show checkboxes. "Export Selected" and "Archive Selected" buttons appear.
- View toggle: Grid / List (list shows more metadata per row)

### Detail View (`/captures/[id]`)

Full page or overlay (depending on implementation):

- **Media viewer**: Full-size image (zoomable) or video player (native HTML5)
- **Metadata panel** (right sidebar, 300px):
  - Filename, dimensions, file size, format
  - Session name (linked), platform
  - Step context: what action preceded this capture, AX snapshot summary
  - Capture timestamp
- **Actions**: Copy to clipboard, download, move to different session, rename, delete, archive, open in Finder

### Data

API route `GET /api/captures` scans TWO locations:

1. `artifacts/` recursively — user-triggered captures (`spectra_capture` tool output)
2. `.spectra/sessions/*/step-*.png` — step screenshots from session automation

Both sources produce the same `Capture` type. Session linkage is derived by directory: a file at `.spectra/sessions/<id>/step-003.png` belongs to session `<id>`.

```typescript
interface Capture {
  id: string              // content hash (SHA-256 of first 4KB) — stable across renames
  path: string            // relative path from project root
  source: 'artifacts' | 'session'  // where the file lives
  filename: string
  type: 'screenshot' | 'video'
  format: string          // png, mp4, etc.
  size: number            // bytes
  dimensions?: [number, number]
  sessionId?: string      // derived from parent directory for session sources
  sessionName?: string
  platform?: Platform
  timestamp: number       // file mtime
  archived: boolean
}
```

The `media/[...path]` API route must serve files from both `artifacts/` and `.spectra/` — validate the path is within these directories to prevent directory traversal.

---

## Screen 2: Sessions Manager

### Session List (`/sessions`)

Grid of session cards. Each card shows:

- Session name (editable inline)
- Platform badge + icon
- Capture count, step count
- Date range (created → last activity)
- Status: Active (green dot) / Closed (gray)
- Quick actions: Open, Archive, Delete

Sort by: Recent activity, Name, Capture count.

### Session Detail (`/sessions/[id]`)

**Header**: Session name, platform, status, target (URL or app name), date range.

**Timeline**: Vertical timeline of steps, chronological:

Each step shows:
- Step number
- Intent text ("click the settings button")
- Action type badge (click, type, scroll)
- Before/after screenshot thumbnails (side by side, clickable for full size)
- Success/failure badge
- Duration
- Expandable: full AX snapshot diff (which elements changed)

**Captures section**: Grid of all media captured during this session, in chronological order.

**Actions**: Rename, export all captures as ZIP, archive session, delete session.

Note: "Re-open session" (reconnecting to the same target) is deferred — it requires handling unavailable targets and deciding whether to append or create new. Out of scope for v1.

### Data

API route `GET /api/sessions` reads `.spectra/sessions/*/session.json` (one level deep — each session is a subdirectory, not a flat file):

```typescript
interface DashboardSession {
  id: string
  name: string
  platform: Platform
  target: DriverTarget
  steps: DashboardStep[]
  captureCount: number    // derived: count of step-*.png in session dir
  status: 'active' | 'closed'
  createdAt: number
  updatedAt: number
}

interface DashboardStep {
  index: number
  actionType: string      // from Step.action.type
  elementId: string       // from Step.action.elementId
  intent?: string         // NOT stored in core Step — see note below
  screenshotPath: string
  success: boolean
  duration: number
  timestamp: number
}
```

**Session status:** The core `Session` type has no `status` field. The dashboard must add a `closedAt?: number` field to the core `Session` type in `src/core/types.ts`. `SessionManager.close()` must set this before persisting. A session with `closedAt` set is closed; without it, it's active.

**Step intent text:** The core `Step` type stores `Action` (type + elementId) but NOT the natural language intent string. The `spectra_step` MCP tool receives the intent but does not persist it. **Upstream fix required:** Add `intent?: string` to the core `Step` type and have `spectra_step` pass it through to `SessionManager.addStep()`. Until that fix, the timeline displays action type + element label (derived from the step's `snapshotBefore`) instead of intent text.

**Capture linkage:** Captures are NOT stored in session JSON. The dashboard derives them by scanning `.spectra/sessions/<id>/step-*.png` files and matching them to step indices.

---

## Screen 3: Export Pipeline (`/export`)

Three-step wizard. State managed client-side. No saves until final export.

### Step 1: Select

- Shows all captures (or pre-selected if navigated from gallery with selection)
- Drag-and-drop to reorder captures
- Remove button per capture
- "Add More" opens a picker overlay to add from gallery

### Step 2: Annotate

Per-capture editing:
- **Caption**: Text input below the image. Optional.
- **Highlight**: Click and drag to draw rectangle overlays (red border, semi-transparent fill). Multiple allowed. Delete by clicking X on overlay.
- **Crop**: Drag handles to crop. Apply/reset.

Navigation between captures via prev/next or thumbnail strip.

### Step 3: Export

Choose output format:

| Format | Output |
|--------|--------|
| **ZIP** | Numbered images + optional captions.txt |
| **Markdown** | `.md` file with `![caption](image)` per step, numbered. Images in adjacent `images/` dir |
| **Individual files** | Copy files to a chosen directory with optional rename pattern |

Templates (preset configurations):
- **Blog post**: Markdown format, numbered steps, captions as paragraphs
- **Social card**: Single best image, cropped to 1200x630
- **Documentation**: Full flow, all captures, with annotations preserved

Pick output directory (default: `spectra-export/` in project root). Generate button.

### Data

API route `POST /api/export` receives the arranged, annotated capture list and format selection.

**Request payload:**

```typescript
interface ExportRequest {
  format: 'zip' | 'markdown' | 'individual'
  template?: 'blog' | 'social' | 'docs'
  outputDir?: string        // default: spectra-export/
  captures: ExportCapture[]
}

interface ExportCapture {
  captureId: string
  order: number
  caption?: string
  crop?: { x: number, y: number, width: number, height: number }
  highlights?: { x: number, y: number, width: number, height: number, color?: string }[]
}
```

**Image processing:** Uses `sharp` (server-side) to apply crop and render highlight rectangles onto images before packaging. Crops are applied first, then highlights drawn as semi-transparent colored rectangles. Original files are never modified — processing produces temporary copies in the export output.

Returns `{ outputPath: string, fileCount: number, totalSize: number }`.

---

## Screen 4: Capture Guidance (`/guidance`)

### Playbook List

Cards showing:
- Playbook name
- Description (1-2 lines)
- Target (URL or app name)
- Step count
- Last executed date (or "Never")
- Platform badge

Actions: Create new, duplicate, edit, delete, run.

### Playbook Editor (`/guidance/[id]`)

**Header**: Name (editable), description (editable), target (URL/app name), platform dropdown.

**Steps list**: Ordered list, each step has:
- Step number (auto)
- Intent: text input ("click the settings button", "navigate to the integrations tab")
- Capture type: dropdown (screenshot, video start, video stop, none)
- Notes: optional text for context
- Drag handle for reorder, delete button

Add step button at bottom.

**Preview**: Read-only view of the playbook as the LLM would see it — compact text format.

**Run button**: Executes the playbook via a server action:
1. Create a driver (`CdpDriver` or `NativeDriver`) based on platform
2. Connect to target
3. For each step: snapshot → resolve intent → act → capture if specified
4. After each step: send progress update to client (via streaming or polling)
5. Disconnect driver when complete (or on error)
6. Results appear in Captures gallery linked to an auto-created session named after the playbook

**UX note:** For web targets, `CdpDriver` launches a Chrome window on the local machine — the user will see it open. The playbook run is sequential and may take 10-30 seconds depending on step count. The UI shows a progress indicator with step-by-step status.

### Data

Playbooks stored as JSON in `.spectra/playbooks/`:

```typescript
interface Playbook {
  id: string
  name: string
  description: string
  target: string          // URL or app name
  platform: Platform
  steps: PlaybookStep[]
  createdAt: number
  updatedAt: number
  lastRunAt?: number
}

interface PlaybookStep {
  intent: string
  captureType: 'screenshot' | 'video_start' | 'video_stop' | 'none'
  notes?: string
}
```

---

## Screen 5: Archive & Storage (`/archive`)

### Archive Browser

Same media grid as Captures, but sourcing from `.spectra/archive/`. Filter and search identical.

Actions: Restore (move back to artifacts/), delete permanently, bulk operations.

### Storage Stats

Dashboard cards showing:
- Total disk usage (artifacts/ + .spectra/ + archive/)
- Breakdown by: session, platform, media type
- Largest sessions (sorted by size)
- Bar chart: usage over time (by month, based on file mtime — approximate, mtime resets on copy)

### Cleanup

- Archive all captures older than N days
- Delete archived captures older than N days
- Remove empty sessions
- One-click actions with confirmation dialog

### Upload

Drag-and-drop zone. Accepts images (PNG, JPG, WebP) and videos (MP4, MOV).
Creates a "Manual Upload" session, stores files in artifacts/ with proper naming.

### Data

API route `GET/POST /api/archive`:
- `GET`: List archived captures (scans `.spectra/archive/`)
- `POST action=archive`: Move capture from artifacts/ to .spectra/archive/
- `POST action=restore`: Move back
- `POST action=delete`: Permanent delete
- `POST action=upload`: Accept file upload, store in artifacts/
- `GET /api/archive/stats`: Compute disk usage stats

---

## UI Design

### Theme

- Dark mode (zinc-900 background, zinc-50 text)
- Geist Sans for interface, Geist Mono for filenames/metadata/timestamps
- Single accent color for active states and primary actions
- shadcn/ui components: Card, Button, Input, Select, Dialog, Tabs, Badge, ScrollArea, Sheet (mobile nav)

### Navigation

Top bar with tabs: **Captures** | **Sessions** | **Export** | **Guidance** | **Archive**

Selected tab: `text-zinc-50 font-medium` + 2px bottom border. Others: `text-zinc-400`.

Right side of nav: Spectra version badge, settings gear icon.

### Responsive

- Desktop (≥1024px): Full layout with filter panel
- Tablet (768-1023px): Filter panel collapses to sheet overlay
- Mobile (<768px): Single column, hamburger menu, stacked cards

### Empty States

Each screen has a purposeful empty state:
- Captures: "No captures yet. Use Spectra to capture your first screenshot." + link to docs
- Sessions: "No sessions. Connect to an app with `/spectra:connect`"
- Playbooks: "Create your first capture playbook" + create button
- Archive: "Nothing archived yet"

### Loading

Skeleton cards matching the grid layout. No spinners.

---

## New Storage Directories

Two new directories under `.spectra/`:

```
.spectra/
├── sessions/     # existing
├── playbooks/    # NEW — playbook JSON files
└── archive/      # NEW — archived capture files (moved from artifacts/)
```

Both should be created on first use, not eagerly.

---

## Upstream Changes Required

These changes to core Spectra types/code are prerequisites for the dashboard:

1. **Add `closedAt?: number` to `Session` type** (`src/core/types.ts`) — enables active/closed status derivation
2. **Set `closedAt` in `SessionManager.close()`** (`src/core/session.ts`) — persist close timestamp
3. **Add `intent?: string` to `Step` type** (`src/core/types.ts`) — store the natural language intent
4. **Pass intent through in `spectra_step` tool** (`src/mcp/tools/step.ts`) — save intent string alongside action
5. **Add `serve` script to `package.json`** — `"serve": "cd web-ui && npm run dev -- -p 4300"` (or a proper CLI command)

These are small, backward-compatible additions.

---

## Testing

- **Unit**: API route handlers — mock filesystem, verify correct reads/writes
- **Component**: Media grid renders correct number of cards, filter panel updates URL params
- **Integration**: Full flow — create playbook → run → verify captures appear in gallery
- **E2E (manual)**: Launch dashboard, browse real captures from a Spectra session

---

## Phasing

All 5 screens are v1. Implementation order by dependency:

1. **Scaffold** — Next.js app, layout, nav, theme, fonts
2. **lib/data.ts** — Filesystem readers (shared by all screens)
3. **Captures** — Gallery + detail view (core value, tests everything)
4. **Sessions** — Session list + timeline (depends on lib/data.ts)
5. **Archive** — Storage stats + archive/restore (extends captures)
6. **Guidance** — Playbooks CRUD + editor (independent, new data type)
7. **Export** — Pipeline wizard (depends on captures being browsable)
