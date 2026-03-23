import type { Snapshot, Element } from '../core/types.js'
import type { ChangeResult, ChangeDetail } from '../intelligence/types.js'
import { decodePng, resizeNearest, toGrayscale } from '../media/png.js'

// ─── Perceptual Hash ─────────────────────────────────────────

export function perceptualHash(pngBuffer: Buffer): bigint {
  const image = decodePng(pngBuffer)
  const resized = resizeNearest(image, 9, 8)
  const gray = toGrayscale(resized)

  let hash = 0n
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const bit = gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1n : 0n
      hash = (hash << 1n) | bit
    }
  }

  return hash
}

// ─── Hash Distance ───────────────────────────────────────────

export function hashDistance(a: bigint, b: bigint): number {
  let xor = a ^ b
  let count = 0
  while (xor > 0n) {
    count += Number(xor & 1n)
    xor >>= 1n
  }
  return count
}

// ─── Element Key ─────────────────────────────────────────────

function elementKey(el: Element): string {
  return `${el.role}:${el.label}`
}

// ─── Diff Snapshots ──────────────────────────────────────────

export function diffSnapshots(before: Snapshot, after: Snapshot): ChangeResult {
  const beforeMap = new Map<string, Element>()
  for (const el of before.elements) {
    beforeMap.set(elementKey(el), el)
  }

  const afterMap = new Map<string, Element>()
  for (const el of after.elements) {
    afterMap.set(elementKey(el), el)
  }

  const details: ChangeDetail[] = []
  let addedCount = 0
  let removedCount = 0
  let changedCount = 0

  // Added elements
  for (const [key, el] of afterMap) {
    if (!beforeMap.has(key)) {
      addedCount++
      details.push({
        kind: 'added',
        elementId: el.id,
        description: `Element added: ${key}`,
      })
    }
  }

  // Removed elements
  for (const [key, el] of beforeMap) {
    if (!afterMap.has(key)) {
      removedCount++
      details.push({
        kind: 'removed',
        elementId: el.id,
        description: `Element removed: ${key}`,
      })
    }
  }

  // Changed/moved elements
  for (const [key, afterEl] of afterMap) {
    const beforeEl = beforeMap.get(key)
    if (!beforeEl) continue

    const [bx, by, bw, bh] = beforeEl.bounds
    const [ax, ay, aw, ah] = afterEl.bounds
    const boundsDiff =
      Math.abs(ax - bx) > 5 ||
      Math.abs(ay - by) > 5 ||
      Math.abs(aw - bw) > 5 ||
      Math.abs(ah - bh) > 5

    if (boundsDiff) {
      details.push({
        kind: 'moved',
        elementId: afterEl.id,
        description: `Element moved: ${key}`,
      })
      // moved counts toward changed for scoring
      changedCount++
    } else if (
      afterEl.value !== beforeEl.value ||
      afterEl.enabled !== beforeEl.enabled ||
      afterEl.focused !== beforeEl.focused
    ) {
      changedCount++
      details.push({
        kind: 'changed',
        elementId: afterEl.id,
        description: `Element changed: ${key}`,
      })
    }
  }

  const total = addedCount + removedCount + changedCount
  const denominator = Math.max(before.elements.length, after.elements.length, 1)
  const score = total / denominator

  let type: ChangeResult['type']
  if (score === 0) {
    type = 'none'
  } else if (score < 0.1) {
    type = 'minor'
  } else if (score < 0.5) {
    type = 'significant'
  } else {
    type = 'navigation'
  }

  return {
    changed: score > 0,
    score,
    type,
    details,
  }
}

// ─── Detect Change ───────────────────────────────────────────

export function detectChange(
  beforeBuffer: Buffer,
  afterBuffer: Buffer,
  beforeSnap: Snapshot,
  afterSnap: Snapshot,
  threshold?: number
): ChangeResult {
  const beforeHash = perceptualHash(beforeBuffer)
  const afterHash = perceptualHash(afterBuffer)
  const dist = hashDistance(beforeHash, afterHash)

  if (dist < 5) {
    return { changed: false, score: 0, type: 'none', details: [] }
  }

  const result = diffSnapshots(beforeSnap, afterSnap)

  if (result.score < (threshold ?? 0.05)) {
    return { ...result, changed: false }
  }

  return result
}
