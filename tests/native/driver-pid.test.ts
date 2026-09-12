// tests/native/driver-pid.test.ts
//
// A pid-bound macOS session must never let the native helper resolve the
// target by app name — findApp(name) returns the FIRST running instance, which
// is the user's live app, not the isolated test instance.
import { describe, it, expect } from 'vitest'
import { NativeDriver } from '../../src/native/driver.js'
import type { NativeBridge } from '../../src/native/bridge.js'

interface SentCall {
  command: string
  params: Record<string, unknown> | undefined
}

function fakeBridge(calls: SentCall[]): NativeBridge {
  return {
    start: async () => {},
    close: async () => {},
    send: async (command: string, params?: Record<string, unknown>) => {
      calls.push({ command, params })
      if (command === 'snapshot') {
        return {
          elements: [{
            role: 'AXButton',
            label: 'Run',
            value: null,
            enabled: true,
            focused: false,
            actions: ['press'],
            bounds: [0, 0, 80, 32],
            path: [0, 1],
          }],
          window: { id: 22, title: 'Test', bounds: [0, 0, 800, 600] },
        }
      }
      if (command === 'act') return { success: true }
      if (command === 'screenshot') return { path: '/tmp/does-not-exist.png' }
      return {}
    },
  } as unknown as NativeBridge
}

describe('NativeDriver pid targeting', () => {
  it('sends pid and never app on connect, snapshot, and act', async () => {
    const calls: SentCall[] = []
    const driver = new NativeDriver(fakeBridge(calls))

    await driver.connect({ appName: 'Easy Terminal', pid: 4242 })
    await driver.snapshot()
    await driver.act('e1', 'click')

    expect(calls.map((call) => call.command)).toEqual(['snapshot', 'snapshot', 'act', 'snapshot'])
    for (const call of calls) {
      expect(call.params).toMatchObject({ pid: 4242 })
      expect(call.params).not.toHaveProperty('app')
    }
  })

  it('still targets by app name when no pid is bound', async () => {
    const calls: SentCall[] = []
    const driver = new NativeDriver(fakeBridge(calls))

    await driver.connect({ appName: 'Easy Terminal' })
    await driver.snapshot()

    for (const call of calls) {
      expect(call.params).toEqual({ app: 'Easy Terminal' })
    }
  })

  it('refuses a target with neither appName nor pid', async () => {
    const driver = new NativeDriver(fakeBridge([]))
    await expect(driver.connect({})).rejects.toThrow(/appName or pid/)
  })

  it('clears the pid binding on close', async () => {
    const calls: SentCall[] = []
    const driver = new NativeDriver(fakeBridge(calls))
    await driver.connect({ appName: 'Easy Terminal', pid: 4242 })
    await driver.close()
    await driver.snapshot()

    expect(calls.at(-1)?.params).toEqual({})
  })
})
