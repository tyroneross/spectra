import type { CdpConnection } from './connection.js';
export declare class InputDomain {
    private conn;
    private sessionId?;
    constructor(conn: CdpConnection, sessionId?: string | undefined);
    click(x: number, y: number): Promise<void>;
    type(text: string): Promise<void>;
    scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
}
//# sourceMappingURL=input.d.ts.map