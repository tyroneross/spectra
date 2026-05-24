// src/launcher/index.ts
//
// Entry point: take a repo path, detect kind, launch.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>
import { detectRepoKind } from './detect.js';
import { launchWebDevServer } from './web.js';
import { launchMacosApp } from './macos.js';
export { detectRepoKind } from './detect.js';
export { launchWebDevServer } from './web.js';
export { launchMacosApp } from './macos.js';
export { LauncherError } from './types.js';
export async function launchRepo(repoPath) {
    const detection = detectRepoKind(repoPath);
    switch (detection.kind) {
        case 'web-next':
        case 'web-vite':
            return launchWebDevServer({ repoPath, detection });
        case 'web-static':
            // Static: return a synthetic handle pointing at file://; the CDP driver
            // can open it directly. No process to manage.
            return {
                kind: 'web-static',
                url: `file://${detection.staticEntry}`,
                killOnDisconnect: false,
                kill: async () => { },
            };
        case 'macos':
            return launchMacosApp({ repoPath, detection });
    }
}
//# sourceMappingURL=index.js.map