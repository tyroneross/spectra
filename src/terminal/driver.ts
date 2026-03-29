import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { Driver, DriverTarget, Snapshot, ActResult, ActionType, Element } from '../core/types.js'

export class TerminalDriver implements Driver {
  private process: ChildProcess | null = null
  private outputBuffer: string[] = []
  private maxBuffer: number = 100
  private cols: number = 120
  private rows: number = 40
  private command: string = ''

  async connect(target: DriverTarget): Promise<void> {
    const command = target.command
    if (!command) {
      throw new Error('TerminalDriver requires target.command')
    }

    this.command = command
    this.outputBuffer = []

    this.process = spawn(command, [], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        COLUMNS: String(this.cols),
        LINES: String(this.rows),
      },
    })

    this.process.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      const newLines = text.split('\n')
      for (const line of newLines) {
        const trimmed = line.replace(/\r$/, '')
        if (trimmed.length > 0 || this.outputBuffer.length > 0) {
          this.outputBuffer.push(trimmed)
          if (this.outputBuffer.length > this.maxBuffer) {
            this.outputBuffer.shift()
          }
        }
      }
    })

    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      const newLines = text.split('\n')
      for (const line of newLines) {
        const trimmed = line.replace(/\r$/, '')
        if (trimmed.length > 0 || this.outputBuffer.length > 0) {
          this.outputBuffer.push(trimmed)
          if (this.outputBuffer.length > this.maxBuffer) {
            this.outputBuffer.shift()
          }
        }
      }
    })

    this.process.on('error', (err) => {
      console.error(`[TerminalDriver] process error: ${err.message}`)
    })

    console.log(`[TerminalDriver] spawned: ${command}`)
  }

  async snapshot(): Promise<Snapshot> {
    const elements: Element[] = this.outputBuffer.map((line, i) => ({
      id: `line-${i}`,
      role: 'text',
      label: line,
      value: null,
      enabled: true,
      focused: i === this.outputBuffer.length - 1,
      actions: [],
      bounds: [0, i, this.cols, 1] as [number, number, number, number],
      parent: null,
    }))

    return {
      platform: 'terminal',
      elements,
      timestamp: Date.now(),
      metadata: {
        elementCount: elements.length,
      },
    }
  }

  async act(elementId: string, action: ActionType, value?: string): Promise<ActResult> {
    if (action === 'type' && value !== undefined) {
      const stdin = this.process?.stdin
      if (!stdin || stdin.destroyed) {
        const snap = await this.snapshot()
        return { success: false, error: 'stdin is not writable', snapshot: snap }
      }

      await new Promise<void>((resolve, reject) => {
        stdin.write(value, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })

      const snap = await this.snapshot()
      return { success: true, snapshot: snap }
    }

    const snap = await this.snapshot()
    return {
      success: false,
      error: `TerminalDriver only supports 'type' action, got '${action}'`,
      snapshot: snap,
    }
  }

  async screenshot(): Promise<Buffer> {
    const lines = this.outputBuffer.slice(-this.rows)
    const text = lines.join('\n')
    return Buffer.from(text, 'utf8')
  }

  async close(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.stdin?.end()
      this.process.kill('SIGTERM')
      this.process = null
      console.log('[TerminalDriver] process closed')
    }
  }

  async disconnect(): Promise<void> {
    await this.close()
  }
}
