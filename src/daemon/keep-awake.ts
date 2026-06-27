export interface KeepAwakeController {
  recordingStarted(recordingId: string): Promise<void>
  recordingStopped(recordingId: string): Promise<void>
  close(): Promise<void>
  readonly activeRecordings: number
}

/**
 * Phase 1 keeps the daemon-owned lifecycle hook in place but does not launch a
 * keep-awake subprocess yet because recording operations are intentionally
 * stubbed until the native ScreenCaptureKit worker move.
 */
export class NoopKeepAwakeController implements KeepAwakeController {
  private readonly recordings = new Set<string>()

  get activeRecordings(): number {
    return this.recordings.size
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
