import { detectPlatform } from '../context.js';
import { CdpDriver } from '../../cdp/driver.js';
import { NativeDriver } from '../../native/driver.js';
import { SimDriver } from '../../native/sim.js';
import { serializeSnapshot } from '../../core/serialize.js';
import { launchRepo, LauncherError } from '../../launcher/index.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const PID_TARGET = /^pid:(\d+)$/;
/**
 * Default resolver: ask the OS for the executable path of the pid and use its
 * basename. This is permission-free and works before any AX/ScreenCaptureKit
 * grant — the native snapshot response carries no app name, so it cannot serve
 * as the source here.
 */
async function appNameForPid(pid) {
    if (process.platform !== 'darwin')
        return undefined;
    try {
        const { stdout } = await execFileAsync('/bin/ps', ['-p', String(pid), '-o', 'comm='], { timeout: 2_000 });
        const executable = stdout.trim();
        if (!executable)
            return undefined;
        return executable.split('/').pop() || undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * If launching, the resolved target overrides the user-supplied one. For web
 * we use the printed dev-server URL; for macos we use the resolved app name.
 */
function deriveTargetFromLaunch(handle) {
    if (handle.url)
        return handle.url;
    if (handle.appName)
        return handle.appName;
    throw new LauncherError('Launch produced no usable target', 'Launcher returned neither a URL nor an app name.');
}
export async function handleConnect(params, ctx, createDriver, resolvePidAppName = appNameForPid) {
    // ─── Launch first if a repoPath was supplied ─────────────────
    let launchHandle;
    let effectiveTarget = params.target;
    if (params.repoPath) {
        launchHandle = await launchRepo(params.repoPath);
        effectiveTarget = deriveTargetFromLaunch(launchHandle);
    }
    // `pid:<n>` is the target-string spelling of the `pid` param. Strip it before
    // platform detection so the rest of the pipeline sees a normal macOS target.
    const targetPidMatch = PID_TARGET.exec(effectiveTarget.trim());
    let pid = params.pid;
    if (targetPidMatch) {
        const parsed = Number(targetPidMatch[1]);
        if (pid !== undefined && pid !== parsed) {
            throw new Error(`connect: target "${effectiveTarget}" and pid ${pid} disagree — pass one or make them match.`);
        }
        pid = parsed;
    }
    if (pid !== undefined && (!Number.isInteger(pid) || pid <= 0)) {
        throw new Error(`connect: pid must be a positive integer, got ${pid}`);
    }
    if (targetPidMatch) {
        // The session still records a human-readable app name for display and for
        // the recording-window lookup; the pid remains the authoritative selector.
        effectiveTarget = (pid !== undefined ? await resolvePidAppName(pid) : undefined) ?? `pid:${pid}`;
    }
    const { platform, driverType } = detectPlatform(effectiveTarget);
    if (pid !== undefined && platform !== 'macos') {
        throw new Error(`connect: pid targeting is macOS-only (target "${effectiveTarget}" resolved to ${platform}).`);
    }
    const driverTarget = {};
    if (platform === 'web') {
        driverTarget.url = effectiveTarget;
    }
    else if (platform === 'macos') {
        driverTarget.appName = effectiveTarget;
        if (pid !== undefined)
            driverTarget.pid = pid;
    }
    else {
        driverTarget.deviceId = effectiveTarget.replace(/^sim:/, '');
    }
    const session = await ctx.sessions.create({
        name: params.name,
        platform,
        target: driverTarget,
        // C2.6: anchor storage under the supplied repo so launchd-spawned daemons
        // (CWD=$HOME) still write into <repo>/.spectra/ instead of ~/.spectra/.
        repoPath: params.repoPath,
    });
    // Stash the launch handle so close-session can tear it down. ctx.launches
    // is added in C2; defensively guard for older test-constructed contexts.
    if (launchHandle) {
        if (ctx.launches) {
            ctx.launches.set(session.id, launchHandle);
        }
        const sessObj = ctx.sessions.get(session.id);
        if (sessObj) {
            sessObj.launchedProcess = {
                pid: launchHandle.pid,
                kind: launchHandle.kind,
                killOnDisconnect: launchHandle.killOnDisconnect,
            };
        }
    }
    // Record-only macOS sessions skip the Accessibility-gated AX snapshot. Recording
    // resolves the target window AND captures it via ScreenCaptureKit (Screen Recording
    // permission) — it never touches the AX element inventory. Coupling capture to the
    // snapshot forced an Accessibility grant the recording path doesn't use (root-caused
    // 2026-06-29). With `record: true` we register the session (target.appName is already
    // set above) and return without the AX call, so startRecording works with only the
    // Screen Recording grant.
    if (params.record === true && platform === 'macos') {
        return {
            sessionId: session.id,
            platform,
            elementCount: 0,
            snapshot: '',
            launched: launchHandle ? {
                kind: launchHandle.kind,
                pid: launchHandle.pid,
                url: launchHandle.url,
                appName: launchHandle.appName,
            } : undefined,
        };
    }
    const driver = createDriver
        ? createDriver()
        : driverType === 'cdp' ? new CdpDriver()
            : driverType === 'native' ? new NativeDriver()
                : new SimDriver();
    await driver.connect(driverTarget);
    ctx.drivers.set(session.id, driver);
    const snap = await driver.snapshot();
    const serialized = serializeSnapshot(snap);
    return {
        sessionId: session.id,
        platform,
        elementCount: snap.elements.length,
        snapshot: serialized,
        launched: launchHandle ? {
            kind: launchHandle.kind,
            pid: launchHandle.pid,
            url: launchHandle.url,
            appName: launchHandle.appName,
        } : undefined,
    };
}
//# sourceMappingURL=connect.js.map