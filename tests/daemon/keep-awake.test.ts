import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { DaemonKeepAwakeController } from '../../src/daemon/keep-awake.js'

class FakeChild extends EventEmitter {
  pid = 1234
  killed = false

  kill(): boolean {
    this.killed = true
    this.emit('exit', 0, null)
    return true
  }
}

describe('daemon keep-awake controller', () => {
  it('engages once for overlapping recordings and releases after the last stop', async () => {
    const children: FakeChild[] = []
    const spawns: Array<{ command: string, args: string[] }> = []
    const keepAwake = new DaemonKeepAwakeController({
      platform: 'darwin',
      spawn: (command, args) => {
        const child = new FakeChild()
        children.push(child)
        spawns.push({ command, args })
        return child as never
      },
    })

    await keepAwake.recordingStarted('a')
    await keepAwake.recordingStarted('b')

    expect(children).toHaveLength(1)
    expect(spawns).toEqual([{ command: '/usr/bin/caffeinate', args: ['-d', '-i'] }])
    expect(keepAwake.activeRecordings).toBe(2)
    expect(keepAwake.engaged).toBe(true)

    await keepAwake.recordingStopped('a')

    expect(children[0].killed).toBe(false)
    expect(keepAwake.activeRecordings).toBe(1)
    expect(keepAwake.engaged).toBe(true)

    await keepAwake.recordingStopped('b')

    expect(children[0].killed).toBe(true)
    expect(keepAwake.activeRecordings).toBe(0)
    expect(keepAwake.engaged).toBe(false)
  })

  it('releases an active keep-awake process on close', async () => {
    const child = new FakeChild()
    const keepAwake = new DaemonKeepAwakeController({
      platform: 'darwin',
      spawn: () => child as never,
    })

    await keepAwake.recordingStarted('a')
    await keepAwake.close()

    expect(child.killed).toBe(true)
    expect(keepAwake.activeRecordings).toBe(0)
    expect(keepAwake.engaged).toBe(false)
  })
})
