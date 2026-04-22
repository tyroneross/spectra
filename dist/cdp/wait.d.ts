import type { Element } from '../core/types.js';
import type { CdpConnection } from './connection.js';
export interface WaitOptions {
    interval?: number;
    stableTime?: number;
    timeout?: number;
}
type SnapshotFn = () => Promise<Element[]>;
export declare function buildFingerprint(elements: Element[]): string;
/**
 * Wait for a specific CDP event.
 */
export declare function waitForEvent(conn: CdpConnection, eventName: string, options?: {
    timeout?: number;
}): Promise<void>;
/**
 * Hybrid wait — event notification + stability check.
 * Subscribes to AX events, then confirms with fingerprint stability.
 */
export declare function waitForStable(conn: CdpConnection, getSnapshot: () => Promise<Element[]>, options?: WaitOptions & {
    eventName?: string;
}): Promise<{
    elements: Element[];
    timedOut: boolean;
}>;
export declare function waitForStableTree(getSnapshot: SnapshotFn, options?: WaitOptions): Promise<{
    elements: Element[];
    timedOut: boolean;
}>;
export {};
//# sourceMappingURL=wait.d.ts.map