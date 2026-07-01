import type { DemoScript, Beat } from './script.js';
import type { CdpDriver } from '../cdp/driver.js';
/** The kinds a beat action can carry. */
export type ScriptActionKind = NonNullable<Beat['action']>['kind'];
/** One log entry per executed beat action, in run order. */
export interface BeatActionLog {
    beatId: string;
    kind: ScriptActionKind;
    ok: boolean;
    detail: string;
}
export interface RunDemoScriptOptions {
    /**
     * WebSocket debugger URL of an already-open CDP page target to drive.
     * Mutually exclusive with `driver` — one of the two is required.
     */
    cdpUrl?: string;
    /**
     * An existing CdpDriver whose page will be driven. Its connection is
     * reused (never closed here); the caller owns its lifecycle.
     */
    driver?: CdpDriver;
    /**
     * Fast-forward the run clock to this offset (ms). A beat at `startMs`
     * waits `startMs - startAtMs`; beats already past it fire immediately.
     */
    startAtMs?: number;
}
/**
 * Execute a DemoScript's beat actions against a live browser page via the
 * existing CDP client. Beats run in order; each action waits for its
 * `startMs` (relative to run start, offset by `startAtMs`) before firing.
 * Missing elements are logged (ok:false) and never throw the run.
 */
export declare function runDemoScript(script: DemoScript, opts: RunDemoScriptOptions): Promise<BeatActionLog[]>;
//# sourceMappingURL=script-runner.d.ts.map