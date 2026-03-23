# Spectra Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web dashboard for browsing, managing, exporting, and orchestrating Spectra captures.

**Architecture:** Next.js 16 app at `web-ui/` inside the Spectra repo. Reads `artifacts/` and `.spectra/` via filesystem for browsing. Imports Spectra library (`CdpDriver`, `NativeDriver`, `SessionManager`) for live actions like playbook execution. No database — all state is files on disk.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS, shadcn/ui, Geist Sans/Mono, sharp (image processing), archiver (ZIP export), dark mode.

**Spec:** `docs/superpowers/specs/2026-03-22-spectra-dashboard-design.md`

---

## File Structure

```
spectra/
├── src/core/types.ts              # MODIFY: add closedAt, intent
├── src/core/session.ts            # MODIFY: close() sets closedAt, addStep() accepts intent
├── src/mcp/tools/step.ts          # MODIFY: pass intent + record step in session
├── package.json                   # MODIFY: add serve script
├── tests/core/session.test.ts     # MODIFY: add tests for closedAt, intent
│
├── web-ui/
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── postcss.config.mjs
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                          # redirect → /captures
│   │   ├── globals.css
│   │   ├── captures/page.tsx
│   │   ├── captures/[id]/page.tsx
│   │   ├── sessions/page.tsx
│   │   ├── sessions/[id]/page.tsx
│   │   ├── export/page.tsx
│   │   ├── guidance/page.tsx
│   │   ├── guidance/[id]/page.tsx
│   │   ├── archive/page.tsx
│   │   └── api/
│   │       ├── captures/route.ts
│   │       ├── sessions/route.ts
│   │       ├── sessions/[id]/route.ts
│   │       ├── export/route.ts
│   │       ├── playbooks/route.ts
│   │       ├── playbooks/[id]/route.ts
│   │       ├── archive/route.ts
│   │       ├── archive/stats/route.ts
│   │       └── media/[...path]/route.ts
│   ├── components/
│   │   ├── nav.tsx
│   │   ├── media-grid.tsx
│   │   ├── media-card.tsx
│   │   ├── media-viewer.tsx
│   │   ├── filter-panel.tsx
│   │   ├── action-bar.tsx
│   │   ├── session-timeline.tsx
│   │   ├── playbook-editor.tsx
│   │   ├── export-wizard.tsx
│   │   ├── storage-stats.tsx
│   │   └── empty-state.tsx
│   ├── lib/
│   │   ├── data.ts
│   │   ├── actions.ts
│   │   ├── types.ts
│   │   └── utils.ts
│   └── __tests__/
│       ├── lib/data.test.ts
│       ├── lib/utils.test.ts
│       └── api/ (captures, sessions, playbooks, archive, media)
```

---

## Phase 0: Upstream Core Changes

### Task 1: Add `closedAt` and `intent` to core types + session logic

**Files:**
- Modify: `src/core/types.ts` — Add `closedAt?: number` to `Session`, `intent?: string` to `Step`
- Modify: `src/core/session.ts` — Add `intent?: string` to `AddStepOptions`, pass to Step in `addStep()`, set `closedAt = Date.now()` in `close()`
- Modify: `src/mcp/tools/step.ts` — After auto-execute: take screenshot, call `ctx.sessions.addStep()` with intent, snapshotBefore, snapshotAfter, screenshot, success, duration
- Modify: `tests/core/session.test.ts` — Test closedAt set on close, intent persisted in step

- [ ] Write failing tests for closedAt and intent
- [ ] Run tests — verify they fail
- [ ] Add closedAt to Session type, set in close()
- [ ] Add intent to Step type and AddStepOptions, pass through in addStep()
- [ ] Update step.ts to record steps in session with intent
- [ ] Run tests — verify pass
- [ ] Run full `npm test` — verify no regressions
- [ ] Commit: `feat: add closedAt to Session, intent to Step for dashboard support`

### Task 2: Add serve script to package.json

**Files:**
- Modify: `package.json` — Add `"serve": "cd web-ui && npm run dev -- -p 4300"`

- [ ] Add serve script
- [ ] Commit: `chore: add serve script for dashboard`

---

## Phase 1: Next.js Scaffold

### Task 3: Initialize Next.js app with theme and fonts

**Files:**
- Create: `web-ui/package.json` — Next.js 16, React 19, tailwindcss, `"spectra": "file:.."`, sharp, geist font package
- Create: `web-ui/next.config.ts` — `serverExternalPackages: ['spectra']`
- Create: `web-ui/tsconfig.json` — Standard Next.js with `@/` path alias
- Create: `web-ui/tailwind.config.ts` — Content paths, zinc palette, dark mode class
- Create: `web-ui/postcss.config.mjs` — tailwind + autoprefixer
- Create: `web-ui/app/globals.css` — Tailwind directives, dark defaults
- Create: `web-ui/app/layout.tsx` — Root layout: `<html className="dark">`, Geist fonts, nav placeholder
- Create: `web-ui/app/page.tsx` — `redirect('/captures')`

- [ ] Create web-ui directory and all config files
- [ ] Create layout.tsx with dark theme and Geist fonts
- [ ] Create page.tsx with redirect
- [ ] Run `cd web-ui && npm install`
- [ ] Run `npm run dev` — verify dark page loads, redirect works
- [ ] Commit: `feat: scaffold Next.js dashboard app`

### Task 4: Navigation component + shadcn/ui setup

**Files:**
- Create: `web-ui/components/nav.tsx` — Top tabs (Captures, Sessions, Export, Guidance, Archive), active state with bottom border, version badge
- Run shadcn init + add components: Button, Card, Input, Select, Dialog, Tabs, Badge, ScrollArea, Sheet, DropdownMenu

- [ ] Run `npx shadcn@latest init` with dark theme
- [ ] Add shadcn components (Button, Card, Input, Select, Dialog, Tabs, Badge, ScrollArea, Sheet, DropdownMenu)
- [ ] Build nav.tsx with tab navigation using `usePathname()`
- [ ] Add nav to layout.tsx
- [ ] Create placeholder pages for all 5 routes (captures, sessions, export, guidance, archive)
- [ ] Verify all tabs navigate correctly
- [ ] Commit: `feat: add navigation and shadcn/ui components`

---

## Phase 2: Shared Data Layer

### Task 5: Dashboard types

**Files:**
- Create: `web-ui/lib/types.ts` — Capture, DashboardSession, DashboardStep, Playbook, PlaybookStep, ExportRequest, ExportCapture, StorageStats, filter/sort types

- [ ] Write all type definitions per spec
- [ ] Verify types compile
- [ ] Commit: `feat: add dashboard type definitions`

### Task 6: Filesystem data readers + utils

**Files:**
- Create: `web-ui/lib/data.ts` — listCaptures, getCapture, listSessions, getSession, listPlaybooks, getPlaybook, savePlaybook, deletePlaybook, listArchived, getStorageStats, resolveMediaPath
- Create: `web-ui/lib/utils.ts` — relativeTime, formatBytes, contentHash, slugify
- Create: `web-ui/__tests__/lib/data.test.ts` — Tests with mocked fs
- Create: `web-ui/__tests__/lib/utils.test.ts` — Unit tests for helpers

- [ ] Write utils.ts + tests — verify pass
- [ ] Write data.ts readers: listCaptures (scans artifacts/ + .spectra/sessions/*/step-*.png), listSessions (.spectra/sessions/*/session.json), resolveMediaPath (with traversal guard)
- [ ] Write data.ts tests with mocked filesystem
- [ ] Run tests — verify pass
- [ ] Commit: `feat: add filesystem data layer and utilities`

---

## Phase 3: API Routes

### Task 7: Captures API + media serving

**Files:**
- Create: `web-ui/app/api/captures/route.ts` — GET with filters (sessionId, platform, type, dateFrom, dateTo, search, sort)
- Create: `web-ui/app/api/media/[...path]/route.ts` — Serve files from artifacts/ and .spectra/, validate path, set Content-Type
- Create: `web-ui/__tests__/api/captures.test.ts`
- Create: `web-ui/__tests__/api/media.test.ts`

- [ ] Write captures API route with filter/search/sort
- [ ] Write media serving route with traversal guard
- [ ] Write tests — verify pass
- [ ] Commit: `feat: add captures and media API routes`

### Task 8: Sessions API

**Files:**
- Create: `web-ui/app/api/sessions/route.ts` — GET list, DELETE
- Create: `web-ui/app/api/sessions/[id]/route.ts` — GET detail, PATCH rename
- Create: `web-ui/__tests__/api/sessions.test.ts`

- [ ] Write sessions API routes
- [ ] Write tests — verify pass
- [ ] Commit: `feat: add sessions API routes`

### Task 9: Playbooks + Archive API

**Files:**
- Create: `web-ui/app/api/playbooks/route.ts` — GET list, POST create
- Create: `web-ui/app/api/playbooks/[id]/route.ts` — GET, PUT, DELETE
- Create: `web-ui/app/api/archive/route.ts` — GET list, POST (archive/restore/delete/upload)
- Create: `web-ui/app/api/archive/stats/route.ts` — GET storage stats
- Create: `web-ui/__tests__/api/playbooks.test.ts`
- Create: `web-ui/__tests__/api/archive.test.ts`

- [ ] Write playbooks CRUD routes
- [ ] Write archive operations route (move, restore, delete, upload)
- [ ] Write storage stats route
- [ ] Write tests — verify pass
- [ ] Commit: `feat: add playbooks and archive API routes`

### Task 10: Export API

**Files:**
- Create: `web-ui/app/api/export/route.ts` — POST: accepts ExportRequest, uses sharp for crop/highlight, packages as zip/markdown/individual

- [ ] Write export route: parse ExportRequest, apply crop via sharp, render highlights, package output
- [ ] Handle ZIP (archiver), markdown (template), individual (copy) formats
- [ ] Write tests — verify pass
- [ ] Commit: `feat: add export API route with image processing`

---

## Phase 4: Captures Screen

### Task 11: Gallery page + components

**Files:**
- Create: `web-ui/components/media-card.tsx` — Thumbnail, filename, session badge, platform icon, timestamp, hover actions, checkbox mode
- Create: `web-ui/components/media-grid.tsx` — Responsive CSS grid (3-5 cols), skeleton loading
- Create: `web-ui/components/filter-panel.tsx` — Sessions list, platform toggles, type toggles, date presets. Updates URL search params
- Create: `web-ui/components/action-bar.tsx` — Search, sort, bulk select, grid/list toggle
- Create: `web-ui/components/empty-state.tsx` — Reusable icon + heading + description + CTA
- Modify: `web-ui/app/captures/page.tsx` — Compose filter-panel + action-bar + media-grid, fetch from /api/captures

- [ ] Build media-card and media-grid components
- [ ] Build filter-panel with URL search param integration
- [ ] Build action-bar with search, sort, bulk select
- [ ] Build empty-state component
- [ ] Compose captures/page.tsx
- [ ] Verify renders with real filesystem data
- [ ] Commit: `feat: add captures gallery with filters and grid`

### Task 12: Capture detail view

**Files:**
- Create: `web-ui/components/media-viewer.tsx` — Full-size image (zoomable), video player, keyboard nav (Esc, arrows)
- Modify: `web-ui/app/captures/[id]/page.tsx` — Media viewer + metadata sidebar + actions

- [ ] Build media-viewer with zoom and video playback
- [ ] Build detail page with metadata panel
- [ ] Add actions: download, rename, delete, archive, open in Finder
- [ ] Verify with real captures
- [ ] Commit: `feat: add capture detail view with media viewer`

---

## Phase 5: Sessions Screen

### Task 13: Session list + detail with timeline

**Files:**
- Create: `web-ui/components/session-timeline.tsx` — Vertical timeline, step cards with intent/action, before/after thumbnails, success badge, duration
- Modify: `web-ui/app/sessions/page.tsx` — Session cards grid with inline rename, status dots, quick actions
- Modify: `web-ui/app/sessions/[id]/page.tsx` — Header + timeline + captures section

- [ ] Build session-timeline component
- [ ] Build sessions list page with cards
- [ ] Build session detail page composing timeline + captures grid
- [ ] Add inline rename (PATCH API), archive, delete actions
- [ ] Verify with real session data
- [ ] Commit: `feat: add sessions manager with timeline`

---

## Phase 6: Archive Screen

### Task 14: Archive browser + storage stats

**Files:**
- Create: `web-ui/components/storage-stats.tsx` — Dashboard cards (total, breakdown), CSS/SVG bar chart, largest sessions list
- Modify: `web-ui/app/archive/page.tsx` — Archive media grid (reuses media-grid), storage stats section, cleanup actions with confirmation dialogs, upload drop zone

- [ ] Build storage-stats component with CSS bar chart (no charting library)
- [ ] Build archive page reusing media-grid with archive data source
- [ ] Add restore, permanent delete, bulk cleanup actions
- [ ] Add upload drop zone (drag-and-drop, creates manual session)
- [ ] Verify with filesystem data
- [ ] Commit: `feat: add archive browser and storage management`

---

## Phase 7: Guidance Screen

### Task 15: Playbook list + editor + runner

**Files:**
- Create: `web-ui/components/playbook-editor.tsx` — Editable name/description/target/platform, ordered step list with drag reorder, intent + capture type + notes per step, preview pane
- Create: `web-ui/lib/actions.ts` — Server action `runPlaybook(id)`: create driver, connect, iterate steps (snapshot → resolve → act → capture), disconnect. Write progress to temp file, client polls status endpoint.
- Modify: `web-ui/app/guidance/page.tsx` — Playbook cards with CRUD actions
- Modify: `web-ui/app/guidance/[id]/page.tsx` — Editor + run button with progress indicator

- [ ] Build playbook-editor component with step reorder (native HTML5 drag)
- [ ] Build guidance list page with create/duplicate/delete
- [ ] Build guidance detail page with editor and save
- [ ] Write runPlaybook server action with driver lifecycle management
- [ ] Add progress indicator (polling temp file for step-by-step status)
- [ ] Verify: create playbook, run against a web URL, captures appear in gallery
- [ ] Commit: `feat: add capture guidance with playbook editor and runner`

---

## Phase 8: Export Screen

### Task 16: Export wizard

**Files:**
- Create: `web-ui/components/export-wizard.tsx` — 3-step wizard: Select (reorder, remove, add), Annotate (caption, highlight rect, crop), Export (format, template, output dir, generate)
- Modify: `web-ui/app/export/page.tsx` — Wraps wizard, reads optional `selected` query param

- [ ] Build step 1 (Select): capture list with native HTML drag reorder, remove, add-more picker
- [ ] Build step 2 (Annotate): caption input, rectangle drawing (pointer events + absolute positioning), crop handles
- [ ] Build step 3 (Export): format radio, template presets, output dir, generate button → POST /api/export
- [ ] Compose export/page.tsx with pre-selection from query params
- [ ] Verify: select captures → annotate → export ZIP + markdown
- [ ] Commit: `feat: add export pipeline wizard`

---

## Dependency Graph

```
Phase 0: Tasks 1+2 (parallel, upstream changes)
Phase 1: Tasks 3→4 (sequential, scaffold)
Phase 2: Tasks 5→6 (sequential, data layer)
Phase 3: Tasks 7+8+9+10 (parallel, all API routes)
Phase 4: Tasks 11→12 (sequential, captures screen)
Phase 5: Task 13 (sessions screen, parallel with Phase 4)
Phase 6: Task 14 (archive, after Task 11 for media-grid reuse)
Phase 7: Task 15 (guidance, after Task 9 for playbooks API)
Phase 8: Task 16 (export, after Tasks 10+11)
```

## Verification

After all tasks:
1. `cd web-ui && npm run build` — production build clean
2. `npm run dev` — all 5 screens render, navigation works
3. Browse real captures from a Spectra session
4. View session timeline with step history
5. Create and run a playbook against a test URL
6. Export captures as markdown + ZIP
7. Archive and restore a capture
8. Upload an external image
