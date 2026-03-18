type EventHandler = (params: unknown) => void

const DEFAULT_TIMEOUT_MS = 30_000

export class CdpConnection {
  private ws: WebSocket | null = null
  private nextId = 0
  private pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private eventHandlers = new Map<string, Set<EventHandler>>()
  private timeoutMs: number

  constructor(options?: { timeoutMs?: number }) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async connect(wsUrl: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(wsUrl)
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () =>
        reject(new Error(`WebSocket connection failed: ${wsUrl}`))
      )
      this.ws.addEventListener('message', (event) => this.handleMessage(event))
      this.ws.addEventListener('close', () => this.handleClose())
    })
  }

  async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected')
    }
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          const secs = (this.timeoutMs / 1000).toFixed(0)
          reject(new Error(
            `CDP request '${method}' timed out after ${secs}s. `
            + 'The browser may be unresponsive or the operation is taking too long.'
          ))
        }
      }, this.timeoutMs)
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      })
      const msg: Record<string, unknown> = { id, method }
      if (params) msg.params = params
      if (sessionId) msg.sessionId = sessionId
      this.ws!.send(JSON.stringify(msg))
    })
  }

  on(method: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(method)) {
      this.eventHandlers.set(method, new Set())
    }
    this.eventHandlers.get(method)!.add(handler)
  }

  off(method: string, handler: EventHandler): void {
    this.eventHandlers.get(method)?.delete(handler)
  }

  private handleMessage(event: MessageEvent): void {
    const data = JSON.parse(String(event.data))

    if ('id' in data && this.pending.has(data.id)) {
      const { resolve, reject, timer } = this.pending.get(data.id)!
      clearTimeout(timer)
      this.pending.delete(data.id)
      if (data.error) {
        reject(new Error(`CDP error ${data.error.code}: ${data.error.message}`))
      } else {
        resolve(data.result)
      }
    } else if ('method' in data) {
      const handlers = this.eventHandlers.get(data.method)
      if (handlers) {
        for (const handler of handlers) handler(data.params)
      }
    }
  }

  private handleClose(): void {
    for (const [, { reject, timer }] of this.pending) {
      clearTimeout(timer)
      reject(new Error('WebSocket closed'))
    }
    this.pending.clear()
    this.ws = null
  }

  async close(): Promise<void> {
    for (const [, { timer }] of this.pending) {
      clearTimeout(timer)
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.pending.clear()
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }
}
