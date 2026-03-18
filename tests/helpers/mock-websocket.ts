export class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  static CLOSED = 3

  readyState = 0
  url: string

  private listeners = new Map<string, Set<Function>>()
  public sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: Function): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: Function): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string): void {
    this.sentMessages.push(data)
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close')
  }

  // ─── Test helpers ──────────────────────────────────────
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.emit('open')
  }

  simulateMessage(data: string): void {
    this.emit('message', { data })
  }

  simulateError(): void {
    this.emit('error', new Event('error'))
  }

  private emit(type: string, payload?: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(payload)
    }
  }

  static reset(): void {
    MockWebSocket.instances = []
  }
}
