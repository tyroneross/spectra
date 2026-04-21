import { mkdir, cp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CaptureEntry } from './types.js'
import { mediaPathForEntry } from './storage.js'

export interface ExportOptions {
  outDir: string
  /** Write manifest.md alongside the media. Default true. */
  manifest?: boolean
  /** Flatten all media into outDir/ instead of keeping per-capture subdirs. */
  flatten?: boolean
  cwd?: string
}

export interface ExportResult {
  outDir: string
  filesCopied: number
  manifestPath?: string
}

/**
 * Copy a list of captures (plus their media) to an output directory and
 * write a human-readable markdown manifest describing each one.
 */
export async function exportCaptures(
  captures: CaptureEntry[],
  opts: ExportOptions,
): Promise<ExportResult> {
  const { outDir, manifest = true, flatten = false, cwd } = opts
  await mkdir(outDir, { recursive: true })

  let filesCopied = 0
  for (const c of captures) {
    const src = mediaPathForEntry(c, cwd)
    const destDir = flatten ? outDir : join(outDir, c.id)
    await mkdir(destDir, { recursive: true })
    const destName = flatten
      ? `${c.id}.${c.format}`
      : `original.${c.format}`
    const dest = join(destDir, destName)
    try {
      await cp(src, dest)
      filesCopied += 1
    } catch {
      // Media missing (manually deleted); skip silently but still include in manifest.
    }
  }

  let manifestPath: string | undefined
  if (manifest) {
    manifestPath = join(outDir, 'manifest.md')
    await writeFile(manifestPath, renderManifest(captures, { flatten }))
  }

  return { outDir, filesCopied, manifestPath }
}

function renderManifest(
  captures: CaptureEntry[],
  opts: { flatten: boolean },
): string {
  const lines: string[] = []
  lines.push('# Spectra Library Export')
  lines.push('')
  lines.push(
    `Exported ${captures.length} capture${captures.length === 1 ? '' : 's'} from the spectra library. Each entry below names the media file (relative to this manifest) plus the recorded metadata.`,
  )
  lines.push('')
  for (const c of captures) {
    const rel = opts.flatten ? `${c.id}.${c.format}` : `${c.id}/original.${c.format}`
    lines.push(`## ${c.title || c.id}`)
    lines.push('')
    lines.push(`- **File**: \`${rel}\``)
    lines.push(`- **Type**: ${c.type} (${c.format})`)
    lines.push(`- **Platform**: ${c.platform}`)
    if (c.feature) lines.push(`- **Feature**: ${c.feature}`)
    if (c.component) lines.push(`- **Component**: ${c.component}`)
    if (c.tags?.length) lines.push(`- **Tags**: ${c.tags.join(', ')}`)
    if (c.url) lines.push(`- **URL**: ${c.url}`)
    if (c.viewport) lines.push(`- **Viewport**: ${c.viewport}`)
    if (c.device_name) lines.push(`- **Device**: ${c.device_name}`)
    if (c.duration_ms) lines.push(`- **Duration**: ${(c.duration_ms / 1000).toFixed(1)}s`)
    lines.push(`- **Captured**: ${c.created_at}`)
    if (c.git_branch || c.git_commit) {
      lines.push(
        `- **Git**: ${c.git_branch ?? '?'}${c.git_commit ? `@${c.git_commit.slice(0, 7)}` : ''}`,
      )
    }
    if (c.walkthrough) {
      lines.push(`- **Walkthrough**: ${c.walkthrough.step_count} steps`)
      for (const step of c.walkthrough.steps) {
        lines.push(`  - ${step}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n') + '\n'
}
