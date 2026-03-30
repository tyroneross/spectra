import type { CdpConnection } from './connection.js'

export type ConsoleLevel = 'log' | 'debug' | 'info' | 'error' | 'warning' | 'dir'
  | 'dirxml' | 'table' | 'trace' | 'clear' | 'startGroup' | 'startGroupCollapsed'
  | 'endGroup' | 'assert' | 'profile' | 'profileEnd' | 'count' | 'timeEnd'

export interface ConsoleMessage {
  type: ConsoleLevel
  text: string
  url?: string
  lineNumber?: number
  timestamp: number
}

type ConsoleHandler = (message: ConsoleMessage) => void

export class ConsoleDomain {
  private handlers = new Set<ConsoleHandler>()
  private messages: ConsoleMessage[] = []
  private enabled = false

  constructor(
    private conn: CdpConnection,
    private sessionId?: string,
  ) {}

  async enable(): Promise<void> {
    if (this.enabled) return
    this.enabled = true
    await this.conn.send('Runtime.enable', {}, this.sessionId)
    this.conn.on('Runtime.consoleAPICalled', (params: unknown) => {
      const data = params as {
        type: ConsoleLevel
        args: Array<{ type: string; value?: unknown; description?: string }>
        timestamp: number
        stackTrace?: { callFrames: Array<{ url: string; lineNumber: number }> }
      }
      const text = data.args
        .map(arg => arg.value !== undefined ? String(arg.value) : (arg.description ?? ''))
        .join(' ')
      const frame = data.stackTrace?.callFrames[0]
      const message: ConsoleMessage = {
        type: data.type,
        text,
        url: frame?.url,
        lineNumber: frame?.lineNumber,
        timestamp: data.timestamp,
      }
      this.messages.push(message)
      for (const handler of this.handlers) handler(message)
    })
  }

  onMessage(handler: ConsoleHandler): void { this.handlers.add(handler) }
  offMessage(handler: ConsoleHandler): void { this.handlers.delete(handler) }
  getMessages(): ConsoleMessage[] { return [...this.messages] }
  getErrors(): ConsoleMessage[] {
    return this.messages.filter(m => m.type === 'error' || m.type === 'warning')
  }
  clear(): void { this.messages = [] }
}
