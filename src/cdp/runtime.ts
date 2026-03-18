import type { CdpConnection } from './connection.js'

export class RuntimeDomain {
  constructor(
    private conn: CdpConnection,
    private sessionId?: string,
  ) {}

  async evaluate(expression: string): Promise<unknown> {
    const result = await this.conn.send<{
      result: { type: string; value: unknown }
    }>('Runtime.evaluate', { expression, returnByValue: true }, this.sessionId)
    return result.result.value
  }
}
