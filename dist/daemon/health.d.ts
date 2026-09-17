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
    launcherPathProvider?: () => Promise<string | undefined>;
}
export declare function health(params?: {
    includePermissions?: boolean;
}, options?: HealthProbeOptions): Promise<HealthResult>;
/** Package root of the running build (the directory holding its package.json). */
export declare function daemonDistRoot(): string;
/** Executable of the parent process (the daemon launcher in normal installs). */
export declare function parentExecutablePath(ppid?: number): Promise<string | undefined>;
export declare function probeAquaSession(): Promise<boolean>;
export declare function probeWindowServer(aquaSession: boolean): Promise<{
    connected: boolean;
    error?: string;
}>;
//# sourceMappingURL=health.d.ts.map