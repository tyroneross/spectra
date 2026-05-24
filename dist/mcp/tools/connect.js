import { detectPlatform } from '../context.js';
import { CdpDriver } from '../../cdp/driver.js';
import { NativeDriver } from '../../native/driver.js';
import { SimDriver } from '../../native/sim.js';
import { serializeSnapshot } from '../../core/serialize.js';
import { launchRepo, LauncherError } from '../../launcher/index.js';
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
export async function handleConnect(params, ctx, createDriver) {
    // ─── Launch first if a repoPath was supplied ─────────────────
    let launchHandle;
    let effectiveTarget = params.target;
    if (params.repoPath) {
        launchHandle = await launchRepo(params.repoPath);
        effectiveTarget = deriveTargetFromLaunch(launchHandle);
    }
    const { platform, driverType } = detectPlatform(effectiveTarget);
    const driverTarget = {};
    if (platform === 'web') {
        driverTarget.url = effectiveTarget;
    }
    else if (platform === 'macos') {
        driverTarget.appName = effectiveTarget;
    }
    else {
        driverTarget.deviceId = effectiveTarget.replace(/^sim:/, '');
    }
    const session = await ctx.sessions.create({
        name: params.name,
        platform,
        target: driverTarget,
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