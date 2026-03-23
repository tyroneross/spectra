import type { CdpConnection } from './connection.js'

export interface ScreenshotOptions {
  format?: 'png' | 'jpeg'
  quality?: number          // 1-100, only for jpeg
  clip?: {
    x: number
    y: number
    width: number
    height: number
    scale?: number          // device pixel ratio (default: 1)
  }
  hideScrollbars?: boolean
}

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

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const params: Record<string, unknown> = {
      format: options?.format ?? 'png',
    }
    if (options?.quality && options.format === 'jpeg') {
      params.quality = options.quality
    }
    if (options?.clip) {
      params.clip = { ...options.clip, scale: options.clip.scale ?? 1 }
    }
    const result = await this.conn.send<{ data: string }>(
      'Page.captureScreenshot', params, this.sessionId,
    )
    return Buffer.from(result.data, 'base64')
  }

  async enableLifecycleEvents(): Promise<void> {
    await this.conn.send('Page.setLifecycleEventsEnabled', { enabled: true }, this.sessionId)
    await this.conn.send('Page.enable', {}, this.sessionId)
  }
}
