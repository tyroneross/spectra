import type { CdpConnection } from './connection.js';
export declare class RuntimeDomain {
    private conn;
    private sessionId?;
    constructor(conn: CdpConnection, sessionId?: string | undefined);
    evaluate(expression: string): Promise<unknown>;
}
//# sourceMappingURL=runtime.d.ts.map