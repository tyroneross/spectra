import type { Platform, DriverTarget } from 'spectra'

export interface Capture {
  id: string                    // SHA-256 hash of first 4KB of file content (16-char hex)
  path: string                  // relative path from project root
  source: 'artifacts' | 'session'
  filename: string
  type: 'screenshot' | 'video'
  format: string                // png, mp4, jpg, etc.
  size: number                  // bytes
  dimensions?: [number, number] // width, height
  sessionId?: string
  sessionName?: string
  platform?: Platform
  timestamp: number             // file mtime
  archived: boolean
}

export interface DashboardSession {
  id: string
  name: string
  platform: Platform
  target: DriverTarget
  steps: DashboardStep[]
  captureCount: number
  status: 'active' | 'closed'
  createdAt: number
  updatedAt: number
  closedAt?: number
}

export interface DashboardStep {
  index: number
  actionType: string
  elementId: string
  intent?: string
  screenshotPath?: string
  success: boolean
  duration: number
  timestamp: number
}

export interface Playbook {
  id: string
  name: string
  description: string
  target: string
  platform: Platform
  steps: PlaybookStep[]
  createdAt: number
  updatedAt: number
  lastRunAt?: number
}

export interface PlaybookStep {
  intent: string
  captureType: 'screenshot' | 'video_start' | 'video_stop' | 'none'
  notes?: string
}

export interface ExportRequest {
  format: 'zip' | 'markdown' | 'individual'
  template?: 'blog' | 'social' | 'docs'
  outputDir?: string
  captures: ExportCapture[]
}

export interface ExportCapture {
  captureId: string
  order: number
  caption?: string
  crop?: { x: number; y: number; width: number; height: number }
  highlights?: { x: number; y: number; width: number; height: number; color?: string }[]
}

export interface StorageStats {
  totalSize: number
  bySession: { sessionId: string; name: string; size: number }[]
  byPlatform: Record<string, number>
  byType: Record<string, number>
  largestSessions: { sessionId: string; name: string; size: number }[]
}

export interface CaptureFilters {
  sessionId?: string
  platform?: Platform
  type?: 'screenshot' | 'video'
  dateFrom?: number
  dateTo?: number
  search?: string
  sort?: 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'session'
  archived?: boolean
}
