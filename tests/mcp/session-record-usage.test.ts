// tests/mcp/session-record-usage.test.ts
//
// C5: record_llm_usage appends to <session.storageRoot>/llm-usage.json.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { handleSession } from '../../src/mcp/tools/session.js'
import { SessionManager } from '../../src/core/session.js'
import type { ToolContext } from '../../src/mcp/context.js'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('handleSession — record_llm_usage', () => {
  let repoRoot: string
  let ctx: ToolContext
  let sessionId: string
  const originalCwd = process.cwd()

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'spectra-llm-usage-'))
    await writeFile(join(repoRoot, 'package.json'), '{}')
    process.chdir(repoRoot)

    const sessions = new SessionManager()
    const session = await sessions.create({
      platform: 'web',
      target: { url: 'http://localhost:3000' },
      repoPath: repoRoot,
    })
    sessionId = session.id

    ctx = {
      sessions,
      drivers: new Map(),
      launches: new Map(),
    }
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(repoRoot, { recursive: true, force: true })
  })

  it('writes the usage payload to llm-usage.json under the session storage root', async () => {
    const result = (await handleSession({
      action: 'record_llm_usage',
      sessionId,
      usage: { model: 'claude-haiku-4-5', input: 100, output: 50 },
    }, ctx)) as { success: boolean; path: string; entries: number }

    expect(result.success).toBe(true)
    expect(result.path.startsWith(repoRoot)).toBe(true)
    expect(result.path.endsWith('llm-usage.json')).toBe(true)
    expect(result.entries).toBe(1)

    const raw = await readFile(result.path, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].model).toBe('claude-haiku-4-5')
    expect(parsed[0].ts).toBeTypeOf('number')
  })

  it('appends to existing llm-usage.json rather than overwriting', async () => {
    await handleSession({ action: 'record_llm_usage', sessionId, usage: { turn: 1 } }, ctx)
    const r2 = (await handleSession({
      action: 'record_llm_usage', sessionId, usage: { turn: 2 },
    }, ctx)) as { entries: number; path: string }

    expect(r2.entries).toBe(2)
    const parsed = JSON.parse(await readFile(r2.path, 'utf-8'))
    expect(parsed.map((e: { turn: number }) => e.turn)).toEqual([1, 2])
  })

  it('rejects when sessionId is missing', async () => {
    await expect(
      handleSession({ action: 'record_llm_usage' } as Parameters<typeof handleSession>[0], ctx),
    ).rejects.toThrow(/sessionId required/)
  })
})
