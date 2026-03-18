import type { CdpConnection } from './connection.js'

export class DomDomain {
  constructor(
    private conn: CdpConnection,
    private sessionId?: string,
  ) {}

  async getElementCenter(backendNodeId: number): Promise<{ x: number; y: number }> {
    const result = await this.conn.send<{
      model: { content: number[] }
    }>('DOM.getBoxModel', { backendNodeId }, this.sessionId)

    // content quad: [x1,y1, x2,y2, x3,y3, x4,y4] — four corners
    const q = result.model.content
    const x = Math.round((q[0] + q[2] + q[4] + q[6]) / 4)
    const y = Math.round((q[1] + q[3] + q[5] + q[7]) / 4)
    return { x, y }
  }

  async getDocument(): Promise<{ root: { nodeId: number } }> {
    return this.conn.send('DOM.getDocument', {}, this.sessionId)
  }
}
