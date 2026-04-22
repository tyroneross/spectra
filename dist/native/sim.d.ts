import type { Driver, DriverTarget, Snapshot, ActionType, ActResult } from '../core/types.js';
import { NativeBridge } from './bridge.js';
export declare class SimDriver implements Driver {
    private bridge;
    private deviceId;
    private platform;
    constructor(bridge?: NativeBridge);
    connect(target: DriverTarget): Promise<void>;
    snapshot(): Promise<Snapshot>;
    act(elementId: string, action: ActionType, value?: string): Promise<ActResult>;
    tap(x: number, y: number): Promise<{
        success: boolean;
    }>;
    screenshot(): Promise<Buffer>;
    close(): Promise<void>;
    disconnect(): Promise<void>;
}
//# sourceMappingURL=sim.d.ts.map