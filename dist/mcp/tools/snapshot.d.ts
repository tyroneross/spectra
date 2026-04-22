import type { ToolContext } from '../context.js';
export interface SnapshotParams {
    sessionId: string;
    screenshot?: boolean;
}
export interface SnapshotResult {
    snapshot: string;
    elementCount: number;
    screenshot?: string;
}
export declare function handleSnapshot(params: SnapshotParams, ctx: ToolContext): Promise<SnapshotResult>;
//# sourceMappingURL=snapshot.d.ts.map