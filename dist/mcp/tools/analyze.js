import { scoreElements, findRegions } from '../../intelligence/importance.js';
import { detectState } from '../../intelligence/states.js';
export async function handleAnalyze(params, ctx) {
    const driver = ctx.drivers.get(params.sessionId);
    if (!driver)
        throw new Error(`Session ${params.sessionId} not found`);
    const snapshot = await driver.snapshot();
    // Default viewport if not provided
    const viewport = {
        width: params.viewport?.width ?? 1280,
        height: params.viewport?.height ?? 800,
        devicePixelRatio: params.viewport?.devicePixelRatio ?? 1,
    };
    // Score elements
    const scores = scoreElements(snapshot.elements, viewport);
    // Find regions
    const regions = findRegions(scores, snapshot.elements);
    // Detect state
    const stateDetection = detectState(snapshot);
    // Top 10 elements by importance
    const topElements = scores.slice(0, 10).map(s => {
        const el = snapshot.elements.find(e => e.id === s.elementId);
        return {
            id: s.elementId,
            role: el?.role ?? 'unknown',
            label: el?.label ?? '',
            importance: Math.round(s.score * 1000) / 1000,
            bounds: el?.bounds ?? [0, 0, 0, 0],
        };
    });
    // Collect console errors from CDP driver if available
    const driverAny = driver;
    const consoleErrors = driverAny.console?.getErrors
        ? driverAny.console.getErrors().map((e) => ({
            type: e.type,
            text: e.text,
            url: e.url,
        }))
        : [];
    return {
        state: stateDetection.state,
        stateConfidence: Math.round(stateDetection.confidence * 1000) / 1000,
        regions: regions.map(r => ({
            label: r.label,
            score: Math.round(r.score * 1000) / 1000,
            bounds: r.bounds,
            elementCount: r.elements.length,
        })),
        topElements,
        totalElements: snapshot.elements.length,
        consoleErrors,
    };
}
//# sourceMappingURL=analyze.js.map