# Web UX Journeys

Date: 2026-05-24
Scope: `web-ui/`

This pass focuses the dashboard on three recurring marketing-capture jobs: review, inspect, and export. The UI should remain dense enough for repeated work while preserving clear empty, loading, error, and disabled states.

## Journey 1: Review Recent Captures

Entry: `/captures`

Primary user goal: scan the latest screenshots and videos, narrow the set by session, platform, type, date, or search, then select useful media.

Expected behavior:
- The capture count is visible near the page title.
- Filters are a persistent sidebar on desktop and a single mobile disclosure control.
- Related capture tiles share one grid border with divider gaps; tiles do not create stacked card borders.
- Bulk actions are available only when bulk mode is enabled, and export/archive controls are disabled until at least one capture is selected.
- Empty results show a neutral empty state inside the main content area.
- Loading and route errors are handled by `app/loading.tsx` and `app/error.tsx`.

Verification surfaces:
- `/captures`
- `web-ui/components/filter-panel.tsx`
- `web-ui/components/action-bar.tsx`
- `web-ui/components/media-grid.tsx`
- `web-ui/components/media-card.tsx`

## Journey 2: Inspect And Manage One Capture

Entry: `/captures/[id]`

Primary user goal: inspect a single capture, download it, archive it, or delete it without ambiguity.

Expected behavior:
- Destructive actions have a confirmation dialog before deletion.
- Archive and delete use the archive API instead of placeholder copy.
- Action buttons expose distinct loading, enabled, disabled, and error states.
- Controls use icon plus label treatment where the command benefits from fast scanning.
- Error banners appear near the action source when an archive/delete request fails.

Verification surfaces:
- `/captures/[id]`
- `web-ui/components/capture-actions.tsx`
- `web-ui/app/api/archive/route.ts`

## Journey 3: Build An Export Package

Entry: `/export`

Primary user goal: turn selected captures into a reusable documentation or marketing package.

Expected behavior:
- Step controls have consistent hit targets across mobile and desktop.
- Back, next, export, and reset actions show clear enabled/disabled treatment.
- The flow does not display "coming soon" or placeholder feature copy as if it were functional.
- Export errors remain in context and do not strand the user.

Verification surfaces:
- `/export`
- `web-ui/components/export-wizard.tsx`
- `/guidance/[id]`
- `web-ui/app/guidance/[id]/playbook-page-client.tsx`
- `web-ui/components/playbook-editor.tsx`

## Local Verification

Run:

```bash
cd web-ui
npm test
npx tsc --noEmit
npm run dev -- -p 4300
```

Then scan `http://localhost:4300/captures`, `http://localhost:4300/export`, and one capture detail route with the verifier tooling.
