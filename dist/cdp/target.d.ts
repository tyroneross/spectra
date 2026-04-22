import type { CdpConnection } from './connection.js';
export declare class TargetDomain {
    private conn;
    constructor(conn: CdpConnection);
    createPage(url: string): Promise<string>;
    attach(targetId: string): Promise<string>;
    close(targetId: string): Promise<void>;
    list(): Promise<Array<{
        targetId: string;
        type: string;
        url: string;
    }>>;
}
//# sourceMappingURL=target.d.ts.map