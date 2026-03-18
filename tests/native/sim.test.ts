// tests/native/sim.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { NativeBridge } from '../../src/native/bridge.js'
import { existsSync } from 'node:fs'
import { BINARY_PATH } from '../../src/native/compiler.js'

const hasBinary = existsSync(BINARY_PATH)

describe.skipIf(!hasBinary)('SimDriver', () => {
  const bridge = new NativeBridge()

  afterAll(async () => {
    await bridge.close()
  })

  it('lists simulator devices', async () => {
    await bridge.start()
    const result = await bridge.send<{ devices: Array<{ udid: string; name: string; state: string; runtime: string }> }>('simDevices')

    expect(result.devices).toBeDefined()
    expect(Array.isArray(result.devices)).toBe(true)
    // Should have at least some devices if Xcode is installed
    // (may be empty in CI — just verify structure)
    if (result.devices.length > 0) {
      const device = result.devices[0]
      expect(device.udid).toBeDefined()
      expect(device.name).toBeDefined()
      expect(device.state).toBeDefined()
      expect(device.runtime).toBeDefined()
    }
  })
})
