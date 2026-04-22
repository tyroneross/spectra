import type { Platform } from '../core/types.js';
import type { CdpConnection } from '../cdp/connection.js';
export interface CleanOptions {
    hideScrollbars?: boolean;
    cleanStatusBar?: boolean;
    hideCursor?: boolean;
    viewport?: {
        width: number;
        height: number;
    };
    /** Injectable command runner — used for testing simctl commands */
    commandRunner?: (cmd: string, args: string[]) => Promise<void>;
}
export interface CleanState {
    platform: Platform;
    applied: string[];
    restoreActions: Array<() => Promise<void>>;
}
export declare function prepareForCapture(conn: CdpConnection | null, sessionId: string | null, platform: Platform, options?: CleanOptions): Promise<CleanState>;
export declare function restoreAfterCapture(state: CleanState): Promise<void>;
//# sourceMappingURL=clean.d.ts.map