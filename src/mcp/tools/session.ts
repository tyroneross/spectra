import type { ToolContext } from '../context.js'
import { recordings } from '../../media/recordings.js'
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface SessionParams {
  action: 'list' | 'get' | 'close' | 'close_all' | 'record_llm_usage'
  sessionId?: string
  /** For action=record_llm_usage: arbitrary JSON-serializable token usage payload. */
  usage?: unknown
}

export async function handleSession(params: SessionParams, ctx: ToolContext): Promise<unknown> {
  switch (params.action) {
    case 'list':
      return {
        sessions: ctx.sessions.list().map((s) => ({
          id: s.id,
          name: s.name,
          platform: s.platform,
          steps: s.steps.length,
          createdAt: new Date(s.createdAt).toISOString(),
        })),
      }

    case 'get': {
      if (!params.sessionId) throw new Error('sessionId required for get')
      const session = ctx.sessions.get(params.sessionId)
      if (!session) throw new Error(`Session ${params.sessionId} not found`)
      return { session }
    }

    case 'close': {
      if (!params.sessionId) throw new Error('sessionId required for close')
      // Abort any active recording first so we don't orphan an ffmpeg process
      await recordings.abort(params.sessionId).catch(() => {})
      const driver = ctx.drivers.get(params.sessionId)
      if (driver) {
        await driver.close()
        ctx.drivers.delete(params.sessionId)
      }
      // ctx.launches added in C2; older test-constructed contexts may not have it
      const launch = ctx.launches?.get(params.sessionId)
      if (launch && launch.killOnDisconnect) {
        await launch.kill().catch(() => {})
      }
      ctx.launches?.delete(params.sessionId)
      await ctx.sessions.close(params.sessionId)
      return { success: true }
    }

    case 'record_llm_usage': {
      if (!params.sessionId) throw new Error('sessionId required for record_llm_usage')
      const dirGetter = (ctx.sessions as { sessionDir?: (id: string) => string }).sessionDir
      const dir = typeof dirGetter === 'function' ? dirGetter.call(ctx.sessions, params.sessionId) : null
      if (!dir) throw new Error(`Session ${params.sessionId} has no storage directory`)
      await mkdir(dir, { recursive: true })
      const path = join(dir, 'llm-usage.json')
      // Append entry to a JSONL-ish array. Read existing → push → write.
      let existing: unknown[] = []
      try {
        const raw = await readFile(path, 'utf-8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) existing = parsed
      } catch {
        // Missing or unreadable — start fresh.
      }
      existing.push({ ts: Date.now(), ...((params.usage as Record<string, unknown>) ?? {}) })
      await writeFile(path, JSON.stringify(existing, null, 2))
      return { success: true, path, entries: existing.length }
    }

    case 'close_all':
      for (const [id, drv] of ctx.drivers) {
        await recordings.abort(id).catch(() => {})
        await drv.close().catch(() => {})
        ctx.drivers.delete(id)
      }
      if (ctx.launches) {
        for (const [id, launch] of ctx.launches) {
          if (launch.killOnDisconnect) {
            await launch.kill().catch(() => {})
          }
          ctx.launches.delete(id)
        }
      }
      await ctx.sessions.closeAll()
      return { success: true }

    default:
      throw new Error(`Unknown action: ${params.action}`)
  }
}
