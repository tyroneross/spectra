import type { HealthResult, PermissionStatus } from '../contract/core-api.js';
export interface HealthProbeOptions {
    startedAt?: number;
    daemonVersion?: string;
    now?: () => number;
    aquaSessionProbe?: () => Promise<boolean>;
    windowServerProbe?: (aquaSession: boolean) => Promise<{
        connected: boolean;
        error?: string;
    }>;
    permissionsProvider?: () => Promise<PermissionStatus[]>;
}
export declare function health(params?: {
    includePermissions?: boolean;
}, options?: HealthProbeOptions): Promise<HealthResult>;
export declare function probeAquaSession(): Promise<boolean>;
export declare function probeWindowServer(aquaSession: boolean): Promise<{
    connected: boolean;
    error?: string;
}>;
//# sourceMappingURL=health.d.ts.map