import { basename } from 'node:path'
import {
  loadIndex,
  updateEntry,
  removeEntry,
  getEntry,
  storeMedia,
  addEntry,
  newCaptureId,
  summarize,
} from '../../library/storage.js'
import { find, groupBy, stats, type FindOptions, type GroupBy } from '../../library/query.js'
import { exportCaptures } from '../../library/export.js'
import { migrateFromShowcase, defaultShowcasePath } from '../../library/migrate.js'
import type { CaptureEntry, Platform } from '../../library/types.js'

export interface LibraryParams {
  /**
   * Action router. All library ops go through this one tool to match the
   * spectra_session / spectra_capture action-dispatch pattern.
   */
  action:
    | 'add'
    | 'find'
    | 'gallery'
    | 'get'
    | 'tag'
    | 'delete'
    | 'status'
    | 'export'
    | 'migrate-from-showcase'

  // Add
  sourcePath?: string
  type?: CaptureEntry['type']
  platform?: Platform
  url?: string
  viewport?: string
  selector?: string
  deviceName?: string
  title?: string
  feature?: string
  component?: string
  tags?: string[]
  starred?: boolean
  walkthrough?: CaptureEntry['walkthrough']
  durationMs?: number
  gitBranch?: string
  gitCommit?: string

  // Find
  tagsAny?: string[]
  tagsAll?: string[]
  since?: string
  until?: string
  text?: string
  limit?: number

  // Gallery
  groupBy?: GroupBy

  // Get / Tag / Delete
  id?: string

  // Export
  outDir?: string
  flatten?: boolean
  manifest?: boolean

  // Migrate
  showcasePath?: string
}

export async function handleLibrary(params: LibraryParams): Promise<unknown> {
  switch (params.action) {
    case 'add':
      return add(params)
    case 'find':
      return findAction(params)
    case 'gallery':
      return gallery(params)
    case 'get':
      return getAction(params)
    case 'tag':
      return tagAction(params)
    case 'delete':
      return deleteAction(params)
    case 'status':
      return statusAction()
    case 'export':
      return exportAction(params)
    case 'migrate-from-showcase':
      return migrate(params)
    default:
      throw new Error(`Unknown library action: ${String(params.action)}`)
  }
}

async function add(params: LibraryParams) {
  if (!params.sourcePath) throw new Error('add requires sourcePath')
  const id = newCaptureId()
  const stored = await storeMedia(id, params.sourcePath)
  const entry: CaptureEntry = {
    id,
    created_at: new Date().toISOString(),
    type: params.type ?? 'screenshot',
    format: stored.format,
    size_bytes: stored.size_bytes,
    duration_ms: params.durationMs,
    source: 'spectra',
    platform: params.platform ?? 'unknown',
    url: params.url,
    viewport: params.viewport,
    selector: params.selector,
    device_name: params.deviceName,
    title: params.title ?? basename(params.sourcePath),
    feature: params.feature,
    component: params.component,
    tags: params.tags,
    starred: params.starred,
    walkthrough: params.walkthrough,
    git_branch: params.gitBranch,
    git_commit: params.gitCommit,
  }
  await addEntry(entry)
  return { added: entry.id, path: stored.path, entry }
}

async function findAction(params: LibraryParams) {
  const idx = await loadIndex()
  const opts: FindOptions = {
    tagsAny: params.tagsAny,
    tagsAll: params.tagsAll,
    feature: params.feature,
    component: params.component,
    platform: params.platform,
    type: params.type,
    since: params.since,
    until: params.until,
    starred: params.starred,
    text: params.text,
    limit: params.limit,
  }
  const results = find(idx.captures, opts)
  return {
    count: results.length,
    captures: results.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      platform: c.platform,
      feature: c.feature,
      component: c.component,
      tags: c.tags,
      url: c.url,
      created_at: c.created_at,
      starred: c.starred,
      summary: summarize(c),
    })),
  }
}

async function gallery(params: LibraryParams) {
  const idx = await loadIndex()
  const by = params.groupBy ?? 'feature'
  const groups = groupBy(idx.captures, by)
  return {
    total: idx.captures.length,
    groupedBy: by,
    groups: groups.map((g) => ({
      key: g.key,
      count: g.captures.length,
      captures: g.captures.map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
        platform: c.platform,
        created_at: c.created_at,
        starred: c.starred,
      })),
    })),
  }
}

async function getAction(params: LibraryParams) {
  if (!params.id) throw new Error('get requires id')
  const entry = await getEntry(params.id)
  if (!entry) return { found: false, id: params.id }
  return { found: true, entry }
}

async function tagAction(params: LibraryParams) {
  if (!params.id) throw new Error('tag requires id')
  const patch: Partial<CaptureEntry> = {}
  if (params.tags !== undefined) patch.tags = params.tags
  if (params.feature !== undefined) patch.feature = params.feature
  if (params.component !== undefined) patch.component = params.component
  if (params.starred !== undefined) patch.starred = params.starred
  if (params.title !== undefined) patch.title = params.title
  const updated = await updateEntry(params.id, patch)
  if (!updated) return { updated: false, id: params.id }
  return { updated: true, entry: updated }
}

async function deleteAction(params: LibraryParams) {
  if (!params.id) throw new Error('delete requires id')
  const removed = await removeEntry(params.id)
  if (!removed) return { removed: false, id: params.id }
  return { removed: true, id: removed.id }
}

async function statusAction() {
  const idx = await loadIndex()
  const s = stats(idx.captures)
  return {
    library_version: idx.version,
    ...s,
    total_size_mb: Number((s.total_size_bytes / 1024 / 1024).toFixed(2)),
  }
}

async function exportAction(params: LibraryParams) {
  if (!params.outDir) throw new Error('export requires outDir')
  const idx = await loadIndex()
  const opts: FindOptions = {
    tagsAny: params.tagsAny,
    tagsAll: params.tagsAll,
    feature: params.feature,
    component: params.component,
    platform: params.platform,
    type: params.type,
    since: params.since,
    until: params.until,
    starred: params.starred,
    text: params.text,
    limit: params.limit,
  }
  const selected = Object.values(opts).some((v) => v !== undefined)
    ? find(idx.captures, opts)
    : idx.captures
  const result = await exportCaptures(selected, {
    outDir: params.outDir,
    manifest: params.manifest ?? true,
    flatten: params.flatten ?? false,
  })
  return { exported: selected.length, ...result }
}

async function migrate(params: LibraryParams) {
  const srcPath = params.showcasePath ?? defaultShowcasePath()
  const report = await migrateFromShowcase(srcPath)
  return report
}
