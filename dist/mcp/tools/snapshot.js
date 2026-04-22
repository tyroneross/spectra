import { serializeSnapshot } from '../../core/serialize.js';
export async function handleSnapshot(params, ctx) {
    const driver = ctx.drivers.get(params.sessionId);
    if (!driver)
        throw new Error(`Session ${params.sessionId} not found`);
    const snap = await driver.snapshot();
    const result = {
        snapshot: serializeSnapshot(snap),
        elementCount: snap.elements.length,
    };
    if (params.screenshot) {
        const buf = await driver.screenshot();
        result.screenshot = buf.toString('base64');
    }
    return result;
}
//# sourceMappingURL=snapshot.js.map