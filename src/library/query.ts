import type { CaptureEntry } from './types.js'

export interface FindOptions {
  /** Match any of these tags (OR). If both tagsAll and tagsAny are given, both must pass. */
  tagsAny?: string[]
  /** Match all of these tags (AND). */
  tagsAll?: string[]
  feature?: string
  component?: string
  platform?: string
  type?: string
  /** Created on or after this ISO date */
  since?: string
  /** Created on or before this ISO date */
  until?: string
  starred?: boolean
  /** Free-text match against title/tags/feature/component */
  text?: string
  /** Cap results */
  limit?: number
}

export function find(all: CaptureEntry[], opts: FindOptions): CaptureEntry[] {
  let out = all.slice()

  if (opts.tagsAny && opts.tagsAny.length) {
    const wanted = new Set(opts.tagsAny.map((t) => t.toLowerCase()))
    out = out.filter((c) => (c.tags || []).some((t) => wanted.has(t.toLowerCase())))
  }
  if (opts.tagsAll && opts.tagsAll.length) {
    const required = opts.tagsAll.map((t) => t.toLowerCase())
    out = out.filter((c) => {
      const have = new Set((c.tags || []).map((t) => t.toLowerCase()))
      return required.every((t) => have.has(t))
    })
  }
  if (opts.feature) out = out.filter((c) => c.feature === opts.feature)
  if (opts.component) out = out.filter((c) => c.component === opts.component)
  if (opts.platform) out = out.filter((c) => c.platform === opts.platform)
  if (opts.type) out = out.filter((c) => c.type === opts.type)
  if (opts.starred === true) out = out.filter((c) => c.starred === true)

  if (opts.since) {
    const t = Date.parse(opts.since)
    if (!Number.isNaN(t)) out = out.filter((c) => Date.parse(c.created_at) >= t)
  }
  if (opts.until) {
    const t = Date.parse(opts.until)
    if (!Number.isNaN(t)) out = out.filter((c) => Date.parse(c.created_at) <= t)
  }

  if (opts.text) {
    const q = opts.text.toLowerCase()
    out = out.filter((c) => {
      const blob = [
        c.title || '',
        c.feature || '',
        c.component || '',
        ...(c.tags || []),
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }

  // Newest first
  out.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))

  if (opts.limit && opts.limit > 0) out = out.slice(0, opts.limit)
  return out
}

export type GroupBy = 'feature' | 'date' | 'component' | 'platform' | 'type'

export function groupBy(
  all: CaptureEntry[],
  by: GroupBy,
): Array<{ key: string; captures: CaptureEntry[] }> {
  const groups = new Map<string, CaptureEntry[]>()
  for (const c of all) {
    let key = '(none)'
    if (by === 'feature') key = c.feature || '(none)'
    else if (by === 'component') key = c.component || '(none)'
    else if (by === 'platform') key = c.platform
    else if (by === 'type') key = c.type
    else if (by === 'date') key = c.created_at.slice(0, 10)
    const list = groups.get(key) ?? []
    list.push(c)
    groups.set(key, list)
  }
  return Array.from(groups.entries())
    .map(([key, captures]) => ({ key, captures }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

export interface LibraryStats {
  total: number
  by_type: Record<string, number>
  by_platform: Record<string, number>
  by_feature: Record<string, number>
  total_size_bytes: number
  oldest?: string
  newest?: string
  starred_count: number
}

export function stats(all: CaptureEntry[]): LibraryStats {
  const s: LibraryStats = {
    total: all.length,
    by_type: {},
    by_platform: {},
    by_feature: {},
    total_size_bytes: 0,
    starred_count: 0,
  }
  for (const c of all) {
    s.by_type[c.type] = (s.by_type[c.type] ?? 0) + 1
    s.by_platform[c.platform] = (s.by_platform[c.platform] ?? 0) + 1
    if (c.feature) s.by_feature[c.feature] = (s.by_feature[c.feature] ?? 0) + 1
    s.total_size_bytes += c.size_bytes || 0
    if (c.starred) s.starred_count += 1
  }
  if (all.length) {
    const sorted = all.slice().sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    )
    s.oldest = sorted[0].created_at
    s.newest = sorted[sorted.length - 1].created_at
  }
  return s
}
