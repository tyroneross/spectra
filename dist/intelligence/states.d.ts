import type { Snapshot, Driver, Platform } from '../core/types.js';
import type { UIState, StateDetection } from './types.js';
export declare function detectState(snapshot: Snapshot): StateDetection;
export interface StateTrigger {
    state: UIState;
    platform: Platform;
    trigger: () => Promise<void>;
    restore: () => Promise<void>;
}
export interface StateTriggerOptions {
    conn: {
        send: (method: string, params?: any, sessionId?: string) => Promise<any>;
    } | null;
    sessionId?: string | null;
    platform: Platform;
}
/**
 * Create CDP-based state triggers for the given connection + platform.
 *
 * Backward-compatible overload: the old two-arg form (driver, platform) is
 * accepted and returns [] because there is no CDP connection to use.
 */
export declare function createStateTriggers(options: StateTriggerOptions): StateTrigger[];
export declare function createStateTriggers(_driver: Driver, _platform: Platform): StateTrigger[];
//# sourceMappingURL=states.d.ts.map