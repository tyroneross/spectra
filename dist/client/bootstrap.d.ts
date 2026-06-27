import type { BootstrapFn, DaemonClient } from './daemon-client.js';
/** Resolve the compiled BE daemon entry (dist/daemon/server.js) from this module. */
export declare function resolveDaemonEntry(): string;
export interface BootstrapOptions {
    /** Path to the BE daemon entry. Defaults to the resolved dist/daemon/server.js. */
    daemonEntry?: string;
    /** How long to poll for health after spawn. Default 5s. */
    readyTimeoutMs?: number;
    /** Poll interval. Default 250ms. */
    pollIntervalMs?: number;
}
/**
 * Build a BootstrapFn that spawns the BE daemon detached and polls until the
 * client's health probe succeeds (or the timeout elapses). Resolves true only
 * when the daemon became reachable.
 */
export declare function spawnDaemonBootstrap(client: DaemonClient, opts?: BootstrapOptions): BootstrapFn;
//# sourceMappingURL=bootstrap.d.ts.map