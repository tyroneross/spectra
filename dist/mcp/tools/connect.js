import { detectPlatform } from '../context.js';
import { CdpDriver } from '../../cdp/driver.js';
import { NativeDriver } from '../../native/driver.js';
import { SimDriver } from '../../native/sim.js';
import { serializeSnapshot } from '../../core/serialize.js';
export async function handleConnect(params, ctx, createDriver) {
    const { platform, driverType } = detectPlatform(params.target);
    // Build driver target
    const driverTarget = {};
    if (platform === 'web') {
        driverTarget.url = params.target;
    }
    else if (platform === 'macos') {
        driverTarget.appName = params.target;
    }
    else {
        driverTarget.deviceId = params.target.replace(/^sim:/, '');
    }
    // Create session
    const session = await ctx.sessions.create({
        name: params.name,
        platform,
        target: driverTarget,
    });
    // Create and connect driver
    const driver = createDriver
        ? createDriver()
        : driverType === 'cdp' ? new CdpDriver()
            : driverType === 'native' ? new NativeDriver()
                : new SimDriver();
    await driver.connect(driverTarget);
    ctx.drivers.set(session.id, driver);
    // Get initial snapshot
    const snap = await driver.snapshot();
    const serialized = serializeSnapshot(snap);
    return {
        sessionId: session.id,
        platform,
        elementCount: snap.elements.length,
        snapshot: serialized,
    };
}
//# sourceMappingURL=connect.js.map