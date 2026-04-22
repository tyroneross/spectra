type EventHandler = (params: unknown) => void;
export declare class CdpConnection {
    private ws;
    private nextId;
    private pending;
    private eventHandlers;
    private timeoutMs;
    constructor(options?: {
        timeoutMs?: number;
    });
    connect(wsUrl: string): Promise<void>;
    send<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
    on(method: string, handler: EventHandler): void;
    off(method: string, handler: EventHandler): void;
    private handleMessage;
    private handleClose;
    close(): Promise<void>;
    get connected(): boolean;
}
export {};
//# sourceMappingURL=connection.d.ts.map