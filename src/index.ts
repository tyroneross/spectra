// ─── Core types ─────────────────────────────────────────────
export type {
  Platform,
  Element,
  Snapshot,
  SnapshotMetadata,
  Action,
  ActionType,
  ActResult,
  Driver,
  DriverTarget,
  Session,
  Step,
  CaptureMode,
  CapturePreset,
  CaptureRunStatus,
  CaptureRunPlannerSource,
  CaptureRunDecisionOutcome,
  CaptureRunRecordingState,
  CaptureRunCandidate,
  CaptureRunDecision,
  CaptureRunAction,
  CaptureRunArtifact,
  CaptureRunRecording,
  CaptureRunEvent,
  CaptureRunManifest,
  ResolveOptions,
  ResolveResult,
} from './core/types.js'

// ─── Session management ─────────────────────────────────────
export { SessionManager } from './core/session.js'
export type { CreateSessionOptions, AddStepOptions } from './core/session.js'

// ─── Storage ────────────────────────────────────────────────
export { getStoragePath, findProjectRoot } from './core/storage.js'

// ─── Resolution ─────────────────────────────────────────────
export { resolve, jaroWinkler } from './core/resolve.js'

// ─── Drivers ────────────────────────────────────────────────
export { CdpDriver } from './cdp/driver.js'
export type { CdpDriverOptions } from './cdp/driver.js'
export { NativeDriver } from './native/driver.js'
export { SimDriver } from './native/sim.js'

// ─── Utilities ──────────────────────────────────────────────
export { normalizeRole } from './core/normalize.js'
export { serializeSnapshot, serializeElement } from './core/serialize.js'

// ─── Intelligence ───────────────────────────────────────────
export { scoreElements, findRegions } from './intelligence/importance.js'
export { perceptualHash, hashDistance, diffSnapshots, detectChange } from './intelligence/change.js'
export { detectState, createStateTriggers } from './intelligence/states.js'
export type { StateTrigger, StateTriggerOptions } from './intelligence/states.js'
export { edgeDistance, regionLabel, boundingBox, clusterElements } from './intelligence/spatial.js'
export { frame, autoFrame } from './intelligence/framing.js'
export { crawl, discoverByScroll } from './intelligence/navigation.js'
export type {
  Viewport,
  UIState,
  ImportanceScore,
  ScoreFactor,
  RegionOfInterest,
  ChangeResult,
  ChangeDetail,
  StateDetection,
  NavigationGraph,
  ScreenNode,
  NavigationEdge,
  CrawlOptions,
  FrameOptions,
  FrameResult,
  CaptureIntent,
  CaptureManifest,
  CaptureEntry,
} from './intelligence/types.js'

// ─── Media (enhanced) ───────────────────────────────────────
export { prepareForCapture, restoreAfterCapture } from './media/clean.js'
export type { CleanOptions, CleanState } from './media/clean.js'
export {
  buildPosterFrameArgs,
  buildProbeArgs,
  extractPosterFrame,
  probeVideo,
} from './media/pipeline.js'
export type {
  PosterFrameOptions,
  VideoOptions,
  VideoProbeResult,
} from './media/pipeline.js'
export {
  CAPTURE_PRESETS,
  getCapturePresetDefinition,
  resolveRecordingCaptureOptions,
  resolveScreenshotCaptureOptions,
} from './media/presets.js'
export type {
  CapturePresetDefinition,
  RecordingCaptureDefaults,
  RecordingPresetInput,
  ResolvedScreenshotCaptureOptions,
  ScreenshotCaptureDefaults,
  ScreenshotPresetInput,
} from './media/presets.js'
export { createProductionBundle } from './media/production.js'
export type {
  ProductionAsset,
  ProductionAssetKind,
  ProductionBundleManifest,
  ProductionBundleOptions,
  ProductionBundleResult,
  ProductionBundleSource,
  ProductionQualityCheck,
  ProductionQualityLevel,
  ProductionQualityReport,
  ProductionQualityStatus,
  ProductionSourceType,
} from './media/production.js'
export { decodePng, encodePng, cropImage, resizeNearest, toGrayscale } from './media/png.js'
export type { RawImage } from './media/png.js'
