// src/media/recorder.ts
import type { NativeBridge } from '../native/bridge.js'
import { unlink } from 'node:fs/promises'

export interface RecordHandle {
  stop(): Promise<string>   // path to final video
  cancel(): Promise<void>   // discard
}

export class SimRecordHandle implements RecordHandle {
  constructor(
    private bridge: NativeBridge,
    private recordingId: string,
    private deviceId: string,
  ) {}

  async stop(): Promise<string> {
    const result = await this.bridge.send<{ path: string }>('simRecord', {
      deviceId: this.deviceId,
      action: 'stop',
      recordingId: this.recordingId,
    })
    return result.path
  }

  async cancel(): Promise<void> {
    try {
      const path = await this.stop()
      await unlink(path).catch(() => {})
    } catch {
      // Already stopped or failed — ignore
    }
  }
}
