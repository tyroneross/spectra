import { access, copyFile, readdir, readFile, stat, writeFile, unlink, mkdir, utimes } from 'node:fs/promises'
import { join, resolve, relative, extname, basename, dirname, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import type {
  Capture,
  CaptureFilters,
  CaptureImportCandidate,
  CaptureImportResult,
  DashboardSession,
  DashboardStep,
  Playbook,
  PlaybookRecommendation,
  ProductionBundleDetail,
  ProductionBundleSummary,
  StorageStats,
} from './types'
import { contentHash } from './utils'
import type { CapturePreset, CaptureRunArtifact, CaptureRunManifest, ProductionBundleManifest, Session, Step } from 'spectra'

// ─── Constants ──────────────────────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov'])
const ALL_MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS])

type SessionMeta = {
  name?: string
  platform?: string
  target?: Session['target']
  steps?: Step[]
  storageRoot?: string
  run?: CaptureRunManifest
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getProjectRoot(): string {
  const cwd = process.cwd()
  return basename(cwd) === 'web-ui' ? dirname(cwd) : cwd
}

function getArtifactsDir(): string {
  return join(getProjectRoot(), 'artifacts')
}

export function getSpectraDir(): string {
  return join(getProjectRoot(), '.spectra')
}

function getRepoName(): string {
  return basename(getProjectRoot())
}

function safePathSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'repo'
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath)
    return true
  } catch {
    return false
  }
}

function isPathInside(candidate: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

function captureId(source: Capture['source'], relPath: string): string {
  return createHash('sha256').update(`${source}:${relPath}`).digest('hex').slice(0, 16)
}

function importCandidateId(repoPath: string, sourceType: CaptureImportCandidate['sourceType'], sourceRoot: string): string {
  return createHash('sha256')
    .update(`capture-import:${repoPath}:${sourceType}:${sourceRoot}`)
    .digest('hex')
    .slice(0, 16)
}

function normalizeSessionRelPath(value: string): string {
  return value.replace(/^\.\/+/, '')
}

function projectDisplayNameFromSlug(slug: string, filename?: string): string {
  const normalizedSlug = slug.toLowerCase()
  const normalizedFile = filename?.toLowerCase() ?? ''

  if (
    normalizedSlug === 'flodoro' ||
    normalizedSlug === 'flowdoro' ||
    normalizedSlug === 'sim-test-2026-03-18' ||
    normalizedFile.includes('flowdoro') ||
    normalizedFile.includes('flodoro')
  ) {
    return 'TruePace'
  }

  if (normalizedSlug === 'atomize-ai') {
    if (
      normalizedFile.endsWith('-framed.png') ||
      normalizedFile.startsWith('frame-')
    ) {
      return 'Unknown'
    }
    return 'Atomize AI'
  }

  if (normalizedSlug === 'atomize-news') return 'Atomize News'
  if (normalizedSlug === 'test-results-dashboard') return 'Test Results Dashboard'

  return slug || 'Unknown'
}

function projectNameFromArtifactPath(relPath: string, repoName: string): string {
  const parts = relPath.split('/')
  if (parts[0] !== 'artifacts') return repoName
  if (parts.length < 3) return 'Unknown'
  return projectDisplayNameFromSlug(parts[1] || repoName, basename(relPath))
}

function projectNameFromStorageRoot(storageRoot?: string): string | undefined {
  if (!storageRoot) return undefined
  const marker = `${getSpectraDir().split('/').pop() ?? '.spectra'}/sessions`
  const markerIndex = storageRoot.indexOf(`/${marker}/`)
  if (markerIndex <= 0) return undefined
  return basename(storageRoot.slice(0, markerIndex))
}

function projectNameFromSessionMeta(meta: SessionMeta | null, repoName: string): string {
  return projectNameFromStorageRoot(meta?.storageRoot) ?? repoName
}

function sessionTypeFromMeta(meta: SessionMeta | null): string | undefined {
  return meta?.run?.name ?? meta?.name
}

function guideForSessionMedia(meta: SessionMeta | null, relPath: string): string | undefined {
  const normalized = normalizeSessionRelPath(relPath)
  const step = meta?.steps?.find((s) => normalizeSessionRelPath(s.screenshotPath) === normalized)
  if (step?.intent) return step.intent

  const artifact = meta?.run?.artifacts?.find((a) => normalizeSessionRelPath(a.path) === normalized)
  if (artifact?.label) return artifact.label

  const action = meta?.run?.actions?.find((a) => normalizeSessionRelPath(a.screenshotPath) === normalized)
  if (action?.intent) return action.intent

  const recordingPath = meta?.run?.recording?.path
  if (recordingPath && normalizeSessionRelPath(recordingPath) === normalized) {
    return meta?.run?.planner.note
  }

  return undefined
}

function artifactForSessionMedia(meta: SessionMeta | null, relPath: string): CaptureRunArtifact | undefined {
  const normalized = normalizeSessionRelPath(relPath)
  return meta?.run?.artifacts?.find((artifact) => normalizeSessionRelPath(artifact.path) === normalized)
}

function capturePresetFromMetadata(metadata?: Record<string, unknown>): CapturePreset | undefined {
  const value = metadata?.preset
  if (
    value === 'docs' ||
    value === 'demo' ||
    value === 'social' ||
    value === 'app-store'
  ) {
    return value
  }
  return undefined
}

function productionReadyFromMetadata(metadata?: Record<string, unknown>): boolean | undefined {
  return typeof metadata?.productionReady === 'boolean' ? metadata.productionReady : undefined
}

function plannerLabel(source?: string): string {
  switch (source) {
    case 'host-agent':
      return 'host agent'
    case 'standalone-fallback':
      return 'standalone fallback'
    case 'manual':
      return 'manual'
    default:
      return 'unknown'
  }
}

function formatTimestamp(timestamp?: number): string | undefined {
  if (!timestamp) return undefined
  return new Date(timestamp).toISOString()
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter(Boolean) as string[])]
}

function guideDetailsForSessionMedia(
  meta: SessionMeta | null,
  relPath: string,
  type: Capture['type']
): string[] | undefined {
  const normalized = normalizeSessionRelPath(relPath)
  const step = meta?.steps?.find((s) => normalizeSessionRelPath(s.screenshotPath) === normalized)
  const artifact = meta?.run?.artifacts?.find((a) => normalizeSessionRelPath(a.path) === normalized)
  const action = meta?.run?.actions?.find((a) => normalizeSessionRelPath(a.screenshotPath) === normalized)
  const decision = action?.decisionId || step?.decisionId
    ? meta?.run?.decisions?.find((d) => d.id === (action?.decisionId ?? step?.decisionId))
    : undefined
  const instruction = step?.intent ?? action?.intent ?? artifact?.label ?? guideForSessionMedia(meta, relPath)
  const sessionType = sessionTypeFromMeta(meta)
  const toolCalls = unique([
    decision?.tool,
    action?.tool,
    step ? 'spectra_step' : undefined,
    artifact || step || type === 'screenshot' || type === 'video' ? 'spectra_capture' : undefined,
  ])
  const plannerSource = action?.plannerSource ?? decision?.plannerSource ?? meta?.run?.planner?.source
  const calledAt = formatTimestamp(action?.timestamp ?? artifact?.createdAt ?? step?.timestamp)
  const details = [
    instruction ? `Instruction: ${instruction}` : undefined,
    sessionType ? `Session type: ${sessionType}` : undefined,
    toolCalls.length > 0 ? `Tools: ${toolCalls.join(' -> ')}` : undefined,
    `Planner: ${plannerLabel(plannerSource)}`,
    calledAt ? `Called: ${calledAt}` : undefined,
    `Artifact: ${relPath}`,
  ]

  return unique(details)
}

function guideDetailsForArtifact(relPath: string, projectName: string): string[] {
  return [
    `Project: ${projectName}`,
    'Source: artifacts folder',
    `Artifact: ${relPath}`,
  ]
}

async function optionalContentHash(absPath: string): Promise<string | undefined> {
  try {
    return await contentHash(absPath)
  } catch {
    return undefined
  }
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

function getProductionsDir(): string {
  return join(getSpectraDir(), 'productions')
}

function targetToString(target?: Session['target']): string {
  if (!target) return ''
  return target.url ?? target.appName ?? target.deviceId ?? target.command ?? ''
}

function normalizeIntent(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTarget(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return `${url.protocol}//local-dev${url.pathname}`.replace(/\/$/, '')
    }
    return `${url.protocol}//${url.hostname}${url.pathname}`.replace(/\/$/, '')
  } catch {
    return trimmed.toLowerCase().replace(/\s+/g, ' ')
  }
}

function playbookFlowKey(platform: Playbook['platform'], target: string, steps: Playbook['steps']): string {
  const sequence = steps.map((step) => `${normalizeIntent(step.intent)}:${step.captureType}`).join('>')
  return `${platform}|${normalizeTarget(target)}|${sequence}`
}

function recommendationId(key: string): string {
  return createHash('sha256').update(`playbook-recommendation:${key}`).digest('hex').slice(0, 16)
}

function productionBundleId(relPath: string): string {
  return createHash('sha256').update(`production-bundle:${relPath}`).digest('hex').slice(0, 16)
}

function parseBundleTimestamp(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isProductionBundleManifest(value: unknown): value is ProductionBundleManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<ProductionBundleManifest>
  return manifest.schemaVersion === 1
    && typeof manifest.title === 'string'
    && Array.isArray(manifest.sources)
    && Array.isArray(manifest.assets)
    && !!manifest.quality
    && typeof manifest.quality.status === 'string'
    && typeof manifest.quality.score === 'number'
}

async function readProductionBundleDetail(manifestAbs: string): Promise<ProductionBundleDetail | null> {
  const projectRoot = getProjectRoot()

  try {
    const [raw, manifestStat] = await Promise.all([
      readFile(manifestAbs, 'utf-8'),
      stat(manifestAbs).catch(() => ({ mtimeMs: 0 })),
    ])
    const parsed = JSON.parse(raw) as unknown
    if (!isProductionBundleManifest(parsed)) return null

    const bundleDir = dirname(manifestAbs)
    const relManifest = relative(projectRoot, manifestAbs)
    const relBundleDir = relative(projectRoot, bundleDir)
    const readmeAbs = join(bundleDir, 'README.md')
    const qualityAbs = join(bundleDir, 'quality-report.json')
    const assets = parsed.assets ?? []

    return {
      id: productionBundleId(relManifest),
      title: parsed.title,
      path: relBundleDir,
      createdAt: parseBundleTimestamp(parsed.createdAt, manifestStat.mtimeMs),
      preset: parsed.preset,
      status: parsed.quality.status,
      score: parsed.quality.score,
      assetCount: assets.length,
      sourceCount: parsed.sources.length,
      totalSize: assets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0),
      manifestPath: relManifest,
      readmePath: await pathExists(readmeAbs) ? relative(projectRoot, readmeAbs) : undefined,
      qualityReportPath: await pathExists(qualityAbs) ? relative(projectRoot, qualityAbs) : undefined,
      manifest: parsed,
    }
  } catch {
    return null
  }
}

function summarizeProductionBundle(detail: ProductionBundleDetail): ProductionBundleSummary {
  const { manifest: _manifest, ...summary } = detail
  return summary
}

async function listProductionBundleDetails(): Promise<ProductionBundleDetail[]> {
  const productionsDir = getProductionsDir()
  const files = await walkDir(productionsDir)
  const manifestFiles = files.filter((file) => basename(file) === 'manifest.json')

  const bundles = await Promise.all(
    manifestFiles.map((manifestAbs) => readProductionBundleDetail(manifestAbs))
  )

  return bundles
    .filter((bundle): bundle is ProductionBundleDetail => bundle !== null)
    .sort((a, b) => b.createdAt - a.createdAt || a.title.localeCompare(b.title))
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

function isMediaFile(absPath: string): boolean {
  return ALL_MEDIA_EXTENSIONS.has(extname(absPath).toLowerCase())
}

async function mediaFilesUnder(dir: string): Promise<string[]> {
  return (await walkDir(dir)).filter(isMediaFile)
}

async function destinationMatchesSourceFiles(
  sourceRoot: string,
  destinationRoot: string,
  sourceFiles: string[]
): Promise<boolean> {
  if (sourceFiles.length === 0) return false

  for (const srcAbs of sourceFiles) {
    const rel = relative(sourceRoot, srcAbs)
    if (rel.startsWith('..') || isAbsolute(rel)) return false

    const destAbs = join(destinationRoot, rel)
    if (!(await pathExists(destAbs))) return false

    const [srcHash, destHash] = await Promise.all([
      optionalContentHash(srcAbs),
      optionalContentHash(destAbs),
    ])
    if (!srcHash || !destHash || srcHash !== destHash) return false
  }

  return true
}

async function listSiblingRepoRoots(): Promise<string[]> {
  const projectRoot = getProjectRoot()
  const parentDir = dirname(projectRoot)
  try {
    const entries = await readdir(parentDir, { withFileTypes: true })
    const roots = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const repoPath = join(parentDir, entry.name)
          if (repoPath === projectRoot) return null
          if (!(await pathExists(join(repoPath, '.git')))) return null
          return repoPath
        })
    )
    return roots.filter((root): root is string => root !== null)
  } catch {
    return []
  }
}

function importDestinationFor(repoName: string, sourceType: CaptureImportCandidate['sourceType']): {
  destinationProject: string
  destinationRoot: string
} {
  const destinationProject = safePathSegment(repoName)
  const sourceFolder = sourceType === 'sessions' ? 'spectra-sessions' : 'artifacts'
  return {
    destinationProject,
    destinationRoot: `artifacts/${destinationProject}/${sourceFolder}`,
  }
}

async function buildImportCandidate(
  repoPath: string,
  sourceType: CaptureImportCandidate['sourceType'],
  sourceRoot: string
): Promise<CaptureImportCandidate | null> {
  const files = await mediaFilesUnder(sourceRoot)
  if (files.length === 0) return null

  const stats = await Promise.all(
    files.map(async (file) => {
      try {
        return await stat(file)
      } catch {
        return null
      }
    })
  )
  const validStats = stats.filter((s): s is NonNullable<typeof s> => s !== null)
  const repoName = basename(repoPath)
  const { destinationProject, destinationRoot } = importDestinationFor(repoName, sourceType)
  const destinationAbs = join(getProjectRoot(), destinationRoot)
  const alreadyImported = await destinationMatchesSourceFiles(sourceRoot, destinationAbs, files)

  return {
    id: importCandidateId(repoPath, sourceType, sourceRoot),
    repoName,
    repoPath,
    sourceType,
    sourceRoot,
    destinationProject,
    destinationRoot,
    fileCount: files.length,
    totalSize: validStats.reduce((sum, s) => sum + s.size, 0),
    latestTimestamp: validStats.length > 0 ? Math.max(...validStats.map((s) => s.mtimeMs)) : 0,
    alreadyImported,
  }
}

async function destinationForImport(srcAbs: string, destAbs: string): Promise<{ path: string; skip: boolean }> {
  if (!(await pathExists(destAbs))) return { path: destAbs, skip: false }

  const [srcHash, destHash] = await Promise.all([
    optionalContentHash(srcAbs),
    optionalContentHash(destAbs),
  ])
  if (srcHash && destHash && srcHash === destHash) {
    return { path: destAbs, skip: true }
  }

  const ext = extname(destAbs)
  const base = basename(destAbs, ext)
  const dir = dirname(destAbs)
  const suffix = createHash('sha256').update(srcAbs).digest('hex').slice(0, 8)
  let candidate = join(dir, `${base}-imported-${suffix}${ext}`)
  let index = 2
  while (await pathExists(candidate)) {
    candidate = join(dir, `${base}-imported-${suffix}-${index}${ext}`)
    index += 1
  }
  return { path: candidate, skip: false }
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
  if (filters.project !== undefined) {
    result = result.filter((c) => c.projectName === filters.project)
  }
  if (filters.sessionType !== undefined) {
    result = result.filter((c) => c.sessionType === filters.sessionType)
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
        (c.sessionName?.toLowerCase().includes(q) ?? false) ||
        (c.repoName?.toLowerCase().includes(q) ?? false) ||
        (c.projectName?.toLowerCase().includes(q) ?? false) ||
        (c.productName?.toLowerCase().includes(q) ?? false) ||
        (c.sessionType?.toLowerCase().includes(q) ?? false) ||
        (c.guide?.toLowerCase().includes(q) ?? false) ||
        (c.guideDetails?.some((detail) => detail.toLowerCase().includes(q)) ?? false)
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
): Promise<SessionMeta | null> {
  const sessionFile = join(getSessionsDir(), sessionId, 'session.json')
  try {
    const raw = await readFile(sessionFile, 'utf-8')
    const data = JSON.parse(raw) as Partial<Session>
    return {
      name: data.name,
      platform: data.platform,
      target: data.target,
      steps: data.steps,
      storageRoot: data.storageRoot,
      run: await loadRunManifest(sessionId),
    }
  } catch {
    return null
  }
}

async function loadRunManifest(sessionId: string): Promise<CaptureRunManifest | undefined> {
  const runFile = join(getSessionsDir(), sessionId, 'run.json')
  try {
    const raw = await readFile(runFile, 'utf-8')
    return JSON.parse(raw) as CaptureRunManifest
  } catch {
    return undefined
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * List production bundles written under .spectra/productions/.
 */
export async function listProductionBundles(): Promise<ProductionBundleSummary[]> {
  const details = await listProductionBundleDetails()
  return details.map(summarizeProductionBundle)
}

/**
 * Load a single production bundle, including its source manifest.
 */
export async function getProductionBundle(id: string): Promise<ProductionBundleDetail | null> {
  const details = await listProductionBundleDetails()
  return details.find((bundle) => bundle.id === id) ?? null
}

/**
 * Discover media in sibling git repos that can be copied into this Spectra repo.
 */
export async function listCaptureImportCandidates(): Promise<CaptureImportCandidate[]> {
  const repoRoots = await listSiblingRepoRoots()
  const candidates = await Promise.all(
    repoRoots.flatMap((repoPath) => {
      const sourceRoots: Array<{
        sourceType: CaptureImportCandidate['sourceType']
        sourceRoot: string
      }> = [
        { sourceType: 'artifacts', sourceRoot: join(repoPath, 'artifacts') },
        { sourceType: 'sessions', sourceRoot: join(repoPath, '.spectra', 'sessions') },
      ]

      return sourceRoots.map(async ({ sourceType, sourceRoot }) => {
        if (!(await pathExists(sourceRoot))) return null
        return buildImportCandidate(repoPath, sourceType, sourceRoot)
      })
    })
  )

  return candidates
    .filter((candidate): candidate is CaptureImportCandidate => candidate !== null)
    .sort((a, b) => b.latestTimestamp - a.latestTimestamp || a.repoName.localeCompare(b.repoName))
}

/**
 * Copy selected import candidates into artifacts/<repo>/... inside this repo.
 */
export async function importCaptureCandidates(candidateIds?: string[]): Promise<CaptureImportResult[]> {
  const candidates = await listCaptureImportCandidates()
  const selectedIds = candidateIds ? new Set(candidateIds) : null
  const selected = candidates.filter((candidate) => {
    if (selectedIds) return selectedIds.has(candidate.id)
    return !candidate.alreadyImported
  })

  const results: CaptureImportResult[] = []
  const projectRoot = getProjectRoot()

  for (const candidate of selected) {
    const result: CaptureImportResult = {
      candidateId: candidate.id,
      repoName: candidate.repoName,
      sourceType: candidate.sourceType,
      destinationRoot: candidate.destinationRoot,
      copied: 0,
      skipped: 0,
      errors: [],
    }

    const sourceFiles = await mediaFilesUnder(candidate.sourceRoot)
    for (const srcAbs of sourceFiles) {
      const rel = relative(candidate.sourceRoot, srcAbs)
      if (rel.includes('..')) {
        result.errors.push(`Skipped unsafe path: ${rel}`)
        continue
      }

      const destAbs = join(projectRoot, candidate.destinationRoot, rel)
      try {
        const destination = await destinationForImport(srcAbs, destAbs)
        if (destination.skip) {
          result.skipped += 1
          continue
        }

        await mkdir(dirname(destination.path), { recursive: true })
        await copyFile(srcAbs, destination.path)
        const sourceStat = await stat(srcAbs)
        await utimes(destination.path, sourceStat.atime, sourceStat.mtime)
        result.copied += 1
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Copy failed'
        result.errors.push(`${rel}: ${message}`)
      }
    }

    results.push(result)
  }

  return results
}

/**
 * List captures from both artifacts/ and .spectra/sessions/ media.
 * Archived captures from .spectra/archive/ are NOT included unless filters.archived is explicitly set.
 */
export async function listCaptures(filters?: CaptureFilters): Promise<Capture[]> {
  const projectRoot = getProjectRoot()
  const repoName = getRepoName()
  const artifactsDir = getArtifactsDir()
  const sessionsDir = getSessionsDir()

  const [artifactFiles, sessionFiles] = await Promise.all([
    walkDir(artifactsDir),
    walkDir(sessionsDir),
  ])

  // Include session screenshots, manual captures, discover outputs, and encoded videos.
  const sessionMediaFiles = sessionFiles.filter((f) => ALL_MEDIA_EXTENSIONS.has(extname(f).toLowerCase()))

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
          const relPath = relative(projectRoot, absPath)
          const projectName = projectNameFromArtifactPath(relPath, repoName)
          return {
            id: captureId('artifacts', relPath),
            path: relPath,
            source: 'artifacts',
            filename: basename(absPath),
            type,
            format: ext,
            size: s.size,
            timestamp: s.mtimeMs,
            archived: false,
            repoName,
            repoPath: projectRoot,
            projectName,
            productName: projectName,
            guideDetails: guideDetailsForArtifact(relPath, projectName),
            contentHash: await optionalContentHash(absPath),
          }
        } catch {
          return null
        }
      })
  )

  // Process session media files — extract sessionId from path
  const sessionCaptures = await Promise.all(
    sessionMediaFiles.map(async (absPath): Promise<Capture | null> => {
      const ext = extname(absPath).toLowerCase().slice(1)
      const type = mediaTypeFromExt(`.${ext}`)
      if (!type) return null
      try {
        const s = await stat(absPath)
        const relPath = relative(projectRoot, absPath)

        // Path structure: .spectra/sessions/<sessionId>/<media>
        const parts = absPath.split('/')
        const sessionsIdx = parts.lastIndexOf('sessions')
        const sessionId = sessionsIdx >= 0 ? parts[sessionsIdx + 1] : undefined
        const meta = sessionId ? await loadSessionMeta(sessionId) : null
        const sessionRelPath = sessionId
          ? relative(join(getSessionsDir(), sessionId), absPath)
          : basename(absPath)
        const projectName = projectNameFromSessionMeta(meta, repoName)
        const sessionType = sessionTypeFromMeta(meta)
        const artifact = artifactForSessionMedia(meta, sessionRelPath)
        const recordingPath = meta?.run?.recording?.path
        const isRecording = recordingPath
          ? normalizeSessionRelPath(recordingPath) === normalizeSessionRelPath(sessionRelPath)
          : false
        const preset = capturePresetFromMetadata(artifact?.metadata)
          ?? (isRecording ? meta?.run?.recording?.preset : undefined)

        return {
          id: captureId('session', relPath),
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
          repoName,
          repoPath: projectRoot,
          projectName,
          productName: projectName,
          sessionType,
          guide: guideForSessionMedia(meta, sessionRelPath),
          guideDetails: guideDetailsForSessionMedia(meta, sessionRelPath, type),
          preset,
          productionReady: productionReadyFromMetadata(artifact?.metadata),
          contentHash: await optionalContentHash(absPath),
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

    // Count all media files for captureCount
    const sessionDir = join(getSessionsDir(), id)
    let captureCount = 0
    try {
      const files = await walkDir(sessionDir)
      captureCount = files.filter((f) => ALL_MEDIA_EXTENSIONS.has(extname(f).toLowerCase())).length
    } catch {
      // ignore
    }
    const run = await loadRunManifest(id)
    const sessionMeta: SessionMeta = {
      name: data.name,
      platform: data.platform,
      target: data.target,
      steps: data.steps,
      storageRoot: data.storageRoot,
      run,
    }
    const repoName = getRepoName()
    const projectName = projectNameFromSessionMeta(sessionMeta, repoName)
    const sessionType = sessionTypeFromMeta(sessionMeta)

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
        decisionId: step.decisionId,
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
      projectName,
      sessionType,
      run,
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
 * Draft playbooks from repeated successful session flows.
 */
export async function listPlaybookRecommendations(minOccurrences = 2): Promise<PlaybookRecommendation[]> {
  const [sessions, playbooks] = await Promise.all([
    listSessions(),
    listPlaybooks(),
  ])
  const existingKeys = new Set(
    playbooks.map((playbook) => playbookFlowKey(playbook.platform, playbook.target, playbook.steps))
  )
  const groups = new Map<
    string,
    {
      key: string
      name: string
      target: string
      platform: Playbook['platform']
      steps: Playbook['steps']
      evidence: PlaybookRecommendation['evidence']
      lastSeenAt: number
    }
  >()

  for (const session of sessions) {
    const steps = playbookStepsForSession(session)

    if (steps.length === 0) continue

    const target = targetToString(session.target)
    const key = playbookFlowKey(session.platform, target, steps)
    const existing = groups.get(key)
    const evidence = {
      sessionId: session.id,
      sessionName: session.name,
      updatedAt: session.updatedAt,
    }

    if (existing) {
      existing.evidence.push(evidence)
      if (session.updatedAt > existing.lastSeenAt) {
        existing.name = session.name
        existing.target = target
        existing.lastSeenAt = session.updatedAt
      }
      continue
    }

    groups.set(key, {
      key,
      name: session.name,
      target,
      platform: session.platform,
      steps,
      evidence: [evidence],
      lastSeenAt: session.updatedAt,
    })
  }

  return [...groups.values()]
    .filter((group) => group.evidence.length >= minOccurrences)
    .filter((group) => !existingKeys.has(group.key))
    .map((group): PlaybookRecommendation => {
      const occurrences = group.evidence.length
      const confidence = Math.min(0.95, 0.65 + (occurrences * 0.08) + (Math.min(group.steps.length, 4) * 0.03))
      const sortedEvidence = [...group.evidence].sort((a, b) => b.updatedAt - a.updatedAt)

      return {
        id: recommendationId(group.key),
        name: group.name,
        description: `Drafted from ${occurrences} matching Spectra sessions.`,
        target: group.target,
        platform: group.platform,
        steps: group.steps,
        occurrences,
        confidence,
        lastSeenAt: group.lastSeenAt,
        evidence: sortedEvidence,
      }
    })
    .sort((a, b) => b.confidence - a.confidence || b.lastSeenAt - a.lastSeenAt)
}

function playbookStepsForSession(session: DashboardSession): Playbook['steps'] {
  const steps: Array<Playbook['steps'][number] & { timestamp: number }> = session.steps
    .filter((step) => step.success && step.intent?.trim())
    .map((step) => ({
      intent: step.intent!.trim(),
      captureType: step.screenshotPath ? 'screenshot' as const : 'none' as const,
      timestamp: step.timestamp,
    }))

  const recordingEvents = session.run?.events.filter((event) => (
    event.type === 'recording.status'
    && (event.data?.state === 'recording' || event.data?.state === 'saved')
  )) ?? []

  for (const event of recordingEvents) {
    if (event.data?.state === 'recording') {
      steps.push({
        intent: 'start recording',
        captureType: 'video_start',
        timestamp: event.timestamp,
      })
    } else if (event.data?.state === 'saved') {
      steps.push({
        intent: 'stop recording',
        captureType: 'video_stop',
        timestamp: event.timestamp,
      })
    }
  }

  if (recordingEvents.length === 0 && session.run?.recording.startedAt) {
    steps.push({
      intent: 'start recording',
      captureType: 'video_start',
      timestamp: session.run.recording.startedAt,
    })
    const stoppedAt = session.run.recording.stoppedAt
      ?? (session.run.recording.path ? session.updatedAt : undefined)
    if (stoppedAt) {
      steps.push({
        intent: 'stop recording',
        captureType: 'video_stop',
        timestamp: stoppedAt,
      })
    }
  }

  return steps
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(({ timestamp: _timestamp, ...step }) => step)
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
  const repoName = getRepoName()
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
          const relPath = relative(projectRoot, absPath)
          const projectName = projectNameFromArtifactPath(relPath, repoName)
          return {
            id: captureId('artifacts', relPath),
            path: relPath,
            source: 'artifacts',
            filename: basename(absPath),
            type,
            format: ext,
            size: s.size,
            timestamp: s.mtimeMs,
            archived: true,
            repoName,
            repoPath: projectRoot,
            projectName,
            productName: projectName,
            guideDetails: guideDetailsForArtifact(relPath, projectName),
            contentHash: await optionalContentHash(absPath),
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

  if (isPathInside(abs, artifactsDir)) return abs
  if (isPathInside(abs, spectraDir)) return abs

  return null
}
