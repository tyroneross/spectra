import { spawn } from 'node:child_process';
import { type DetectionResult, type LaunchHandle } from './types.js';
export interface MacosLaunchOptions {
    repoPath: string;
    detection: DetectionResult;
    /** Override for tests. */
    spawnFn?: typeof spawn;
    /** Override timeout for tests. */
    timeoutMs?: number;
    /** If true, resolve the app path but do not actually `open` it (tests). */
    dryRun?: boolean;
}
export declare function launchMacosApp(opts: MacosLaunchOptions): Promise<LaunchHandle>;
//# sourceMappingURL=macos.d.ts.map