import type { ToolContext } from '../context.js'

export interface SessionParams {
  action: 'list' | 'get' | 'close' | 'close_all'
  sessionId?: string
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
      const driver = ctx.drivers.get(params.sessionId)
      if (driver) {
        await driver.close()
        ctx.drivers.delete(params.sessionId)
      }
      await ctx.sessions.close(params.sessionId)
      return { success: true }
    }

    case 'close_all':
      for (const [id, drv] of ctx.drivers) {
        await drv.close().catch(() => {})
        ctx.drivers.delete(id)
      }
      await ctx.sessions.closeAll()
      return { success: true }

    default:
      throw new Error(`Unknown action: ${params.action}`)
  }
}
