// tests/native/bridge.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { NativeBridge } from '../../src/native/bridge.js'

describe('NativeBridge', { timeout: 30000 }, () => {
  const bridge = new NativeBridge()

  afterAll(async () => {
    await bridge.close()
  })

  it('starts the Swift binary and responds to ping', async () => {
    await bridge.start()
    expect(bridge.ready).toBe(true)

    const result = await bridge.send<{ pong: boolean }>('ping')
    expect(result.pong).toBe(true)
  })

  it('returns error for unknown methods', async () => {
    await expect(bridge.send('nonexistent.method')).rejects.toThrow('Unknown method')
  })

  it('handles concurrent requests', async () => {
    const [r1, r2, r3] = await Promise.all([
      bridge.send<{ pong: boolean }>('ping'),
      bridge.send<{ pong: boolean }>('ping'),
      bridge.send<{ pong: boolean }>('ping'),
    ])
    expect(r1.pong).toBe(true)
    expect(r2.pong).toBe(true)
    expect(r3.pong).toBe(true)
  })

  it('auto-starts on send if not started', async () => {
    const fresh = new NativeBridge()
    const result = await fresh.send<{ pong: boolean }>('ping')
    expect(result.pong).toBe(true)
    await fresh.close()
  })

  it('close() shuts down the process and sets ready to false', async () => {
    const b = new NativeBridge()
    await b.start()
    expect(b.ready).toBe(true)

    await b.close()
    expect(b.ready).toBe(false)
  })
})
