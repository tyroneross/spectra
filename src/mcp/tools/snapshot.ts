import type { ToolContext } from '../context.js'
import { serializeSnapshot } from '../../core/serialize.js'

export interface SnapshotParams {
  sessionId: string
  screenshot?: boolean
}

export interface SnapshotResult {
  snapshot: string
  elementCount: number
  screenshot?: string
}

export async function handleSnapshot(
  params: SnapshotParams,
  ctx: ToolContext,
): Promise<SnapshotResult> {
  const driver = ctx.drivers.get(params.sessionId)
  if (!driver) throw new Error(`Session ${params.sessionId} not found`)

  const snap = await driver.snapshot()
  const result: SnapshotResult = {
    snapshot: serializeSnapshot(snap),
    elementCount: snap.elements.length,
  }

  if (params.screenshot) {
    const buf = await driver.screenshot()
    result.screenshot = buf.toString('base64')
  }

  return result
}
