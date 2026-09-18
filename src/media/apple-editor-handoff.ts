import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

export type AppleEditorAssetRole = 'web-master' | 'edit-master' | 'audio-stem' | 'captions'

export interface AppleEditorAsset {
  path: string
  role: AppleEditorAssetRole
  label?: string
  /** Include this video in the small, duplicate-free folder intended for iMovie import. */
  imovieImport?: boolean
}

export interface AppleEditorHandoffOptions {
  outDir: string
  title: string
  createdAt?: string
}

export interface AppleEditorHandoffFile {
  role: AppleEditorAssetRole
  label: string
  filename: string
  path: string
  sizeBytes: number
  sha256: string
  imovieImport: boolean
}

export interface AppleEditorHandoffManifest {
  schemaVersion: 1
  title: string
  createdAt: string
  files: AppleEditorHandoffFile[]
}

export interface AppleEditorHandoffResult {
  outDir: string
  manifestPath: string
  readmePath: string
  imovieImportDir?: string
  manifest: AppleEditorHandoffManifest
}

const ROLE_DIR: Record<AppleEditorAssetRole, string> = {
  'web-master': 'masters',
  'edit-master': 'masters',
  'audio-stem': 'audio',
  captions: 'captions',
}

/**
 * Packages Spectra-rendered assets for optional finishing in iMovie or Final Cut Pro.
 * Spectra remains the renderer of record; this function only creates a local handoff.
 */
export async function createAppleEditorHandoff(
  assets: AppleEditorAsset[],
  options: AppleEditorHandoffOptions,
): Promise<AppleEditorHandoffResult> {
  if (assets.length === 0) throw new Error('Apple editor handoff requires at least one asset')

  const planned = assets.map((asset) => {
    const filename = safeFilename(basename(asset.path))
    return {
      asset,
      filename,
      relativePath: `${ROLE_DIR[asset.role]}/${filename}`,
      imoviePath: asset.imovieImport ? `iMovie Import/${filename}` : undefined,
    }
  })
  rejectDuplicateTargets(planned.map((item) => item.relativePath), 'handoff')
  rejectDuplicateTargets(
    planned.flatMap((item) => item.imoviePath ? [item.imoviePath] : []),
    'iMovie import',
  )

  const files: AppleEditorHandoffFile[] = []
  const imovieAssets = assets.filter((asset) => asset.imovieImport)
  const imovieImportDir = imovieAssets.length > 0 ? join(options.outDir, 'iMovie Import') : undefined

  await mkdir(options.outDir, { recursive: true })
  if (imovieImportDir) await mkdir(imovieImportDir, { recursive: true })

  for (const { asset, filename, relativePath } of planned) {
    const sourceStat = await stat(asset.path)
    if (!sourceStat.isFile()) throw new Error(`Apple editor asset is not a file: ${asset.path}`)

    const roleDir = join(options.outDir, ROLE_DIR[asset.role])
    await mkdir(roleDir, { recursive: true })
    const destination = join(roleDir, filename)
    await copyFile(asset.path, destination)

    if (asset.imovieImport) {
      if (!isVideo(filename)) {
        throw new Error(`iMovie import asset must be a video: ${asset.path}`)
      }
      await copyFile(asset.path, join(imovieImportDir!, filename))
    }

    files.push({
      role: asset.role,
      label: asset.label ?? basename(filename, extname(filename)),
      filename,
      path: relativePath,
      sizeBytes: sourceStat.size,
      sha256: await sha256(destination),
      imovieImport: Boolean(asset.imovieImport),
    })
  }

  const manifest: AppleEditorHandoffManifest = {
    schemaVersion: 1,
    title: options.title,
    createdAt: options.createdAt ?? new Date().toISOString(),
    files,
  }
  const manifestPath = join(options.outDir, 'manifest.json')
  const readmePath = join(options.outDir, 'README.md')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(readmePath, renderReadme(manifest, Boolean(imovieImportDir)))

  return { outDir: options.outDir, manifestPath, readmePath, imovieImportDir, manifest }
}

function rejectDuplicateTargets(paths: string[], label: string): void {
  const seen = new Set<string>()
  for (const path of paths) {
    const key = path.toLocaleLowerCase('en-US')
    if (seen.has(key)) throw new Error(`Duplicate ${label} destination: ${path}`)
    seen.add(key)
  }
}

function isVideo(filename: string): boolean {
  return ['.mp4', '.mov', '.m4v'].includes(extname(filename).toLowerCase())
}

function safeFilename(filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._ -]/g, '-').replace(/\s+/g, ' ').trim()
  if (!safe || safe === '.' || safe === '..') throw new Error(`Unsafe Apple editor filename: ${filename}`)
  return safe
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function renderReadme(manifest: AppleEditorHandoffManifest, hasImovieImport: boolean): string {
  const lines = [
    `# ${manifest.title}`,
    '',
    'Spectra produced these assets. Apple editors are optional finishing tools, not rendering dependencies.',
    '',
    '## Contents',
    '',
    ...manifest.files.map((file) => `- \`${file.path}\` — ${file.role}${file.imovieImport ? '; included in iMovie Import' : ''}`),
    '',
    '## iMovie',
    '',
    hasImovieImport
      ? 'Import the contents of `iMovie Import/` into one event. This folder excludes stems and duplicate masters.'
      : 'No iMovie import set was requested. Mark one or more video assets with `imovieImport: true` when packaging.',
    '',
    '## Final Cut Pro',
    '',
    'Import the preferred file from `masters/`; add `audio/` stems and `captions/` only when further editing is needed.',
    '',
    'The manifest records SHA-256 hashes so copied handoff files can be verified before editing.',
    '',
  ]
  return lines.join('\n')
}
