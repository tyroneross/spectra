import type { CdpConnection } from './connection.js'

export class PageDomain {
  constructor(
    private conn: CdpConnection,
    private sessionId?: string,
  ) {}

  async navigate(url: string): Promise<string> {
    const result = await this.conn.send<{ frameId: string }>(
      'Page.navigate', { url }, this.sessionId,
    )
    return result.frameId
  }

  async screenshot(format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
    const result = await this.conn.send<{ data: string }>(
      'Page.captureScreenshot', { format }, this.sessionId,
    )
    return Buffer.from(result.data, 'base64')
  }

  async enableLifecycleEvents(): Promise<void> {
    await this.conn.send('Page.setLifecycleEventsEnabled', { enabled: true }, this.sessionId)
    await this.conn.send('Page.enable', {}, this.sessionId)
  }
}
