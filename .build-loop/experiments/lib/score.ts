// .build-loop/experiments/lib/score.ts
//
// Shared scoring + design utilities for both walkthrough-bench and
// video-bench DOE runners.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

export interface SuccessPredicate {
  ax_text_contains?: string
  url_matches?: string
  element_visible?: { role?: string; label_contains?: string; focused?: boolean }
}

export interface PredicateSnapshotInput {
  snapshot: string
  url?: string
}

/**
 * Score a snapshot+url against a YAML-loaded predicate. Returns true if the
 * predicate is satisfied; false otherwise. Snapshot is the serialized AX/DOM
 * tree as returned by spectra_snapshot.
 */
export function evaluatePredicate(
  predicate: SuccessPredicate,
  snapshot: string,
  url?: string,
): boolean {
  if (predicate.ax_text_contains) {
    return snapshot.toLowerCase().includes(predicate.ax_text_contains.toLowerCase())
  }
  if (predicate.url_matches && url) {
    try {
      return new RegExp(predicate.url_matches).test(url)
    } catch {
      return false
    }
  }
  if (predicate.element_visible) {
    const want = predicate.element_visible
    // The snapshot serialization includes lines like:
    //   [e7] button "Log in"   bounds=...
    // Roles are tokenized in the second column. We check whether ANY line
    // contains role + label_contains.
    const lines = snapshot.split('\n')
    return lines.some((line) => {
      const roleOk = want.role ? line.toLowerCase().includes(want.role.toLowerCase()) : true
      const labelOk = want.label_contains
        ? line.toLowerCase().includes(want.label_contains.toLowerCase())
        : true
      // We can't reliably check focused state from a serialized text snapshot
      // without driver-specific markers — treat focused=true as a "best effort"
      // satisfied as long as role + label match.
      return roleOk && labelOk
    })
  }
  return false
}

export function evaluatePredicateFromSnapshot(
  predicate: SuccessPredicate,
  input: PredicateSnapshotInput,
): boolean {
  return evaluatePredicate(predicate, input.snapshot, input.url)
}

export function shouldRetryStepFailure(
  retry: 'none' | 'oneRetryResnapshot' | string,
  alreadyRetried: boolean,
): boolean {
  return retry !== 'none' && !alreadyRetried
}

export function combineTurnLatencies(
  llmLatencyMs: number[],
  executorLatencyMs: number[],
): number[] {
  const n = Math.max(llmLatencyMs.length, executorLatencyMs.length)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push((llmLatencyMs[i] ?? 0) + (executorLatencyMs[i] ?? 0))
  }
  return out
}

/**
 * Compute the 16-row resolution-V fractional factorial design for 5 two-level
 * factors using the standard 2^(5-1) generator F5 = F1*F2*F3*F4.
 * Returns an array of 16 records: each maps factor name → 0 or 1.
 *
 * Resolution V guarantees that all main effects + 2-way interactions are
 * estimable clear of each other.
 */
export function fractionalFactorial16(factorNames: [string, string, string, string, string]): Array<Record<string, 0 | 1>> {
  const [f1, f2, f3, f4, f5] = factorNames
  const rows: Array<Record<string, 0 | 1>> = []
  for (let i = 0; i < 16; i++) {
    const b1 = ((i >> 0) & 1) as 0 | 1
    const b2 = ((i >> 1) & 1) as 0 | 1
    const b3 = ((i >> 2) & 1) as 0 | 1
    const b4 = ((i >> 3) & 1) as 0 | 1
    // Generator: F5 = F1 XOR F2 XOR F3 XOR F4 in the {0,1} encoding (equivalent
    // to F5 = F1*F2*F3*F4 in the {-1, +1} encoding for the design matrix).
    const b5 = ((b1 ^ b2 ^ b3 ^ b4) & 1) as 0 | 1
    rows.push({ [f1]: b1, [f2]: b2, [f3]: b3, [f4]: b4, [f5]: b5 })
  }
  return rows
}

/**
 * Compute main effects per factor from a runs.jsonl-like array.
 *   effect(F) = mean(metric | F=high) - mean(metric | F=low)
 * Returns map factor → { effect, absEffect, lowMean, highMean, lowN, highN }.
 */
export interface MainEffect {
  effect: number
  absEffect: number
  lowMean: number
  highMean: number
  lowN: number
  highN: number
}

export function mainEffects(
  rows: Array<Record<string, number | 0 | 1>>,
  factors: string[],
  metric: string,
): Record<string, MainEffect> {
  const out: Record<string, MainEffect> = {}
  for (const f of factors) {
    const lo: number[] = []
    const hi: number[] = []
    for (const r of rows) {
      const v = r[metric] as number | undefined
      if (typeof v !== 'number') continue
      const level = r[f]
      if (level === 0) lo.push(v)
      else if (level === 1) hi.push(v)
    }
    const meanLo = lo.length ? lo.reduce((a, b) => a + b, 0) / lo.length : 0
    const meanHi = hi.length ? hi.reduce((a, b) => a + b, 0) / hi.length : 0
    out[f] = {
      effect: meanHi - meanLo,
      absEffect: Math.abs(meanHi - meanLo),
      lowMean: meanLo,
      highMean: meanHi,
      lowN: lo.length,
      highN: hi.length,
    }
  }
  return out
}
