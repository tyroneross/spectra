import type { BootstrapFn, DaemonClient } from './daemon-client.js';
/** Resolves the on-disk path of the `dev.spectra.daemon-ts` LaunchAgent plist
 * — mirrors `LaunchAgentManager.swift`'s own plist path convention
 * (`~/Library/LaunchAgents/<label>.plist`) without importing Swift code (this
 * is a plain filesystem check from the TS client side). `homeDir` defaults to
 * the real `os.homedir()`; the only caller that overrides it is a regression
 * test (T-10), never production code. */
export declare function resolveFlipTopologyPlistPath(homeDir?: string): string;
/** True when the M3.G1 flip topology (S5's dual-LaunchAgent install) is
 * present on this machine — i.e. `dev.spectra.daemon-ts` was installed by
 * `flip-g1.sh`/`LaunchAgentManager`. Exported (additive) so a regression test
 * can assert both branches without touching the real
 * `~/Library/LaunchAgents`. */
export declare function isFlipTopologyInstalled(homeDir?: string): boolean;
/** Resolve the compiled BE daemon entry (dist/daemon/server.js) from this module. */
export declare function resolveDaemonEntry(): string;
export interface BootstrapOptions {
    /** Path to the BE daemon entry. Defaults to the resolved dist/daemon/server.js. */
    daemonEntry?: string;
    /** How long to poll for health after spawn. Default 5s. */
    readyTimeoutMs?: number;
    /** Poll interval. Default 250ms. */
    pollIntervalMs?: number;
    /** §G3 guard test-only override: the home directory the guard checks for
     * `Library/LaunchAgents/dev.spectra.daemon-ts.plist`. Defaults to the real
     * `os.homedir()`. Never set by production code — only by the T-10
     * regression harness (macos/Spectra/DaemonCore/verify-flip-suite.ts). */
    flipGuardHomeDir?: string;
}
/**
 * Build a BootstrapFn that spawns the BE daemon detached and polls until the
 * client's health probe succeeds (or the timeout elapses). Resolves true only
 * when the daemon became reachable.
 */
export declare function spawnDaemonBootstrap(client: DaemonClient, opts?: BootstrapOptions): BootstrapFn;
//# sourceMappingURL=bootstrap.d.ts.map