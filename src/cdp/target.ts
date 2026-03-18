import type { CdpConnection } from './connection.js'

export class TargetDomain {
  constructor(private conn: CdpConnection) {}

  async createPage(url: string): Promise<string> {
    const result = await this.conn.send<{ targetId: string }>(
      'Target.createTarget', { url },
    )
    return result.targetId
  }

  async attach(targetId: string): Promise<string> {
    const result = await this.conn.send<{ sessionId: string }>(
      'Target.attachToTarget', { targetId, flatten: true },
    )
    return result.sessionId
  }

  async close(targetId: string): Promise<void> {
    await this.conn.send('Target.closeTarget', { targetId })
  }

  async list(): Promise<Array<{ targetId: string; type: string; url: string }>> {
    const result = await this.conn.send<{
      targetInfos: Array<{ targetId: string; type: string; url: string }>
    }>('Target.getTargets')
    return result.targetInfos
  }
}
