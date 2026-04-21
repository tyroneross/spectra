import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, cp, stat, rm } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { getStoragePath } from '../core/storage.js'
import type { CaptureEntry, LibraryIndex } from './types.js'
import { LIBRARY_VERSION } from './types.js'

export function getLibraryPath(cwd?: string): string {
  return join(getStoragePath(cwd), 'library')
}

export function getLibraryIndexPath(cwd?: string): string {
  return join(getLibraryPath(cwd), 'index.json')
}

export function getLibraryMediaPath(cwd?: string): string {
  return join(getLibraryPath(cwd), 'media')
}

export async function ensureLibraryDirs(cwd?: string): Promise<void> {
  await mkdir(getLibraryMediaPath(cwd), { recursive: true })
  const indexPath = getLibraryIndexPath(cwd)
  if (!existsSync(indexPath)) {
    const empty: LibraryIndex = { version: LIBRARY_VERSION, captures: [] }
    await writeFile(indexPath, JSON.stringify(empty, null, 2))
  }
}

export async function loadIndex(cwd?: string): Promise<LibraryIndex> {
  await ensureLibraryDirs(cwd)
  const raw = await readFile(getLibraryIndexPath(cwd), 'utf8')
  const parsed = JSON.parse(raw) as LibraryIndex
  if (!parsed.captures) parsed.captures = []
  if (!parsed.version) parsed.version = LIBRARY_VERSION
  return parsed
}

export async function saveIndex(index: LibraryIndex, cwd?: string): Promise<void> {
  await ensureLibraryDirs(cwd)
  const atomic = getLibraryIndexPath(cwd) + '.tmp'
  await writeFile(atomic, JSON.stringify(index, null, 2))
  const { rename } = await import('node:fs/promises')
  await rename(atomic, getLibraryIndexPath(cwd))
}

export function newCaptureId(): string {
  return 'cap_' + randomBytes(6).toString('hex')
}

/**
 * Copy a media file into the library at media/<captureId>/<basename>.
 * Returns the absolute path where it was stored.
 */
export async function storeMedia(
  captureId: string,
  sourcePath: string,
  cwd?: string,
): Promise<{ path: string; size_bytes: number; format: string }> {
  const destDir = join(getLibraryMediaPath(cwd), captureId)
  await mkdir(destDir, { recursive: true })
  const fileName = 'original' + extname(sourcePath)
  const dest = join(destDir, fileName)
  await cp(sourcePath, dest)
  const s = await stat(dest)
  return {
    path: dest,
    size_bytes: s.size,
    format: extname(sourcePath).slice(1) || 'bin',
  }
}

export async function deleteCaptureMedia(
  captureId: string,
  cwd?: string,
): Promise<void> {
  const dir = join(getLibraryMediaPath(cwd), captureId)
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true })
  }
}

export async function addEntry(
  entry: CaptureEntry,
  cwd?: string,
): Promise<void> {
  const idx = await loadIndex(cwd)
  idx.captures.push(entry)
  await saveIndex(idx, cwd)
}

export async function updateEntry(
  id: string,
  patch: Partial<CaptureEntry>,
  cwd?: string,
): Promise<CaptureEntry | null> {
  const idx = await loadIndex(cwd)
  const i = idx.captures.findIndex((c) => c.id === id)
  if (i === -1) return null
  idx.captures[i] = { ...idx.captures[i], ...patch, id: idx.captures[i].id }
  await saveIndex(idx, cwd)
  return idx.captures[i]
}

export async function removeEntry(
  id: string,
  cwd?: string,
): Promise<CaptureEntry | null> {
  const idx = await loadIndex(cwd)
  const i = idx.captures.findIndex((c) => c.id === id)
  if (i === -1) return null
  const [removed] = idx.captures.splice(i, 1)
  await saveIndex(idx, cwd)
  await deleteCaptureMedia(id, cwd)
  return removed
}

export async function getEntry(
  id: string,
  cwd?: string,
): Promise<CaptureEntry | null> {
  const idx = await loadIndex(cwd)
  return idx.captures.find((c) => c.id === id) ?? null
}

/**
 * Utility: read basename of a capture's stored media for an index entry.
 * Library stores every capture under media/<id>/original.<ext>, so the
 * media path is derivable from the id + format.
 */
export function mediaPathForEntry(entry: CaptureEntry, cwd?: string): string {
  return join(getLibraryMediaPath(cwd), entry.id, `original.${entry.format}`)
}

/** For debug / UIs: a one-line summary of a capture. */
export function summarize(e: CaptureEntry): string {
  const parts = [
    e.id,
    e.type,
    e.platform,
    e.feature || '-',
    e.title || basename(e.url ?? '') || '-',
  ]
  return parts.join(' | ')
}
