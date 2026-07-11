import { buildTimedZoomTrack } from './zoom-keyframes.js';
export const atomizeScript = {
    title: 'Atomize AI',
    finalCaption: 'Atomize AI — the AI world, distilled daily',
    beats: [
        {
            id: 'hook',
            stepText: '33,000+ AI stories a day. Who has time?',
            startMs: 0,
            endMs: 5000,
            zoom: { cx: 0.32, cy: 0.13, scale: 1.4 },
            action: { kind: 'hold' },
        },
        {
            id: 'search',
            stepLabel: '①',
            stepText: 'Search the entire AI landscape',
            startMs: 5000,
            endMs: 16000,
            zoom: { cx: 0.30, cy: 0.10, scale: 1.5 },
            action: { kind: 'search', value: 'agentic frameworks' },
        },
        {
            id: 'graph',
            stepLabel: '②',
            stepText: 'See how it all connects',
            startMs: 16000,
            endMs: 28000,
            zoom: { cx: 0.5, cy: 0.45, scale: 1.4 },
            action: { kind: 'navigate', target: 'Graph' },
        },
        {
            id: 'brief',
            stepLabel: '③',
            stepText: 'Your daily brief, by domain',
            startMs: 28000,
            endMs: 42000,
            zoom: { cx: 0.45, cy: 0.45, scale: 1.4 },
            action: { kind: 'click', target: 'Research' },
        },
        {
            id: 'payoff',
            stepText: 'Atomize AI — the AI world, distilled daily',
            startMs: 42000,
            endMs: 50000,
            zoom: { cx: 0.5, cy: 0.5, scale: 1.0 },
            action: { kind: 'hold' },
        },
    ],
};
export function scriptDurationMs(script) {
    return Math.max(0, ...script.beats.map((beat) => beat.endMs));
}
export function scriptZoomWindows(script, totalMs = scriptDurationMs(script)) {
    return script.beats
        .filter((beat) => beat.zoom !== undefined)
        .map((beat) => ({
        startMs: Math.max(0, Math.min(totalMs, beat.startMs)),
        endMs: Math.max(0, Math.min(totalMs, beat.endMs)),
        cx: beat.zoom?.cx ?? 0.5,
        cy: beat.zoom?.cy ?? 0.5,
        scale: beat.zoom?.scale ?? 1,
    }))
        .filter((window) => window.endMs > window.startMs);
}
export function buildScriptZoomTrack(script, totalMs, fps, opts = {}) {
    return buildTimedZoomTrack(scriptZoomWindows(script, totalMs), totalMs, fps, opts);
}
export function scaleScriptToDuration(script, durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        throw new Error('durationMs must be a positive finite number');
    }
    const sourceDurationMs = scriptDurationMs(script);
    if (sourceDurationMs <= 0) {
        throw new Error('script duration must be greater than zero');
    }
    const ratio = durationMs / sourceDurationMs;
    return {
        ...script,
        beats: script.beats.map((beat) => ({
            ...cloneBeat(beat),
            startMs: Math.round(beat.startMs * ratio),
            endMs: beat.endMs === sourceDurationMs ? Math.round(durationMs) : Math.round(beat.endMs * ratio),
        })),
    };
}
/**
 * Shifts every beat later by `offsetMs`, preserving beat durations. Used by
 * polishScript to make room for the intro title card: the card occupies
 * [0, offsetMs) and the original storyboard plays unchanged after it.
 */
export function shiftScriptBy(script, offsetMs) {
    if (!Number.isFinite(offsetMs) || offsetMs < 0) {
        throw new Error('offsetMs must be a non-negative finite number');
    }
    if (offsetMs === 0)
        return script;
    return {
        ...script,
        beats: script.beats.map((beat) => ({
            ...cloneBeat(beat),
            startMs: beat.startMs + offsetMs,
            endMs: beat.endMs + offsetMs,
        })),
    };
}
export function clipScriptToDuration(script, durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new Error('durationMs must be a non-negative finite number');
    }
    return {
        ...script,
        beats: script.beats
            .map((beat) => ({
            ...cloneBeat(beat),
            startMs: Math.max(0, Math.min(durationMs, beat.startMs)),
            endMs: Math.max(0, Math.min(durationMs, beat.endMs)),
        }))
            .filter((beat) => beat.endMs > beat.startMs),
    };
}
function cloneBeat(beat) {
    return {
        ...beat,
        zoom: beat.zoom ? { ...beat.zoom } : undefined,
        action: beat.action ? { ...beat.action } : undefined,
    };
}
//# sourceMappingURL=script.js.map