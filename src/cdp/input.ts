import type { CdpConnection } from './connection.js'

export class InputDomain {
  constructor(
    private conn: CdpConnection,
    private sessionId?: string,
  ) {}

  async click(x: number, y: number): Promise<void> {
    await this.conn.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    }, this.sessionId)
    await this.conn.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    }, this.sessionId)
  }

  async type(text: string): Promise<void> {
    for (const char of text) {
      await this.conn.send('Input.dispatchKeyEvent', {
        type: 'keyDown', text: char, key: char, code: `Key${char.toUpperCase()}`,
      }, this.sessionId)
      await this.conn.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: char, code: `Key${char.toUpperCase()}`,
      }, this.sessionId)
    }
  }

  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.conn.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y, deltaX, deltaY,
    }, this.sessionId)
  }
}
