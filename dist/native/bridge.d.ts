export declare class NativeBridge {
    private process;
    private readline;
    private nextId;
    private pending;
    private heartbeatTimer;
    private _ready;
    get ready(): boolean;
    start(): Promise<void>;
    send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
    private handleLine;
    private startHeartbeat;
    private restart;
    private stopHeartbeat;
    close(): Promise<void>;
}
export declare function getSharedBridge(): NativeBridge;
//# sourceMappingURL=bridge.d.ts.map