import { spawn, type ChildProcess } from 'node:child_process'

export interface KeepAwakeController {
  recordingStarted(recordingId: string): Promise<void>
  recordingStopped(recordingId: string): Promise<void>
  close(): Promise<void>
  readonly activeRecordings: number
  readonly engaged: boolean
}

export class NoopKeepAwakeController implements KeepAwakeController {
  private readonly recordings = new Set<string>()

  get activeRecordings(): number {
    return this.recordings.size
  }

  get engaged(): boolean {
    return false
  }

  async recordingStarted(recordingId: string): Promise<void> {
    this.recordings.add(recordingId)
  }

  async recordingStopped(recordingId: string): Promise<void> {
    this.recordings.delete(recordingId)
  }

  async close(): Promise<void> {
    this.recordings.clear()
  }
}

export type KeepAwakeSpawn = (
  command: string,
  args: string[],
) => Pick<ChildProcess, 'pid' | 'kill' | 'once' | 'on'>

export interface DaemonKeepAwakeControllerOptions {
  command?: string
  args?: string[]
  platform?: NodeJS.Platform
  spawn?: KeepAwakeSpawn
}

export class DaemonKeepAwakeController implements KeepAwakeController {
  private readonly recordings = new Set<string>()
  private readonly command: string
  private readonly args: string[]
  private readonly platform: NodeJS.Platform
  private readonly spawnProcess: KeepAwakeSpawn
  private proc: Pick<ChildProcess, 'pid' | 'kill' | 'once' | 'on'> | undefined

  constructor(options: DaemonKeepAwakeControllerOptions = {}) {
    this.command = options.command ?? '/usr/bin/caffeinate'
    this.args = options.args ?? ['-d', '-i']
    this.platform = options.platform ?? process.platform
    this.spawnProcess = options.spawn ?? ((command, args) => spawn(command, args, { stdio: 'ignore' }))
  }

  get activeRecordings(): number {
    return this.recordings.size
  }

  get engaged(): boolean {
    return this.proc !== undefined
  }

  async recordingStarted(recordingId: string): Promise<void> {
    const wasIdle = this.recordings.size === 0
    this.recordings.add(recordingId)
    if (wasIdle) await this.ensureEngaged()
  }

  async recordingStopped(recordingId: string): Promise<void> {
    this.recordings.delete(recordingId)
    if (this.recordings.size === 0) {
      await this.release()
    }
  }

  async close(): Promise<void> {
    this.recordings.clear()
    await this.release()
  }

  private async ensureEngaged(): Promise<void> {
    if (this.platform !== 'darwin' || this.proc) return

    const child = this.spawnProcess(this.command, this.args)
    this.proc = child

    child.once('exit', () => {
      if (this.proc === child) this.proc = undefined
    })
    child.once('error', () => {
      if (this.proc === child) this.proc = undefined
    })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        if (error) reject(error)
        else resolve()
      }
      child.once('error', (error) => finish(error))
      setImmediate(() => {
        if (this.proc === child) finish()
        else finish(new Error(`Failed to start keep-awake process: ${this.command}`))
      })
    })
  }

  private async release(): Promise<void> {
    const child = this.proc
    if (!child) return
    this.proc = undefined
    child.kill()
  }
}

export function createKeepAwakeController(): KeepAwakeController {
  return new DaemonKeepAwakeController()
}
