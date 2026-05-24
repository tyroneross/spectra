#!/usr/bin/env tsx
// .build-loop/experiments/walkthrough-bench/runner.ts
//
// Walkthrough DOE runner. Drives a 16-cell fractional factorial against
// `tasks.yaml`, scoring criterion 7 (text-input walkthrough quality).
//
// Prerequisites at run time:
//   1. ANTHROPIC_API_KEY env var (the runner calls Anthropic directly; the
//      daemon never sees the key — same trust model as the Swift app).
//   2. A running daemon on $PORT (default 47823) reachable via `~/.spectra/
//      daemon.token`. Start with: `node dist/cli/index.js daemon`.
//   3. js-yaml installed (devDependency).
//
// Usage:
//   tsx .build-loop/experiments/walkthrough-bench/runner.ts          # full 16-cell run
//   tsx .build-loop/experiments/walkthrough-bench/runner.ts --resume # skip rows already in runs.jsonl
//   tsx .build-loop/experiments/walkthrough-bench/runner.ts --cells 0,1,2  # subset
//
// Exit codes:
//   0 — runs.jsonl written with at least one row
//   2 — missing ANTHROPIC_API_KEY (we never fabricate runs)
//   3 — daemon unreachable
//   1 — other unexpected error
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { parse as parseYaml } from 'yaml'
import { evaluatePredicate, fractionalFactorial16, type SuccessPredicate } from '../lib/score.js'

// ─── Paths ────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const TASKS_PATH = join(__dirname, 'tasks.yaml')
const RUNS_PATH = join(__dirname, 'runs.jsonl')

// ─── Factor levels ────────────────────────────────────────────

const F1 = { 0: 'axOnly', 1: 'axPlusScreenshot' } as const
const F2 = { 0: 'oneAction', 1: 'threeToFive' } as const
const F3 = { 0: 'none', 1: 'oneRetryResnapshot' } as const
const F4 = { 0: 'terse', 1: 'roleToolsThreeShot' } as const
const F5 = { 0: 'claude-haiku-4-5', 1: 'claude-sonnet-4-6' } as const

interface Task {
  id: string
  surface: 'web' | 'macos'
  target_kind: 'repoPath' | 'url' | 'appName'
  target: string
  difficulty?: string
  instruction: string
  success_predicate: SuccessPredicate
  timeout_ms?: number
}

interface CellConfig {
  cellId: string
  snapshot: string
  granularity: string
  retry: string
  structure: string
  model: string
}

interface RunRow {
  ts: string
  git_sha: string
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

// ─── Pricing (per 1M tokens, USD) — sourced from anthropic.com 2026-05-24 ──
// If the runner is re-run after a price change, refresh these.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5':  { input: 1.0,  output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0,  output: 15.0 },
}

// ─── Anthropic call ───────────────────────────────────────────

interface MessagesResponse {
  content: Array<{ type: string; text?: string }>
  usage: { input_tokens: number; output_tokens: number }
  stop_reason?: string
}

async function callAnthropic(opts: {
  apiKey: string
  model: string
  system: string
  user: string
}): Promise<MessagesResponse> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 1024,
      temperature: 0,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 400)}`)
  }
  return (await res.json()) as MessagesResponse
}

// ─── Daemon MCP client (minimal — bearer + Streamable HTTP) ───

class DaemonMcp {
  private mcpSessionId: string | null = null
  private requestSeq = 0
  constructor(private port: number, private token: string) {}

  private async raw(body: object, expectSession = false): Promise<unknown> {
    const headers: Record<string, string> = {
      'authorization': `Bearer ${this.token}`,
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
    }
    if (this.mcpSessionId) headers['mcp-session-id'] = this.mcpSessionId
    const res = await fetch(`http://127.0.0.1:${this.port}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (res.status === 202) return null
    const text = await res.text()
    if (!res.ok) throw new Error(`mcp ${res.status}: ${text.slice(0, 400)}`)
    if (expectSession) {
      const sid = res.headers.get('mcp-session-id')
      if (sid) this.mcpSessionId = sid
    }
    // text/event-stream framing — extract first data: payload
    if (text.includes('data:')) {
      const m = text.match(/\bdata:\s*({[\s\S]*?})\s*(?:\n\n|$)/)
      if (m) return JSON.parse(m[1])
    }
    return JSON.parse(text)
  }

  async initialize(): Promise<void> {
    await this.raw({
      jsonrpc: '2.0',
      id: ++this.requestSeq,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'walkthrough-bench-runner', version: '0.3.0' },
      },
    }, true)
    await this.raw({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const resp = (await this.raw({
      jsonrpc: '2.0',
      id: ++this.requestSeq,
      method: 'tools/call',
      params: { name, arguments: args },
    })) as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } }
    if (resp.error) throw new Error(`mcp tool ${name}: ${resp.error.message ?? 'unknown'}`)
    const text = resp.result?.content?.[0]?.text
    if (typeof text !== 'string') throw new Error(`mcp tool ${name}: no text content`)
    return JSON.parse(text) as T
  }
}

// ─── Prompt assembly (mirrors PromptBuilder.swift exactly) ────

function buildSystemPrompt(cell: CellConfig): string {
  if (cell.structure === 'terse') {
    return cell.granularity === 'oneAction'
      ? 'You drive UIs. Given a snapshot and a goal, output exactly one next action as JSON.'
      : 'You drive UIs. Given a snapshot and a goal, output 3-5 next actions as a JSON array.'
  }
  const directive = cell.granularity === 'oneAction'
    ? 'Emit exactly ONE next action.'
    : 'Emit a plan of 3 to 5 next actions in sequence.'
  return `You are Spectra's walkthrough planner. You drive a UI by emitting a structured action plan that an executor will run against a live application.

# Available actions
- click(elementId)           — click or tap a visible element
- type(elementId, value)     — type text into an input
- clear(elementId)           — clear an input
- select(elementId, value)   — pick an option from a list/dropdown
- scroll(elementId)          — scroll the element (or page if document)
- hover(elementId)           — hover over an element
- focus(elementId)           — give an element keyboard focus

# How to plan
- You receive an accessibility snapshot listing elements with stable ids.
- Choose the action(s) that make the most concrete progress toward the user's goal.
- Never invent element ids. Only use ids that appear in the snapshot.
- ${directive}
- If the goal is already satisfied, emit zero actions and explain in \`done\` block.
- If no action makes progress (no relevant element on screen), emit zero actions and explain in \`error\` block.

# Examples
Snapshot has \`{"id":"e7","role":"button","label":"Log in"}\`. Goal: "log in".
Output:
{"actions":[{"type":"click","elementId":"e7","intent":"open login form"}]}

Snapshot has no relevant elements for "checkout". Output:
{"actions":[],"error":"No checkout-related elements visible."}`
}

function buildUserPrompt(instruction: string, snapshot: string, history: string[], granularity: string): string {
  const limit = granularity === 'oneAction' ? 'exactly 1 element' : 'between 3 and 5 elements'
  let s = `# Goal\n${instruction}\n\n`
  if (history.length) {
    s += '# Steps already taken\n'
    history.forEach((h, i) => { s += `${i + 1}. ${h}\n` })
    s += '\n'
  }
  s += `# Current UI snapshot\n\`\`\`\n${snapshot}\n\`\`\`\n\n`
  s += `# Output format\nRespond with ONLY a JSON object. Shape:\n{"actions":[ ${limit} ], "done"?: "...", "error"?: "..."}`
  return s
}

function parsePlan(raw: string): { actions: Array<{ type: string; elementId: string; value?: string; intent?: string }>; done?: string; error?: string } {
  let body = raw.trim()
  if (body.startsWith('```')) body = body.replace(/^```[a-z]*\n/, '').replace(/```$/, '')
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error(`no JSON object in: ${raw.slice(0, 120)}`)
  return JSON.parse(body.slice(start, end + 1))
}

// ─── Per-cell execution ───────────────────────────────────────

interface ConnectResult { sessionId: string; snapshot: string }

async function runTaskForCell(opts: {
  cell: CellConfig
  task: Task
  daemon: DaemonMcp
  apiKey: string
}): Promise<RunRow> {
  const { cell, task, daemon, apiKey } = opts
  const startedAt = Date.now()
  const latencies: number[] = []
  const tokensIn: number[] = []
  const tokensOut: number[] = []
  const history: string[] = []
  let stepsExecuted = 0
  let turns = 0
  let success = false
  let lastError: string | null = null

  const maxTurns = 10
  let sessionId: string | null = null

  try {
    // 1. Connect with launcher.
    const connect = await daemon.callTool<ConnectResult>('spectra_connect', {
      target: task.target_kind === 'appName' ? task.target : 'auto',
      repoPath: task.target_kind === 'repoPath' ? task.target.replace(/^~/, homedir()) : undefined,
    })
    sessionId = connect.sessionId

    for (let t = 0; t < maxTurns; t++) {
      turns = t + 1
      const snapResp = await daemon.callTool<{ snapshot: string }>('spectra_snapshot', { sessionId })
      const snapshot = snapResp.snapshot

      // Predicate check before acting — handles the "already there" case.
      if (evaluatePredicate(task.success_predicate, snapshot)) {
        success = true
        break
      }

      const tCallStart = Date.now()
      let llmResp: MessagesResponse
      try {
        llmResp = await callAnthropic({
          apiKey,
          model: cell.model,
          system: buildSystemPrompt(cell),
          user: buildUserPrompt(task.instruction, snapshot, history, cell.granularity),
        })
      } catch (err) {
        if (cell.retry !== 'none') {
          await new Promise((r) => setTimeout(r, 1500))
          try {
            llmResp = await callAnthropic({
              apiKey,
              model: cell.model,
              system: buildSystemPrompt(cell),
              user: buildUserPrompt(task.instruction, snapshot, history, cell.granularity),
            })
          } catch (err2) {
            lastError = `llm: ${(err2 as Error).message}`
            break
          }
        } else {
          lastError = `llm: ${(err as Error).message}`
          break
        }
      }
      latencies.push(Date.now() - tCallStart)
      tokensIn.push(llmResp.usage.input_tokens)
      tokensOut.push(llmResp.usage.output_tokens)

      const text = llmResp.content.find((c) => c.type === 'text')?.text ?? ''
      let plan: ReturnType<typeof parsePlan>
      try {
        plan = parsePlan(text)
      } catch (err) {
        lastError = `parse: ${(err as Error).message}`
        break
      }

      if ((plan.done && (!plan.actions || plan.actions.length === 0))) {
        // Re-snapshot + score to confirm.
        const finalSnap = (await daemon.callTool<{ snapshot: string }>('spectra_snapshot', { sessionId })).snapshot
        success = evaluatePredicate(task.success_predicate, finalSnap)
        if (!success) lastError = `claimed done but predicate fails: ${plan.done}`
        break
      }
      if (plan.error || !plan.actions || plan.actions.length === 0) {
        lastError = plan.error ?? 'empty plan'
        break
      }

      const stepResp = await daemon.callTool<{
        success: boolean
        stepsExecuted: number
        results: Array<{ index: number; success: boolean; error?: string; intent?: string; durationMs: number }>
      }>('spectra_llm_step', {
        sessionId,
        actions: plan.actions,
      })
      stepsExecuted += stepResp.stepsExecuted
      plan.actions.forEach((a, i) => {
        const r = stepResp.results[i]
        history.push(`${a.intent ?? `${a.type} ${a.elementId}`} — ${r?.success ? 'ok' : `failed: ${r?.error ?? 'unknown'}`}`)
      })
      if (!stepResp.success) {
        lastError = `step failed at index ${stepResp.stepsExecuted - 1}`
        if (cell.retry === 'none') break
        // retry = oneRetryResnapshot: continue the loop; next iteration re-snapshots.
      }

      // Post-step predicate check.
      const postSnap = (await daemon.callTool<{ snapshot: string }>('spectra_snapshot', { sessionId })).snapshot
      if (evaluatePredicate(task.success_predicate, postSnap)) {
        success = true
        break
      }
    }
  } catch (err) {
    lastError = `runtime: ${(err as Error).message}`
  } finally {
    if (sessionId) {
      try { await daemon.callTool('spectra_session', { action: 'close', sessionId }) } catch { /* ignore */ }
    }
  }

  // Cost estimate
  const pricing = PRICING[cell.model] ?? { input: 0, output: 0 }
  const totalIn = tokensIn.reduce((a, b) => a + b, 0)
  const totalOut = tokensOut.reduce((a, b) => a + b, 0)
  const cost = (totalIn * pricing.input + totalOut * pricing.output) / 1_000_000

  const medianLatency = latencies.length
    ? latencies.slice().sort((a, b) => a - b)[Math.floor(latencies.length / 2)]
    : 0

  return {
    ts: new Date().toISOString(),
    git_sha: gitSha(),
    cell_id: cell.cellId,
    task_id: task.id,
    surface: task.surface,
    difficulty: task.difficulty ?? 'unspecified',
    success,
    steps_executed: stepsExecuted,
    turns,
    latency_ms_per_step: latencies,
    tokens_in_per_step: tokensIn,
    tokens_out_per_step: tokensOut,
    cost_estimate_usd: Number(cost.toFixed(6)),
    elapsed_ms: Date.now() - startedAt,
    error: lastError,
    // Echo median so analysis doesn't have to recompute
    ...(medianLatency ? { latency_ms_median: medianLatency } : {}),
  } as RunRow
}

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    process.stderr.write(
      'ERROR: ANTHROPIC_API_KEY not set in env. The DOE makes real Anthropic API calls; we do NOT fabricate results.\n' +
      'Set the env var and re-run.\n',
    )
    process.exit(2)
  }

  const port = Number(process.env.SPECTRA_DAEMON_PORT ?? 47823)
  const tokenPath = join(homedir(), '.spectra', 'daemon.token')
  if (!existsSync(tokenPath)) {
    process.stderr.write(`ERROR: daemon token missing at ${tokenPath}. Is the daemon running?\n`)
    process.exit(3)
  }
  const token = readFileSync(tokenPath, 'utf-8').trim()
  const daemon = new DaemonMcp(port, token)

  try {
    await daemon.initialize()
  } catch (err) {
    process.stderr.write(`ERROR: daemon unreachable at 127.0.0.1:${port}: ${(err as Error).message}\n`)
    process.exit(3)
  }

  // Load tasks
  const tasksRaw = await readFile(TASKS_PATH, 'utf-8')
  const tasksDoc = parseYaml(tasksRaw) as { tasks: Task[] }
  const tasks = tasksDoc.tasks

  // Build cell list
  const cellLevels = fractionalFactorial16(['F1', 'F2', 'F3', 'F4', 'F5'])
  const cells: CellConfig[] = cellLevels.map((row, i) => ({
    cellId: `c${String(i).padStart(2, '0')}`,
    snapshot: F1[row.F1],
    granularity: F2[row.F2],
    retry: F3[row.F3],
    structure: F4[row.F4],
    model: F5[row.F5],
  }))

  // Optional --cells filter
  const cellsArg = process.argv.find((a) => a.startsWith('--cells='))
  const cellsFilter = cellsArg ? new Set(cellsArg.slice(8).split(',').map((s) => `c${s.padStart(2, '0')}`)) : null

  // --resume: skip rows already in runs.jsonl
  const resume = process.argv.includes('--resume')
  const existingRows = new Set<string>()
  if (resume && existsSync(RUNS_PATH)) {
    for (const line of (await readFile(RUNS_PATH, 'utf-8')).split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line) as { cell_id?: string; task_id?: string }
        if (r.cell_id && r.task_id) existingRows.add(`${r.cell_id}:${r.task_id}`)
      } catch { /* ignore */ }
    }
  }

  await mkdir(dirname(RUNS_PATH), { recursive: true })
  let written = 0
  const startedAt = Date.now()

  for (const cell of cells) {
    if (cellsFilter && !cellsFilter.has(cell.cellId)) continue
    for (const task of tasks) {
      const key = `${cell.cellId}:${task.id}`
      if (existingRows.has(key)) {
        process.stdout.write(`[skip] ${key} (resume)\n`)
        continue
      }
      process.stdout.write(`[run] ${key} model=${cell.model} struct=${cell.structure} retry=${cell.retry}\n`)
      const row = await runTaskForCell({ cell, task, daemon, apiKey })
      await appendFile(RUNS_PATH, JSON.stringify(row) + '\n')
      written++
      process.stdout.write(`     → success=${row.success} steps=${row.steps_executed} turns=${row.turns} cost=$${row.cost_estimate_usd} elapsed=${row.elapsed_ms}ms\n`)
    }
  }

  process.stdout.write(`\nDONE. wrote ${written} rows to ${RUNS_PATH} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`)
  process.stdout.write(`Run analyze.ts next to produce verdict.md.\n`)
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${(err as Error).message}\n`)
  process.exit(1)
})
