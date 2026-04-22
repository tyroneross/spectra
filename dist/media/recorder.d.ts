import type { NativeBridge } from '../native/bridge.js';
export interface RecordHandle {
    stop(): Promise<string>;
    cancel(): Promise<void>;
}
export declare class SimRecordHandle implements RecordHandle {
    private bridge;
    private recordingId;
    private deviceId;
    constructor(bridge: NativeBridge, recordingId: string, deviceId: string);
    stop(): Promise<string>;
    cancel(): Promise<void>;
}
//# sourceMappingURL=recorder.d.ts.map