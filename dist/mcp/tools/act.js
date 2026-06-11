import { serializeSnapshot } from '../../core/serialize.js';
export async function handleAct(params, ctx) {
    const driver = ctx.drivers.get(params.sessionId);
    if (!driver)
        throw new Error(`Session ${params.sessionId} not found`);
    const session = ctx.sessions.get(params.sessionId);
    const snapshotBefore = await driver.snapshot();
    const startTime = Date.now();
    const selectedElement = snapshotBefore.elements.find((el) => el.id === params.elementId);
    const decision = session
        ? await ctx.sessions.addDecision(params.sessionId, {
            tool: 'spectra_act',
            plannerSource: 'manual',
            outcome: 'manual',
            selected: {
                id: params.elementId,
                role: selectedElement?.role ?? 'unknown',
                label: selectedElement?.label ?? params.elementId,
            },
            action: {
                type: params.action,
                elementId: params.elementId,
                value: params.value,
            },
        })
        : null;
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
            tool: 'spectra_act',
            plannerSource: 'manual',
            decisionId: decision?.id,
        });
    }
    return {
        success: result.success,
        error: result.error,
        snapshot: serializeSnapshot(result.snapshot),
    };
}
//# sourceMappingURL=act.js.map