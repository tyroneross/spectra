/**
 * Spectra library — persistent asset archive living alongside sessions.
 *
 * Sessions (.spectra/sessions/<id>/) are ephemeral step sequences from
 * spectra_connect / spectra_step / spectra_capture. The library
 * (.spectra/library/) is a long-lived flat catalog of captures tagged
 * with feature / component / tags so they can be found, grouped, and
 * exported for blog posts, docs, or marketing.
 *
 * Schema is forward-compatible with the showcase plugin's CaptureEntry
 * so captures can migrate in with spectra_library action="migrate-from-showcase".
 */

export const LIBRARY_VERSION = 1

export type CaptureType = 'screenshot' | 'video' | 'walkthrough'
export type Platform = 'web' | 'macos' | 'ios' | 'watchos' | 'unknown'

export interface CaptureEntry {
  /** Stable unique ID, prefixed with cap_ */
  id: string
  /** ISO-8601 timestamp */
  created_at: string
  type: CaptureType
  /** File extension (png, mp4, mov, etc.) */
  format: string
  size_bytes: number
  /** Video duration — videos only */
  duration_ms?: number
  /** Origin: spectra | showcase (on migration) | external */
  source: string
  platform: Platform

  /** Web-only */
  url?: string
  viewport?: string
  /** Element selector or region name at capture time */
  selector?: string
  /** Device name for native/sim captures */
  device_name?: string

  /** Free-text title for the capture */
  title?: string
  /** Canonical feature name (kebab-case) for grouping — e.g. "onboarding" */
  feature?: string
  /** Component name if this documents a specific UI element — e.g. "date-picker" */
  component?: string
  /** Free-form tags for search */
  tags?: string[]
  /** User-starred captures surface in gallery/find */
  starred?: boolean

  /** Walkthrough metadata if type === 'walkthrough' */
  walkthrough?: {
    step_count: number
    steps: string[]
  }

  /** Git context at capture time — useful for correlating with code changes */
  git_branch?: string
  git_commit?: string
}

export interface LibraryIndex {
  version: number
  captures: CaptureEntry[]
}
