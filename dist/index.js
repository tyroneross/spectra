// ─── Session management ─────────────────────────────────────
export { SessionManager } from './core/session.js';
// ─── Storage ────────────────────────────────────────────────
export { getStoragePath, findProjectRoot } from './core/storage.js';
// ─── Resolution ─────────────────────────────────────────────
export { resolve, jaroWinkler } from './core/resolve.js';
// ─── Drivers ────────────────────────────────────────────────
export { CdpDriver } from './cdp/driver.js';
export { NativeDriver } from './native/driver.js';
export { SimDriver } from './native/sim.js';
// ─── Utilities ──────────────────────────────────────────────
export { normalizeRole } from './core/normalize.js';
export { serializeSnapshot, serializeElement } from './core/serialize.js';
// ─── Intelligence ───────────────────────────────────────────
export { scoreElements, findRegions } from './intelligence/importance.js';
export { perceptualHash, hashDistance, diffSnapshots, detectChange } from './intelligence/change.js';
export { detectState, createStateTriggers } from './intelligence/states.js';
export { edgeDistance, regionLabel, boundingBox, clusterElements } from './intelligence/spatial.js';
export { frame, autoFrame } from './intelligence/framing.js';
export { crawl, discoverByScroll } from './intelligence/navigation.js';
// ─── Media (enhanced) ───────────────────────────────────────
export { prepareForCapture, restoreAfterCapture } from './media/clean.js';
export { buildCaptureArgs, buildEncodeArgs } from './media/pipeline.js';
export { decodePng, encodePng, cropImage, resizeNearest, toGrayscale } from './media/png.js';
//# sourceMappingURL=index.js.map