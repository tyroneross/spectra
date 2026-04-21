---
name: library
description: Manage the spectra capture library — tag, find, gallery, export, status, delete, migrate from showcase
---

Interact with the spectra library — the persistent, tagged catalog of captures that sits alongside session recordings. This is where captures live long-term for blog posts, docs, and marketing assets.

Use `spectra_library` with one of the actions below. Match the user's intent:

| If the user wants to… | Action | Key params |
|---|---|---|
| See what's in the library, broken out by feature/date/etc. | `gallery` | `groupBy` (default `feature`) |
| Search for captures | `find` | `tagsAny`, `tagsAll`, `feature`, `component`, `platform`, `type`, `since`, `until`, `text`, `limit` |
| Get stats (total captures, storage size, breakdown) | `status` | — |
| Add an existing media file to the library | `add` | `sourcePath` + metadata (`type`, `platform`, `feature`, `tags`, etc.) |
| Look up one capture by id | `get` | `id` |
| Update metadata on a capture | `tag` | `id` + fields to change (`tags`, `feature`, `component`, `starred`, `title`) |
| Remove a capture | `delete` | `id` |
| Export a subset (or all) to a directory with markdown manifest | `export` | `outDir` + any `find` filters + `flatten` / `manifest` |
| Import an old `.showcase/` library | `migrate-from-showcase` | `showcasePath` (default: `./.showcase`) |

## Defaults and formatting

- `find` returns up to `limit` captures (default unlimited). Display as a compact table of `id, title, feature, platform, created_at`. Highlight starred entries.
- `gallery` groups by `feature` by default. Other groupings: `date`, `component`, `platform`, `type`.
- `export` defaults to writing `manifest.md` and per-capture subdirectories. Pass `flatten: true` to put everything in one flat directory (useful for uploads).
- `migrate-from-showcase` is non-destructive. Original files stay in place; imports skip any capture id already present in the library.

## Starring and feature naming

When a user says "this is the one", set `starred: true` via `tag`. Encourage a short `feature` slug (kebab-case) so `gallery` groupings stay tight — e.g. `onboarding`, `checkout`, `settings-menu`. Components should be UI-element-level (`date-picker`, `hero-banner`).
