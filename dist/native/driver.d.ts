import type { Driver, DriverTarget, Snapshot, ActionType, ActResult } from '../core/types.js';
import { NativeBridge } from './bridge.js';
export declare class NativeDriver implements Driver {
    private bridge;
    private appName;
    private appPid;
    private windowId;
    private idToPath;
    constructor(bridge?: NativeBridge);
    connect(target: DriverTarget): Promise<void>;
    /**
     * The process selector for every native bridge call. `pid` wins outright:
     * once a session is pid-bound, no call may ever be resolved by app name.
     */
    private targetParams;
    snapshot(): Promise<Snapshot>;
    act(elementId: string, action: ActionType, value?: string): Promise<ActResult>;
    screenshot(): Promise<Buffer>;
    close(): Promise<void>;
    disconnect(): Promise<void>;
}
//# sourceMappingURL=driver.d.ts.map