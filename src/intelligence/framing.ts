import type { Element } from '../core/types.js'
import type { ImportanceScore, RegionOfInterest, FrameOptions, FrameResult } from './types.js'
import { findRegions } from './importance.js'
import { decodePng, encodePng, cropImage } from '../media/png.js'
import { edgeDistance, regionLabel, boundingBox, clusterElements } from './spatial.js'

/** Clamp a rect [x, y, w, h] to [0, 0, imgW, imgH]. */
function clampRect(
  x: number, y: number, w: number, h: number,
  imgW: number, imgH: number
): [number, number, number, number] {
  const x0 = Math.max(0, Math.min(x, imgW))
  const y0 = Math.max(0, Math.min(y, imgH))
  const x1 = Math.max(x0, Math.min(x + w, imgW))
  const y1 = Math.max(y0, Math.min(y + h, imgH))
  return [x0, y0, x1 - x0, y1 - y0]
}

/** Apply padding to a rect, clamped to image bounds. */
function applyPadding(
  x: number, y: number, w: number, h: number,
  padding: number,
  imgW: number, imgH: number
): [number, number, number, number] {
  return clampRect(x - padding, y - padding, w + padding * 2, h + padding * 2, imgW, imgH)
}

/**
 * Expand a rect to match a target aspect ratio (w/h), centered on the original
 * rect. Clamps to image bounds, then adjusts the other dimension if clamping
 * caused ratio drift.
 */
function applyAspectRatio(
  x: number, y: number, w: number, h: number,
  targetRatio: number,
  imgW: number, imgH: number
): [number, number, number, number] {
  const currentRatio = w / h

  let nx = x, ny = y, nw = w, nh = h

  if (currentRatio < targetRatio) {
    // Too tall — expand width
    nw = h * targetRatio
    nx = x + (w - nw) / 2
  } else if (currentRatio > targetRatio) {
    // Too wide — expand height
    nh = w / targetRatio
    ny = y + (h - nh) / 2
  }

  // Round to integer pixel coordinates before clamping
  const rnx = Math.round(nx)
  const rny = Math.round(ny)
  const rnw = Math.round(nw)
  const rnh = Math.round(nh)

  // Clamp to image bounds
  const cx0 = Math.max(0, Math.min(rnx, imgW))
  const cy0 = Math.max(0, Math.min(rny, imgH))
  const cx1 = Math.max(cx0, Math.min(rnx + rnw, imgW))
  const cy1 = Math.max(cy0, Math.min(rny + rnh, imgH))

  let fw = cx1 - cx0
  let fh = cy1 - cy0

  // If clamping caused ratio drift, trim the other dimension to preserve ratio
  if (fh > 0 && fw > 0) {
    const clampedRatio = fw / fh
    if (Math.abs(clampedRatio - targetRatio) > 0.01) {
      if (clampedRatio > targetRatio) {
        // Too wide after clamp — shrink width
        fw = Math.round(fh * targetRatio)
      } else {
        // Too tall after clamp — shrink height
        fh = Math.round(fw / targetRatio)
      }
    }
  }

  return [cx0, cy0, fw, fh]
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function frame(
  screenshot: Buffer,
  scores: ImportanceScore[],
  elements: Element[],
  options?: FrameOptions
): FrameResult {
  const raw = decodePng(screenshot)
  const imgW = raw.width
  const imgH = raw.height

  const padding = options?.padding ?? 16
  const elemMap = new Map(elements.map(e => [e.id, e]))
  const scoreMap = new Map(scores.map(s => [s.elementId, s.score]))

  let cropX = 0, cropY = 0, cropW = imgW, cropH = imgH
  let labelElements: Element[] = elements

  const target = options?.target

  if (target === 'viewport' || target === 'fullpage') {
    // Full image — no crop
    cropX = 0; cropY = 0; cropW = imgW; cropH = imgH
    labelElements = elements

  } else if (target === 'element') {
    const el = options?.elementId ? elemMap.get(options.elementId) : undefined
    if (el) {
      const [ex, ey, ew, eh] = el.bounds;
      [cropX, cropY, cropW, cropH] = applyPadding(ex, ey, ew, eh, padding, imgW, imgH)
      labelElements = [el]
    }

  } else if (target === 'region') {
    // Caller is expected to compute regions and pass regionIndex.
    // We re-derive regions here from scores/elements.
    const regions = findRegions(scores, elements)
    let region: RegionOfInterest | undefined
    if (options?.regionIndex !== undefined && regions[options.regionIndex]) {
      region = regions[options.regionIndex]
    } else {
      region = regions[0]
    }
    if (region) {
      const [rx, ry, rw, rh] = region.bounds;
      [cropX, cropY, cropW, cropH] = applyPadding(rx, ry, rw, rh, padding, imgW, imgH)
      labelElements = region.elements.map(id => elemMap.get(id)).filter((e): e is Element => !!e)
    }

  } else {
    // Auto: find elements with score >= 0.5
    let qualifying = scores
      .filter(s => s.score >= 0.5)
      .map(s => elemMap.get(s.elementId))
      .filter((e): e is Element => !!e)

    if (qualifying.length === 0) {
      // Fall back to top 25% by score
      const sorted = [...scores].sort((a, b) => b.score - a.score)
      const top25 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)))
      qualifying = top25.map(s => elemMap.get(s.elementId)).filter((e): e is Element => !!e)
    }

    if (qualifying.length === 0) {
      // Full screenshot fallback
      cropX = 0; cropY = 0; cropW = imgW; cropH = imgH
      labelElements = elements
    } else {
      const [bx, by, bw, bh] = boundingBox(qualifying);
      [cropX, cropY, cropW, cropH] = applyPadding(bx, by, bw, bh, padding, imgW, imgH)
      labelElements = qualifying
    }
  }

  // Apply aspect ratio if specified
  if (options?.aspectRatio !== undefined && options.aspectRatio > 0) {
    [cropX, cropY, cropW, cropH] = applyAspectRatio(
      cropX, cropY, cropW, cropH,
      options.aspectRatio,
      imgW, imgH
    )
  }

  // Ensure we never have zero dimensions
  cropW = Math.max(1, cropW)
  cropH = Math.max(1, cropH)

  const cropped = cropImage(raw, cropX, cropY, cropW, cropH)
  const buffer = encodePng(cropped)
  const label = regionLabel(labelElements)

  return {
    crop: [cropX, cropY, cropW, cropH],
    buffer,
    label,
  }
}

export function autoFrame(
  screenshot: Buffer,
  scores: ImportanceScore[],
  elements: Element[]
): FrameResult[] {
  // Elements with score >= 0.4
  const scoreMap = new Map(scores.map(s => [s.elementId, s.score]))
  const elemMap = new Map(elements.map(e => [e.id, e]))

  const qualifying = scores
    .filter(s => s.score >= 0.4)
    .map(s => elemMap.get(s.elementId))
    .filter((e): e is Element => !!e)

  if (qualifying.length === 0) {
    // Return full screenshot as single result
    return [frame(screenshot, scores, elements, { target: 'viewport' })]
  }

  const clusters = clusterElements(qualifying, 30)

  // Sort clusters by average score descending
  const ranked = clusters
    .map(({ members, bounds }) => {
      const avgScore = members.reduce((sum, el) => sum + (scoreMap.get(el.id) ?? 0), 0) / members.length
      return { members, bounds, avgScore }
    })
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 5)

  const raw = decodePng(screenshot)
  const imgW = raw.width
  const imgH = raw.height

  return ranked.map(({ members, bounds, avgScore: _ }) => {
    const [bx, by, bw, bh] = bounds
    const [cx, cy, cw, ch] = applyPadding(bx, by, bw, bh, 16, imgW, imgH)
    const cropped = cropImage(raw, cx, cy, cw, ch)
    const buffer = encodePng(cropped)
    return {
      crop: [cx, cy, cw, ch] as [number, number, number, number],
      buffer,
      label: regionLabel(members),
    }
  })
}
