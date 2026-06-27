/**
 * Phase 1 keeps the daemon-owned lifecycle hook in place but does not launch a
 * keep-awake subprocess yet because recording operations are intentionally
 * stubbed until the native ScreenCaptureKit worker move.
 */
export class NoopKeepAwakeController {
    recordings = new Set();
    get activeRecordings() {
        return this.recordings.size;
    }
    async recordingStarted(recordingId) {
        this.recordings.add(recordingId);
    }
    async recordingStopped(recordingId) {
        this.recordings.delete(recordingId);
    }
    async close() {
        this.recordings.clear();
    }
}
//# sourceMappingURL=keep-awake.js.map