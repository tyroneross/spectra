// src/client/bootstrap.ts
//
// Default auto-bootstrap for the daemon client. When an adapter finds the
// daemon down, it may attempt to start it. The stdio MCP adapter runs inside
// Claude Code (no Aqua / window server), so a spawned daemon there is only
// useful for headless/dev work — GUI capture still requires the menu-bar app to
// bootstrap the daemon inside a logged-in desktop session. This bootstrap
// therefore spawns the BE daemon bin detached and polls health; if it cannot
// reach a healthy daemon, the client falls through to its actionable error.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
/** Resolve the compiled BE daemon entry (dist/daemon/server.js) from this module. */
export function resolveDaemonEntry() {
    // dist/client/bootstrap.js → ../daemon/server.js
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, '..', 'daemon', 'server.js');
}
/**
 * Build a BootstrapFn that spawns the BE daemon detached and polls until the
 * client's health probe succeeds (or the timeout elapses). Resolves true only
 * when the daemon became reachable.
 */
export function spawnDaemonBootstrap(client, opts = {}) {
    const daemonEntry = opts.daemonEntry ?? resolveDaemonEntry();
    const readyTimeoutMs = opts.readyTimeoutMs ?? 5_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 250;
    return async function bootstrap() {
        if (!existsSync(daemonEntry))
            return false;
        try {
            const child = spawn(process.execPath, [daemonEntry], {
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
        }
        catch {
            return false;
        }
        const deadline = Date.now() + readyTimeoutMs;
        while (Date.now() < deadline) {
            if (await client.isUp())
                return true;
            await delay(pollIntervalMs);
        }
        return false;
    };
}
function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=bootstrap.js.map