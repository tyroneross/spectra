import { readdir, readFile, stat, writeFile, unlink, mkdir } from 'node:fs/promises'
import { join, resolve, relative, extname, basename } from 'node:path'
import { getStoragePath, findProjectRoot } from 'spectra'
import type {
  Capture,
  CaptureFilters,
  DashboardSession,
  DashboardStep,
  Playbook,
  StorageStats,
} from './types'
import { contentHash } from './utils'
import type { Session, Step } from 'spectra'

// ─── Constants ──────────────────────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov'])
const ALL_MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS])

// ─── Helpers ────────────────────────────────────────────────────────────────

function getProjectRoot(): string {
  const root = findProjectRoot(process.cwd())
  // Fall back to cwd if no marker found (e.g. running from web-ui/ in dev)
  return root ?? process.cwd()
}

function getArtifactsDir(): string {
  return join(getProjectRoot(), 'artifacts')
}

function getSpectraDir(): string {
  return getStoragePath(process.cwd())
}

function getArchiveDir(): string {
  return join(getSpectraDir(), 'archive')
}

function getSessionsDir(): string {
  return join(getSpectraDir(), 'sessions')
}

function getPlaybooksDir(): string {
  return join(getSpectraDir(), 'playbooks')
}

/** Walk a directory recursively, yielding absolute file paths. Returns [] if dir doesn't exist. */
async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    await Promise.all(
      entries.map(async (entry) => {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          const sub = await walkDir(full)
          results.push(...sub)
        } else if (entry.isFile()) {
          results.push(full)
        }
      })
    )
  } catch {
    // directory doesn't exist — return empty
  }
  return results
}

function mediaTypeFromExt(ext: string): 'screenshot' | 'video' | null {
  if (IMAGE_EXTENSIONS.has(ext)) return 'screenshot'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return null
}

function applyFilters(captures: Capture[], filters: CaptureFilters): Capture[] {
  let result = captures

  if (filters.sessionId !== undefined) {
    result = result.filter((c) => c.sessionId === filters.sessionId)
  }
  if (filters.platform !== undefined) {
    result = result.filter((c) => c.platform === filters.platform)
  }
  if (filters.type !== undefined) {
    result = result.filter((c) => c.type === filters.type)
  }
  if (filters.dateFrom !== undefined) {
    result = result.filter((c) => c.timestamp >= filters.dateFrom!)
  }
  if (filters.dateTo !== undefined) {
    result = result.filter((c) => c.timestamp <= filters.dateTo!)
  }
  if (filters.search !== undefined && filters.search.length > 0) {
    const q = filters.search.toLowerCase()
    result = result.filter(
      (c) =>
        c.filename.toLowerCase().includes(q) ||
        (c.sessionName?.toLowerCase().includes(q) ?? false)
    )
  }
  if (filters.archived !== undefined) {
    result = result.filter((c) => c.archived === filters.archived)
  }

  // Sort
  const sort = filters.sort ?? 'date-desc'
  result = [...result].sort((a, b) => {
    switch (sort) {
      case 'date-asc':
        return a.timestamp - b.timestamp
      case 'date-desc':
        return b.timestamp - a.timestamp
      case 'name-asc':
        return a.filename.localeCompare(b.filename)
      case 'name-desc':
        return b.filename.localeCompare(a.filename)
      case 'session':
        return (a.sessionId ?? '').localeCompare(b.sessionId ?? '')
      default:
        return b.timestamp - a.timestamp
    }
  })

  return result
}

// ─── Session metadata cache (lightweight, per-request) ───────────────────────

async function loadSessionMeta(
  sessionId: string
): Promise<{ name?: string; platform?: string } | null> {
  const sessionFile = join(getSessionsDir(), sessionId, 'session.json')
  try {
    const raw = await readFile(sessionFile, 'utf-8')
    const data = JSON.parse(raw) as Partial<Session>
    return { name: data.name, platform: data.platform }
  } catch {
    return null
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * List captures from both artifacts/ and .spectra/sessions/ step screenshots.
 * Archived captures from .spectra/archive/ are NOT included unless filters.archived is explicitly set.
 */
export async function listCaptures(filters?: CaptureFilters): Promise<Capture[]> {
  const projectRoot = getProjectRoot()
  const artifactsDir = getArtifactsDir()
  const sessionsDir = getSessionsDir()

  const [artifactFiles, sessionFiles] = await Promise.all([
    walkDir(artifactsDir),
    walkDir(sessionsDir),
  ])

  // Filter to only step-NNN.png files from sessions
  const stepFiles = sessionFiles.filter((f) => /step-\d+\.(png|jpg|jpeg|webp)$/i.test(basename(f)))

  // Process artifacts
  const artifactCaptures = await Promise.all(
    artifactFiles
      .filter((f) => ALL_MEDIA_EXTENSIONS.has(extname(f).toLowerCase()))
      .map(async (absPath): Promise<Capture | null> => {
        const ext = extname(absPath).toLowerCase().slice(1)
        const type = mediaTypeFromExt(`.${ext}`)
        if (!type) return null
        try {
          const s = await stat(absPath)
          const id = await contentHash(absPath)
          const relPath = relative(projectRoot, absPath)
          return {
            id,
            path: relPath,
            source: 'artifacts',
            filename: basename(absPath),
            type,
            format: ext,
            size: s.size,
            timestamp: s.mtimeMs,
            archived: false,
          }
        } catch {
          return null
        }
      })
  )

  // Process session step files — extract sessionId from path
  const sessionCaptures = await Promise.all(
    stepFiles.map(async (absPath): Promise<Capture | null> => {
      const ext = extname(absPath).toLowerCase().slice(1)
      const type = mediaTypeFromExt(`.${ext}`)
      if (!type) return null
      try {
        const s = await stat(absPath)
        const id = await contentHash(absPath)
        const relPath = relative(projectRoot, absPath)

        // Path structure: .spectra/sessions/<sessionId>/step-NNN.png
        const parts = absPath.split('/')
        const sessionsIdx = parts.lastIndexOf('sessions')
        const sessionId = sessionsIdx >= 0 ? parts[sessionsIdx + 1] : undefined
        const meta = sessionId ? await loadSessionMeta(sessionId) : null

        return {
          id,
          path: relPath,
          source: 'session',
          filename: basename(absPath),
          type,
          format: ext,
          size: s.size,
          sessionId,
          sessionName: meta?.name,
          platform: meta?.platform as Capture['platform'],
          timestamp: s.mtimeMs,
          archived: false,
        }
      } catch {
        return null
      }
    })
  )

  const all = [...artifactCaptures, ...sessionCaptures].filter(
    (c): c is Capture => c !== null
  )

  if (!filters) {
    return all.sort((a, b) => b.timestamp - a.timestamp)
  }
  return applyFilters(all, filters)
}

/**
 * Find a single capture by its content hash ID.
 */
export async function getCapture(id: string): Promise<Capture | null> {
  const captures = await listCaptures()
  return captures.find((c) => c.id === id) ?? null
}

/**
 * List all sessions from .spectra/sessions/
 */
export async function listSessions(): Promise<DashboardSession[]> {
  const sessionsDir = getSessionsDir()
  let entries: string[] = []
  try {
    const dirents = await readdir(sessionsDir, { withFileTypes: true })
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }

  const sessions = await Promise.all(
    entries.map(async (sessionId): Promise<DashboardSession | null> => {
      return getSession(sessionId)
    })
  )

  return sessions
    .filter((s): s is DashboardSession => s !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Load a single session by ID.
 */
export async function getSession(id: string): Promise<DashboardSession | null> {
  const sessionFile = join(getSessionsDir(), id, 'session.json')
  try {
    const raw = await readFile(sessionFile, 'utf-8')
    const data = JSON.parse(raw) as Session & { closedAt?: number }

    // Count step-*.png files for captureCount
    const sessionDir = join(getSessionsDir(), id)
    let captureCount = 0
    try {
      const files = await readdir(sessionDir)
      captureCount = files.filter((f) => /^step-\d+\.(png|jpg|jpeg|webp)$/i.test(f)).length
    } catch {
      // ignore
    }

    const steps: DashboardStep[] = (data.steps ?? []).map(
      (step: Step): DashboardStep => ({
        index: step.index,
        actionType: step.action?.type ?? '',
        elementId: step.action?.elementId ?? '',
        intent: (step as Step & { intent?: string }).intent,
        screenshotPath: step.screenshotPath,
        success: step.success,
        duration: step.duration,
        timestamp: step.timestamp,
      })
    )

    return {
      id: data.id,
      name: data.name,
      platform: data.platform,
      target: data.target,
      steps,
      captureCount,
      status: data.closedAt ? 'closed' : 'active',
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      closedAt: data.closedAt,
    }
  } catch {
    return null
  }
}

/**
 * List all playbooks from .spectra/playbooks/
 */
export async function listPlaybooks(): Promise<Playbook[]> {
  const playbooksDir = getPlaybooksDir()
  let files: string[] = []
  try {
    const entries = await readdir(playbooksDir, { withFileTypes: true })
    files = entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name)
  } catch {
    return []
  }

  const playbooks = await Promise.all(
    files.map(async (filename): Promise<Playbook | null> => {
      try {
        const raw = await readFile(join(playbooksDir, filename), 'utf-8')
        return JSON.parse(raw) as Playbook
      } catch {
        return null
      }
    })
  )

  return playbooks
    .filter((p): p is Playbook => p !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Load a single playbook by ID.
 */
export async function getPlaybook(id: string): Promise<Playbook | null> {
  const playbooksDir = getPlaybooksDir()
  try {
    const raw = await readFile(join(playbooksDir, `${id}.json`), 'utf-8')
    return JSON.parse(raw) as Playbook
  } catch {
    return null
  }
}

/**
 * Persist a playbook to disk.
 */
export async function savePlaybook(playbook: Playbook): Promise<void> {
  const playbooksDir = getPlaybooksDir()
  await mkdir(playbooksDir, { recursive: true })
  await writeFile(
    join(playbooksDir, `${playbook.id}.json`),
    JSON.stringify(playbook, null, 2),
    'utf-8'
  )
}

/**
 * Delete a playbook by ID.
 */
export async function deletePlaybook(id: string): Promise<void> {
  const playbooksDir = getPlaybooksDir()
  await unlink(join(playbooksDir, `${id}.json`))
}

/**
 * List archived captures from .spectra/archive/
 */
export async function listArchived(): Promise<Capture[]> {
  const projectRoot = getProjectRoot()
  const archiveDir = getArchiveDir()
  const files = await walkDir(archiveDir)

  const captures = await Promise.all(
    files
      .filter((f) => ALL_MEDIA_EXTENSIONS.has(extname(f).toLowerCase()))
      .map(async (absPath): Promise<Capture | null> => {
        const ext = extname(absPath).toLowerCase().slice(1)
        const type = mediaTypeFromExt(`.${ext}`)
        if (!type) return null
        try {
          const s = await stat(absPath)
          const id = await contentHash(absPath)
          const relPath = relative(projectRoot, absPath)
          return {
            id,
            path: relPath,
            source: 'artifacts',
            filename: basename(absPath),
            type,
            format: ext,
            size: s.size,
            timestamp: s.mtimeMs,
            archived: true,
          }
        } catch {
          return null
        }
      })
  )

  return captures
    .filter((c): c is Capture => c !== null)
    .sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * Compute storage statistics across artifacts/, .spectra/sessions/, and .spectra/archive/.
 */
export async function getStorageStats(): Promise<StorageStats> {
  const sessionsDir = getSessionsDir()
  const artifactsDir = getArtifactsDir()
  const archiveDir = getArchiveDir()

  const [artifactFiles, sessionEntries, archiveFiles] = await Promise.all([
    walkDir(artifactsDir),
    (async () => {
      try {
        const dirents = await readdir(sessionsDir, { withFileTypes: true })
        return dirents.filter((d) => d.isDirectory()).map((d) => d.name)
      } catch {
        return []
      }
    })(),
    walkDir(archiveDir),
  ])

  let totalSize = 0
  const bySession: StorageStats['bySession'] = []
  const byPlatform: Record<string, number> = {}
  const byType: Record<string, number> = {}

  // Artifact sizes
  await Promise.all(
    artifactFiles.map(async (f) => {
      try {
        const s = await stat(f)
        totalSize += s.size
        const ext = extname(f).toLowerCase().slice(1)
        byType[ext] = (byType[ext] ?? 0) + s.size
      } catch {
        // ignore
      }
    })
  )

  // Archive sizes
  await Promise.all(
    archiveFiles.map(async (f) => {
      try {
        const s = await stat(f)
        totalSize += s.size
        const ext = extname(f).toLowerCase().slice(1)
        byType[ext] = (byType[ext] ?? 0) + s.size
      } catch {
        // ignore
      }
    })
  )

  // Session sizes
  await Promise.all(
    sessionEntries.map(async (sessionId) => {
      const sessionDir = join(sessionsDir, sessionId)
      const sessionFiles = await walkDir(sessionDir)
      let sessionSize = 0

      await Promise.all(
        sessionFiles.map(async (f) => {
          try {
            const s = await stat(f)
            sessionSize += s.size
            totalSize += s.size
            const ext = extname(f).toLowerCase().slice(1)
            byType[ext] = (byType[ext] ?? 0) + s.size
          } catch {
            // ignore
          }
        })
      )

      // Read session.json for name and platform
      let name = sessionId
      let platform: string | undefined
      try {
        const raw = await readFile(join(sessionDir, 'session.json'), 'utf-8')
        const data = JSON.parse(raw) as Partial<Session>
        name = data.name ?? sessionId
        platform = data.platform
      } catch {
        // ignore
      }

      if (platform) {
        byPlatform[platform] = (byPlatform[platform] ?? 0) + sessionSize
      }

      bySession.push({ sessionId, name, size: sessionSize })
    })
  )

  const largestSessions = [...bySession]
    .sort((a, b) => b.size - a.size)
    .slice(0, 5)

  return { totalSize, bySession, byPlatform, byType, largestSessions }
}

/**
 * Resolve a relative media path to an absolute path.
 * Returns null if path traversal is detected or the path is outside allowed directories.
 */
export function resolveMediaPath(relativePath: string): string | null {
  // Reject any obvious traversal patterns before resolving
  if (relativePath.includes('..')) return null

  const projectRoot = getProjectRoot()
  const abs = resolve(projectRoot, relativePath)

  // After resolving, confirm it's still within allowed directories
  const artifactsDir = resolve(getArtifactsDir())
  const spectraDir = resolve(getSpectraDir())

  if (abs.startsWith(artifactsDir + '/') || abs.startsWith(artifactsDir)) return abs
  if (abs.startsWith(spectraDir + '/') || abs.startsWith(spectraDir)) return abs

  return null
}
