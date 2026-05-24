import { spawn } from 'node:child_process';
import { type DetectionResult, type LaunchHandle } from './types.js';
export interface WebLaunchOptions {
    repoPath: string;
    detection: DetectionResult;
    /** Override for tests — defaults to real spawn. */
    spawnFn?: typeof spawn;
    /** Override timeout for tests. */
    timeoutMs?: number;
}
export declare function launchWebDevServer(opts: WebLaunchOptions): Promise<LaunchHandle>;
//# sourceMappingURL=web.d.ts.map