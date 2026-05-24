// src/mcp/tools/llm-step.ts
//
// `spectra_llm_step` — execute a fully-formed action plan against a session.
//
// Designed for the "planner: 'client'" path: the Swift menu-bar app (which
// holds the user's Anthropic key) builds an `ActionPlan[]` from a single LLM
// turn, POSTs it here, and the daemon executes each step in order without
// ever touching the API key. Failures don't roll back (the UI side has no
// transactional model); they short-circuit with the partial result so the
// caller can decide whether to keep going.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>
import { serializeSnapshot } from '../../core/serialize.js';
export async function handleLlmStep(params, ctx) {
    if (!params.sessionId) {
        throw new Error('sessionId is required');
    }
    if (!Array.isArray(params.actions) || params.actions.length === 0) {
        throw new Error('actions must be a non-empty array');
    }
    const driver = ctx.drivers.get(params.sessionId);
    if (!driver) {
        throw new Error(`Session ${params.sessionId} not found`);
    }
    const session = ctx.sessions.get(params.sessionId);
    const results = [];
    let lastSnapshotSerialized;
    let overallSuccess = true;
    for (let i = 0; i < params.actions.length; i++) {
        const step = params.actions[i];
        const startedAt = Date.now();
        // Snapshot before each step so element IDs resolved by the LLM against an
        // older snapshot would have been mapped consistently. (The Swift app is
        // expected to plan against the most-recent snapshot it has; the driver
        // resolves elementId against current DOM/AX state regardless.)
        let snapshotBefore;
        try {
            snapshotBefore = await driver.snapshot();
        }
        catch (err) {
            results.push({
                index: i,
                intent: step.intent,
                type: step.type,
                elementId: step.elementId,
                success: false,
                error: `snapshot before step failed: ${err.message}`,
                durationMs: Date.now() - startedAt,
            });
            overallSuccess = false;
            if (!params.continueOnError)
                break;
            else
                continue;
        }
        let actResult;
        try {
            actResult = await driver.act(step.elementId, step.type, step.value);
        }
        catch (err) {
            results.push({
                index: i,
                intent: step.intent,
                type: step.type,
                elementId: step.elementId,
                success: false,
                error: err.message,
                durationMs: Date.now() - startedAt,
            });
            overallSuccess = false;
            if (!params.continueOnError)
                break;
            else
                continue;
        }
        if (step.waitAfterMs && step.waitAfterMs > 0) {
            await new Promise(resolve => setTimeout(resolve, step.waitAfterMs));
        }
        // Persist as a Session.Step so reveal/Save lands the screenshot.
        if (session && actResult.success) {
            try {
                const screenshot = await driver.screenshot();
                await ctx.sessions.addStep(params.sessionId, {
                    action: { type: step.type, elementId: step.elementId, value: step.value },
                    snapshotBefore,
                    snapshotAfter: actResult.snapshot,
                    screenshot,
                    success: actResult.success,
                    error: actResult.error,
                    duration: Date.now() - startedAt,
                    intent: step.intent,
                });
            }
            catch {
                // Persistence failures shouldn't fail the action.
            }
        }
        lastSnapshotSerialized = serializeSnapshot(actResult.snapshot);
        results.push({
            index: i,
            intent: step.intent,
            type: step.type,
            elementId: step.elementId,
            success: actResult.success,
            error: actResult.error,
            durationMs: Date.now() - startedAt,
        });
        if (!actResult.success) {
            overallSuccess = false;
            if (!params.continueOnError)
                break;
        }
    }
    return {
        sessionId: params.sessionId,
        stepsExecuted: results.length,
        stepsTotal: params.actions.length,
        success: overallSuccess,
        results,
        finalSnapshot: lastSnapshotSerialized,
    };
}
//# sourceMappingURL=llm-step.js.map