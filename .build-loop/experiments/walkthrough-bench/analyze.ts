#!/usr/bin/env tsx
// .build-loop/experiments/walkthrough-bench/analyze.ts
//
// Reads runs.jsonl and writes verdict.md with:
//  - per-cell success rate, mean tokens/step, median latency/step, cost
//  - main effects per factor
//  - the winning cell (if any meets the 4 acceptance criteria in design.md)
//  - what to lock as defaults in PromptBuilder.swift if shipping the winner
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mainEffects, type MainEffect } from '../lib/score.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNS_PATH = join(__dirname, 'runs.jsonl')
const VERDICT_PATH = join(__dirname, 'verdict.md')

interface Row {
  cell_id: string
  task_id: string
  surface: string
  difficulty: string
  success: boolean
  steps_executed: number
  turns: number
  latency_ms_per_step: number[]
  tokens_in_per_step: number[]
  tokens_out_per_step: number[]
  cost_estimate_usd: number
  elapsed_ms: number
  error: string | null
}

// Inverse map from cell config back to factor levels (used for main-effects)
const FACTOR_DECODE: Record<string, { F1: 0|1; F2: 0|1; F3: 0|1; F4: 0|1; F5: 0|1 }> = (() => {
  // Reconstruct by re-enumerating exactly as runner.ts did.
  const F1 = ['axOnly', 'axPlusScreenshot']
  const F2 = ['oneAction', 'threeToFive']
  const F3 = ['none', 'oneRetryResnapshot']
  const F4 = ['terse', 'roleToolsThreeShot']
  const F5 = ['claude-haiku-4-5', 'claude-sonnet-4-6']
  const out: Record<string, { F1: 0|1; F2: 0|1; F3: 0|1; F4: 0|1; F5: 0|1 }> = {}
  for (let i = 0; i < 16; i++) {
    const b1 = (i >> 0) & 1
    const b2 = (i >> 1) & 1
    const b3 = (i >> 2) & 1
    const b4 = (i >> 3) & 1
    const b5 = b1 ^ b2 ^ b3 ^ b4
    out[`c${String(i).padStart(2, '0')}`] = { F1: b1 as 0|1, F2: b2 as 0|1, F3: b3 as 0|1, F4: b4 as 0|1, F5: b5 as 0|1 }
    void F1; void F2; void F3; void F4; void F5
  }
  return out
})()

const FACTOR_NAMES: Record<string, [string, string]> = {
  F1: ['axOnly', 'axPlusScreenshot'],
  F2: ['oneAction', 'threeToFive'],
  F3: ['none', 'oneRetryResnapshot'],
  F4: ['terse', 'roleToolsThreeShot'],
  F5: ['claude-haiku-4-5', 'claude-sonnet-4-6'],
}

async function main() {
  const raw = await readFile(RUNS_PATH, 'utf-8').catch(() => '')
  if (!raw.trim()) {
    await writeFile(VERDICT_PATH, '# Verdict — walkthrough-bench\n\nNo `runs.jsonl` present. Run `runner.ts` first.\n')
    process.stdout.write('No runs to analyze; wrote empty verdict.\n')
    return
  }
  const rows: Row[] = raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))

  // ─── Per-cell aggregates ──────────────────────────────────
  const byCell = new Map<string, Row[]>()
  for (const r of rows) {
    if (!byCell.has(r.cell_id)) byCell.set(r.cell_id, [])
    byCell.get(r.cell_id)!.push(r)
  }

  interface CellStats {
    cellId: string
    n: number
    successRate: number
    meanTokensPerStep: number
    medianLatencyPerStep: number
    meanCostPerTask: number
    meetsCriteria: boolean
    config: typeof FACTOR_DECODE[string]
  }
  const stats: CellStats[] = []
  for (const [cellId, cellRows] of byCell) {
    const successes = cellRows.filter((r) => r.success).length
    const tokensPerStep: number[] = []
    const latPerStep: number[] = []
    for (const r of cellRows) {
      const steps = Math.max(1, r.steps_executed)
      const totalTok = r.tokens_in_per_step.reduce((a, b) => a + b, 0) + r.tokens_out_per_step.reduce((a, b) => a + b, 0)
      tokensPerStep.push(totalTok / steps)
      if (r.latency_ms_per_step.length) latPerStep.push(...r.latency_ms_per_step)
    }
    const meanTok = tokensPerStep.length ? tokensPerStep.reduce((a, b) => a + b, 0) / tokensPerStep.length : 0
    const sortedLat = latPerStep.slice().sort((a, b) => a - b)
    const medLat = sortedLat.length ? sortedLat[Math.floor(sortedLat.length / 2)] : 0
    const meanCost = cellRows.reduce((a, b) => a + b.cost_estimate_usd, 0) / cellRows.length
    const rate = cellRows.length ? successes / cellRows.length : 0
    stats.push({
      cellId,
      n: cellRows.length,
      successRate: rate,
      meanTokensPerStep: meanTok,
      medianLatencyPerStep: medLat,
      meanCostPerTask: meanCost,
      meetsCriteria: rate >= 0.85 && medLat <= 3500 && meanTok <= 2900,
      config: FACTOR_DECODE[cellId] ?? { F1: 0, F2: 0, F3: 0, F4: 0, F5: 0 },
    })
  }
  stats.sort((a, b) => b.successRate - a.successRate || a.medianLatencyPerStep - b.medianLatencyPerStep)

  // ─── Main effects on success rate ─────────────────────────
  const effectRows = rows.map((r) => ({
    ...FACTOR_DECODE[r.cell_id],
    success: r.success ? 1 : 0,
    tokens: r.tokens_in_per_step.concat(r.tokens_out_per_step).reduce((a, b) => a + b, 0) / Math.max(1, r.steps_executed),
    latency: r.latency_ms_per_step.length ? r.latency_ms_per_step.slice().sort((a, b) => a - b)[Math.floor(r.latency_ms_per_step.length / 2)] : 0,
  }))
  const effects = mainEffects(effectRows, ['F1', 'F2', 'F3', 'F4', 'F5'], 'success')

  // ─── Pick winner ──────────────────────────────────────────
  const winners = stats.filter((s) => s.meetsCriteria)
  const winner = winners[0]

  // ─── Write verdict ────────────────────────────────────────
  const md: string[] = []
  md.push('# Verdict — walkthrough-bench DOE')
  md.push('')
  md.push(`Generated from ${rows.length} rows across ${byCell.size} cells.`)
  md.push('')

  md.push('## Per-cell results')
  md.push('')
  md.push('| cell | success | tok/step | latency p50 | $/task | n | snap | gran | retry | struct | model |')
  md.push('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const s of stats) {
    const c = s.config
    md.push(`| ${s.cellId} | ${(s.successRate * 100).toFixed(0)}% | ${s.meanTokensPerStep.toFixed(0)} | ${s.medianLatencyPerStep}ms | $${s.meanCostPerTask.toFixed(4)} | ${s.n} | ${FACTOR_NAMES.F1[c.F1]} | ${FACTOR_NAMES.F2[c.F2]} | ${FACTOR_NAMES.F3[c.F3]} | ${FACTOR_NAMES.F4[c.F4]} | ${FACTOR_NAMES.F5[c.F5]} |`)
  }
  md.push('')

  md.push('## Main effects on success rate')
  md.push('')
  md.push('| factor | low mean | high mean | effect | |effect| |')
  md.push('|---|---|---|---|---|')
  for (const f of ['F1', 'F2', 'F3', 'F4', 'F5'] as const) {
    const e: MainEffect = effects[f]
    md.push(`| ${f} (${FACTOR_NAMES[f][0]} → ${FACTOR_NAMES[f][1]}) | ${e.lowMean.toFixed(3)} | ${e.highMean.toFixed(3)} | ${e.effect.toFixed(3)} | ${e.absEffect.toFixed(3)} |`)
  }
  md.push('')

  md.push('## Top-effect factor (refinement target)')
  md.push('')
  const ranked = (['F1', 'F2', 'F3', 'F4', 'F5'] as const).map((f) => ({ f, e: effects[f].absEffect })).sort((a, b) => b.e - a.e)
  md.push(`Highest absolute effect on success rate: **${ranked[0].f}** (|effect|=${ranked[0].e.toFixed(3)}).`)
  md.push(`Refinement: 6-run 1FAT sweep across the unused levels of ${ranked[0].f} (see design.md §"Refinement pass").`)
  md.push('')

  md.push('## Winner')
  md.push('')
  if (winner) {
    const c = winner.config
    md.push(`**${winner.cellId}** — ${(winner.successRate * 100).toFixed(0)}% success, ${winner.medianLatencyPerStep}ms p50 latency, ${winner.meanTokensPerStep.toFixed(0)} tok/step, $${winner.meanCostPerTask.toFixed(4)}/task.`)
    md.push('')
    md.push('Lock as defaults in `macos/Spectra/LLM/PromptBuilder.swift > WalkthroughConfig`:')
    md.push('')
    md.push('```swift')
    md.push(`snapshot: .${FACTOR_NAMES.F1[c.F1]}`)
    md.push(`granularity: .${FACTOR_NAMES.F2[c.F2]}`)
    md.push(`retry: .${FACTOR_NAMES.F3[c.F3]}`)
    md.push(`structure: .${FACTOR_NAMES.F4[c.F4]}`)
    md.push(`model: "${FACTOR_NAMES.F5[c.F5]}"`)
    md.push('```')
  } else {
    md.push('**No cell meets all four acceptance criteria.** Recommended action:')
    md.push('')
    md.push('1. Inspect per-cell failures in `runs.jsonl` — sort by `error` field.')
    md.push('2. Run refinement (1FAT × 6) on top-effect factor.')
    md.push('3. Re-evaluate the bar: criterion 7 may need adjustment (e.g. 75%) or the benchmark needs harder/easier tasks.')
  }
  md.push('')

  md.push('## Caveats')
  md.push('')
  md.push(`- n per cell = ${stats[0]?.n ?? 0} (= number of tasks). For 95% CIs on success rate per cell, n ≥ 30 is recommended. Treat per-cell rates as point estimates.`)
  md.push('- Main effects pool across cells, so n per factor level = 64. Trust those more than per-cell rates.')
  md.push('- All runs were temperature=0; non-zero would inflate variance.')
  md.push('- Cost numbers use the prices in runner.ts; refresh before publishing.')
  md.push('')

  await writeFile(VERDICT_PATH, md.join('\n'))
  process.stdout.write(`Wrote verdict to ${VERDICT_PATH}\n`)
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${(err as Error).message}\n`)
  process.exit(1)
})
