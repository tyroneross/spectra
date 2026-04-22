import type { CdpConnection } from './connection.js';
export declare class DomDomain {
    private conn;
    private sessionId?;
    constructor(conn: CdpConnection, sessionId?: string | undefined);
    getElementCenter(backendNodeId: number): Promise<{
        x: number;
        y: number;
    }>;
    getDocument(): Promise<{
        root: {
            nodeId: number;
        };
    }>;
}
//# sourceMappingURL=dom.d.ts.map