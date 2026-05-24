import type { LaunchHandle } from './types.js';
export { detectRepoKind } from './detect.js';
export { launchWebDevServer } from './web.js';
export { launchMacosApp } from './macos.js';
export { LauncherError } from './types.js';
export type { LaunchHandle, LaunchKind, DetectionResult } from './types.js';
export declare function launchRepo(repoPath: string): Promise<LaunchHandle>;
//# sourceMappingURL=index.d.ts.map