import { handleStep } from './step.js';
import { handleCapture } from './capture.js';
import { detectState } from '../../intelligence/states.js';
export async function handleWalkthrough(params, ctx) {
    const driver = ctx.drivers.get(params.sessionId);
    if (!driver)
        throw new Error(`Session ${params.sessionId} not found`);
    const start = Date.now();
    const results = [];
    let stepsCompleted = 0;
    for (let i = 0; i < params.steps.length; i++) {
        const step = params.steps[i];
        const stepResult = {
            index: i,
            intent: step.intent,
            autoExecuted: false,
            success: false,
            elementCount: 0,
        };
        try {
            const stepResponse = await handleStep({ sessionId: params.sessionId, intent: step.intent }, ctx);
            stepResult.autoExecuted = stepResponse.autoExecuted ?? false;
            stepResult.action = stepResponse.action;
            // A step is only "completed" if it was auto-executed (i.e. an action was performed).
            // Steps that return candidates without executing are not counted as completed.
            stepResult.success = stepResult.autoExecuted;
            if (stepResult.autoExecuted) {
                stepsCompleted++;
            }
            // Detect UI state from post-step snapshot
            if (stepResponse.snapshot) {
                const snap = await driver.snapshot();
                const stateDetection = detectState(snap);
                stepResult.state = stateDetection.state;
                stepResult.elementCount = snap.elements.length;
            }
        }
        catch (err) {
            stepResult.success = false;
            stepResult.error = err instanceof Error ? err.message : String(err);
        }
        // Capture screenshot unless explicitly disabled
        if (step.capture !== false) {
            const waitMs = step.waitMs ?? 500;
            if (waitMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
            try {
                // Only apply clean on the first step by default (or always if params.clean is explicitly true)
                const applyClean = params.clean !== false;
                const captureResponse = await handleCapture({
                    sessionId: params.sessionId,
                    type: 'screenshot',
                    clean: applyClean,
                }, ctx);
                if (captureResponse.path) {
                    stepResult.screenshotPath = captureResponse.path;
                }
                // If we didn't already get state from snapshot, try to get it now
                if (!stepResult.state) {
                    try {
                        const snap = await driver.snapshot();
                        const stateDetection = detectState(snap);
                        stepResult.state = stateDetection.state;
                        stepResult.elementCount = snap.elements.length;
                    }
                    catch {
                        // best-effort
                    }
                }
            }
            catch (captureErr) {
                // Capture failure does not mark the step as failed — record separately
                if (!stepResult.error) {
                    stepResult.error = `Capture failed: ${captureErr instanceof Error ? captureErr.message : String(captureErr)}`;
                }
            }
        }
        results.push(stepResult);
    }
    const duration_ms = Date.now() - start;
    return {
        success: stepsCompleted === params.steps.length,
        stepsCompleted,
        stepsTotal: params.steps.length,
        results,
        duration_ms,
    };
}
//# sourceMappingURL=walkthrough.js.map