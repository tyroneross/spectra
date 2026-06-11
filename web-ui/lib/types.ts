import type {
  CapturePreset,
  Platform,
  DriverTarget,
  CaptureRunManifest,
  ProductionBundleManifest,
  ProductionQualityReport,
} from 'spectra'

export interface Capture {
  id: string                    // stable SHA-256 hash of source + relative path (16-char hex)
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
  repoName?: string
  repoPath?: string
  projectName?: string
  productName?: string
  sessionType?: string
  guide?: string
  guideDetails?: string[]
  preset?: CapturePreset
  productionReady?: boolean
  contentHash?: string
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
  projectName?: string
  sessionType?: string
  run?: CaptureRunManifest
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
  decisionId?: string
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

export interface PlaybookRecommendation {
  id: string
  name: string
  description: string
  target: string
  platform: Platform
  steps: PlaybookStep[]
  occurrences: number
  confidence: number
  lastSeenAt: number
  evidence: PlaybookRecommendationEvidence[]
}

export interface PlaybookRecommendationEvidence {
  sessionId: string
  sessionName: string
  updatedAt: number
}

export interface PlaybookStep {
  intent: string
  captureType: 'screenshot' | 'video_start' | 'video_stop' | 'none'
  notes?: string
}

export interface CaptureImportCandidate {
  id: string
  repoName: string
  repoPath: string
  sourceType: 'artifacts' | 'sessions'
  sourceRoot: string
  destinationProject: string
  destinationRoot: string
  fileCount: number
  totalSize: number
  latestTimestamp: number
  alreadyImported: boolean
}

export interface CaptureImportResult {
  candidateId: string
  repoName: string
  sourceType: 'artifacts' | 'sessions'
  destinationRoot: string
  copied: number
  skipped: number
  errors: string[]
}

export interface ExportRequest {
  format: 'zip' | 'markdown' | 'individual' | 'production'
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

export interface ExportResult {
  outputPath: string
  fileCount: number
  totalSize: number
  manifestPath?: string
  qualityReportPath?: string
  quality?: ProductionQualityReport
  warnings?: string[]
}

export interface ProductionBundleSummary {
  id: string
  title: string
  path: string
  createdAt: number
  preset?: CapturePreset
  status: ProductionQualityReport['status']
  score: number
  assetCount: number
  sourceCount: number
  totalSize: number
  manifestPath: string
  readmePath?: string
  qualityReportPath?: string
}

export interface ProductionBundleDetail extends ProductionBundleSummary {
  manifest: ProductionBundleManifest
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
  project?: string
  sessionType?: string
}
