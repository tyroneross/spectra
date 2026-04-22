import { serializeSnapshot } from '../../core/serialize.js';
export async function handleAct(params, ctx) {
    const driver = ctx.drivers.get(params.sessionId);
    if (!driver)
        throw new Error(`Session ${params.sessionId} not found`);
    const session = ctx.sessions.get(params.sessionId);
    const snapshotBefore = await driver.snapshot();
    const startTime = Date.now();
    const result = await driver.act(params.elementId, params.action, params.value);
    // Record step
    if (session) {
        const screenshot = await driver.screenshot();
        await ctx.sessions.addStep(params.sessionId, {
            action: { type: params.action, elementId: params.elementId, value: params.value },
            snapshotBefore,
            snapshotAfter: result.snapshot,
            screenshot,
            success: result.success,
            error: result.error,
            duration: Date.now() - startTime,
        });
    }
    return {
        success: result.success,
        error: result.error,
        snapshot: serializeSnapshot(result.snapshot),
    };
}
//# sourceMappingURL=act.js.map