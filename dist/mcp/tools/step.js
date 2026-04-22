import { resolve } from '../../core/resolve.js';
import { serializeSnapshot, serializeElement } from '../../core/serialize.js';
export async function handleStep(params, ctx) {
    const driver = ctx.drivers.get(params.sessionId);
    if (!driver)
        throw new Error(`Session ${params.sessionId} not found`);
    const snap = await driver.snapshot();
    const resolved = resolve({ intent: params.intent, elements: snap.elements, mode: 'claude' });
    // High confidence → auto-execute
    if (resolved.confidence > 0.9 && !resolved.candidates) {
        const actionType = inferActionFromIntent(params.intent);
        const value = extractValue(params.intent);
        const start = Date.now();
        const actResult = await driver.act(resolved.element.id, actionType, value);
        const duration = Date.now() - start;
        const screenshot = await driver.screenshot();
        await ctx.sessions.addStep(params.sessionId, {
            action: { type: actionType, elementId: resolved.element.id, value },
            snapshotBefore: snap,
            snapshotAfter: actResult.snapshot,
            screenshot,
            success: actResult.success,
            error: actResult.error,
            duration,
            intent: params.intent,
        });
        return {
            snapshot: serializeSnapshot(actResult.snapshot),
            autoExecuted: true,
            action: `${actionType} on ${serializeElement(resolved.element)}`,
        };
    }
    // Low confidence or multiple candidates → return for Claude to pick
    const candidates = (resolved.candidates ?? [resolved.element]).map((el) => ({
        id: el.id,
        role: el.role,
        label: el.label,
    }));
    const result = {
        snapshot: serializeSnapshot(snap),
        candidates,
    };
    // Vision fallback: include screenshot so Claude can visually identify the target
    if (resolved.visionFallback) {
        result.visionFallback = true;
        const buf = await driver.screenshot();
        result.screenshot = buf.toString('base64');
    }
    return result;
}
function inferActionFromIntent(intent) {
    const lower = intent.toLowerCase();
    if (lower.includes('type') || lower.includes('enter') || lower.includes('fill'))
        return 'type';
    if (lower.includes('clear'))
        return 'clear';
    if (lower.includes('scroll'))
        return 'scroll';
    if (lower.includes('hover'))
        return 'hover';
    return 'click';
}
function extractValue(intent) {
    const match = intent.match(/"([^"]+)"/);
    return match?.[1];
}
//# sourceMappingURL=step.js.map