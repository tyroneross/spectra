import type { Driver, DriverTarget, Snapshot, ActResult, ActionType } from '../core/types.js';
export declare class TerminalDriver implements Driver {
    private process;
    private outputBuffer;
    private maxBuffer;
    private cols;
    private rows;
    private command;
    connect(target: DriverTarget): Promise<void>;
    snapshot(): Promise<Snapshot>;
    act(elementId: string, action: ActionType, value?: string): Promise<ActResult>;
    screenshot(): Promise<Buffer>;
    close(): Promise<void>;
    disconnect(): Promise<void>;
}
//# sourceMappingURL=driver.d.ts.map