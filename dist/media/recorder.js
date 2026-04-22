import { unlink } from 'node:fs/promises';
export class SimRecordHandle {
    bridge;
    recordingId;
    deviceId;
    constructor(bridge, recordingId, deviceId) {
        this.bridge = bridge;
        this.recordingId = recordingId;
        this.deviceId = deviceId;
    }
    async stop() {
        const result = await this.bridge.send('simRecord', {
            deviceId: this.deviceId,
            action: 'stop',
            recordingId: this.recordingId,
        });
        return result.path;
    }
    async cancel() {
        try {
            const path = await this.stop();
            await unlink(path).catch(() => { });
        }
        catch {
            // Already stopped or failed — ignore
        }
    }
}
//# sourceMappingURL=recorder.js.map