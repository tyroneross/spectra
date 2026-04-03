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
      const ws = new WebSocket(wsUrl)
      let settled = false

      const onOpen = () => {
        if (settled) return
        settled = true
        this.ws = ws
        ws.addEventListener('message', (event) => this.handleMessage(event))
        ws.addEventListener('close', () => this.handleClose())
        ws.addEventListener('error', () => this.handleClose())
        resolve()
      }

      const onError = () => {
        if (settled) return
        settled = true
        reject(new Error(`WebSocket connection failed: ${wsUrl}`))
      }

      ws.addEventListener('open', onOpen)
      ws.addEventListener('error', onError)
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
    let data: Record<string, unknown>
    try {
      data = JSON.parse(String(event.data))
    } catch {
      return // Malformed frame — skip
    }

    if ('id' in data && this.pending.has(data.id as number)) {
      const id = data.id as number
      const { resolve, reject, timer } = this.pending.get(id)!
      clearTimeout(timer)
      this.pending.delete(id)
      if (data.error) {
        const err = data.error as { code: number; message: string }
        reject(new Error(`CDP error ${err.code}: ${err.message}`))
      } else {
        resolve(data.result)
      }
    } else if ('method' in data) {
      const handlers = this.eventHandlers.get(data.method as string)
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
