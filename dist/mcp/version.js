// src/mcp/version.ts
//
// Daemon + API version metadata. Read from package.json at startup so
// version drift between package.json and plugin.json is impossible to ship.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { API_VERSION } from '../contract/wire.js';
// API version is owned by the daemon wire contract.
export { API_VERSION };
let cachedDaemonVersion = null;
function readDaemonVersion() {
    if (cachedDaemonVersion)
        return cachedDaemonVersion;
    // src/mcp/version.ts → dist/mcp/version.js → ../../package.json
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        join(here, '..', '..', 'package.json'),
        join(here, '..', '..', '..', 'package.json'),
    ];
    for (const c of candidates) {
        try {
            const pkg = JSON.parse(readFileSync(c, 'utf8'));
            if (typeof pkg.version === 'string') {
                cachedDaemonVersion = pkg.version;
                return pkg.version;
            }
        }
        catch { /* try next */ }
    }
    cachedDaemonVersion = '0.0.0-unknown';
    return cachedDaemonVersion;
}
export function getVersionInfo() {
    return { apiVersion: API_VERSION, daemonVersion: readDaemonVersion() };
}
//# sourceMappingURL=version.js.map