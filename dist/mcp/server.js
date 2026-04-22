import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createContext } from './context.js';
import { handleConnect } from './tools/connect.js';
import { handleSnapshot } from './tools/snapshot.js';
import { handleAct } from './tools/act.js';
import { handleStep } from './tools/step.js';
import { handleCapture } from './tools/capture.js';
import { handleSession } from './tools/session.js';
import { handleAnalyze } from './tools/analyze.js';
import { handleDiscover } from './tools/discover.js';
import { handleWalkthrough } from './tools/walkthrough.js';
import { handleRecord, handleReplay } from './tools/record.js';
import { handleLibrary } from './tools/library.js';
import { registerResources } from './resources.js';
const ctx = createContext();
const server = new McpServer({
    name: 'spectra',
    version: '0.1.0',
});
registerResources(server, ctx);
// ─── Error handling helpers ───────────────────────────────────
function getErrorHint(tool, message) {
    if (message.includes('not found')) {
        return 'Run spectra_session action="list" to see active sessions, or spectra_connect to start a new one.';
    }
    if (message.includes('Element') && message.includes('not found')) {
        return 'Run spectra_snapshot to refresh the element inventory.';
    }
    if (message.includes('connect')) {
        return 'Check that the target URL is accessible and Chrome is available.';
    }
    return 'Check spectra_session action="list" for session status.';
}
function wrapHandler(handler, toolName) {
    return handler()
        .then(result => ({
        content: [{ type: 'text', text: JSON.stringify({ ...Object(result), timestamp: Date.now() }, null, 2) }],
    }))
        .catch((err) => ({
        content: [{ type: 'text', text: JSON.stringify({
                    error: err.message,
                    tool: toolName,
                    hint: getErrorHint(toolName, err.message),
                    timestamp: Date.now(),
                }, null, 2) }],
        isError: true,
    }));
}
// ─── Tool registrations ───────────────────────────────────────
server.tool('spectra_connect', 'Start a new UI automation session. Target: URL (web), app name (macOS), sim:device (iOS/watchOS).', {
    target: z.string().describe('URL, app name, or sim:device identifier'),
    name: z.string().optional().describe('Human-readable session name'),
    record: z.boolean().optional().describe('Start video recording'),
}, 
// annotations: readOnlyHint=false, destructiveHint=false, idempotentHint=true
{ readOnlyHint: false, destructiveHint: false, idempotentHint: true }, async ({ target, name, record }) => {
    return wrapHandler(() => handleConnect({ target, name, record }, ctx), 'spectra_connect');
});
server.tool('spectra_snapshot', 'Get current AX tree snapshot of the active session.', {
    sessionId: z.string().describe('Session ID'),
    screenshot: z.boolean().optional().describe('Include screenshot'),
}, 
// annotations: readOnlyHint=true, destructiveHint=false, idempotentHint=true
{ readOnlyHint: true, destructiveHint: false, idempotentHint: true }, async ({ sessionId, screenshot }) => {
    return wrapHandler(async () => {
        const result = await handleSnapshot({ sessionId, screenshot }, ctx);
        return { snapshot: result.snapshot, elementCount: result.elementCount };
    }, 'spectra_snapshot');
});
server.tool('spectra_act', 'Perform an action on an element (click, type, clear, scroll, hover, focus).', {
    sessionId: z.string(),
    elementId: z.string().describe('Element ID from snapshot (e.g., "e4")'),
    action: z.enum(['click', 'type', 'clear', 'select', 'scroll', 'hover', 'focus']),
    value: z.string().optional().describe('Text to type or scroll amount'),
}, 
// annotations: readOnlyHint=false, destructiveHint=true, idempotentHint=false
{ readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async ({ sessionId, elementId, action, value }) => {
    return wrapHandler(() => handleAct({ sessionId, elementId, action, value }, ctx), 'spectra_act');
});
server.tool('spectra_step', 'Natural language step: describe what to do, Spectra finds the element and optionally executes.', {
    sessionId: z.string(),
    intent: z.string().describe('What to do, e.g., "click the Log In button"'),
}, 
// annotations: readOnlyHint=false, destructiveHint=true, idempotentHint=false
{ readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async ({ sessionId, intent }) => {
    // step returns mixed content (text + optional image) so we keep its special
    // content assembly intact and only standardize the error path
    try {
        const result = await handleStep({ sessionId, intent }, ctx);
        const { screenshot, ...textResult } = result;
        const content = [
            { type: 'text', text: JSON.stringify({ ...textResult, timestamp: Date.now() }, null, 2) },
        ];
        if (screenshot) {
            content.push({ type: 'image', data: screenshot, mimeType: 'image/png' });
        }
        return { content };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            content: [{ type: 'text', text: JSON.stringify({
                        error: message,
                        tool: 'spectra_step',
                        hint: getErrorHint('spectra_step', message),
                        timestamp: Date.now(),
                    }, null, 2) }],
            isError: true,
        };
    }
});
server.tool('spectra_capture', 'Capture screenshot or manage video recording. Supports intelligent framing modes: full, element, region, auto.', {
    sessionId: z.string(),
    type: z.enum(['screenshot', 'start_recording', 'stop_recording']),
    mode: z.enum(['full', 'element', 'region', 'auto']).optional().describe('Capture mode (default: full)'),
    elementId: z.string().optional().describe('Element ID for mode=element'),
    region: z.string().optional().describe('Region label for mode=region (e.g., "Navigation", "Form")'),
    aspectRatio: z.string().optional().describe('Output aspect ratio e.g. "16:9", "4:3", "1:1"'),
    clean: z.boolean().optional().describe('Apply visual cleanup before capture (default: true)'),
    quality: z.enum(['lossless', 'high', 'medium']).optional().describe('Output quality'),
}, 
// annotations: readOnlyHint=true, destructiveHint=false, idempotentHint=true
{ readOnlyHint: true, destructiveHint: false, idempotentHint: true }, async ({ sessionId, type, mode, elementId, region, aspectRatio, clean, quality }) => {
    return wrapHandler(() => handleCapture({ sessionId, type, mode, elementId, region, aspectRatio, clean, quality }, ctx), 'spectra_capture');
});
server.tool('spectra_analyze', 'Score the current screen and identify regions of interest, UI state, and top elements by importance', {
    sessionId: z.string().describe('Active session ID'),
    viewport: z.object({
        width: z.number(),
        height: z.number(),
        devicePixelRatio: z.number().optional(),
    }).optional().describe('Viewport dimensions for scoring (defaults: 1280x800@1x)'),
}, 
// annotations: readOnlyHint=true, destructiveHint=false, idempotentHint=true
{ readOnlyHint: true, destructiveHint: false, idempotentHint: true }, async ({ sessionId, viewport }) => {
    return wrapHandler(() => handleAnalyze({ sessionId, viewport }, ctx), 'spectra_analyze');
});
server.tool('spectra_discover', 'Auto-navigate and capture an entire app — discovers screens via BFS crawl, scores elements, detects UI states, and produces framed screenshots', {
    sessionId: z.string().describe('Active session ID'),
    maxDepth: z.number().optional().describe('Max navigation depth (default: 3)'),
    maxScreens: z.number().optional().describe('Max screens to discover (default: 50)'),
    captureStates: z.boolean().optional().describe('Capture loading/error/empty states (default: false)'),
    clean: z.boolean().optional().describe('Apply visual cleanup before capture (default: true)'),
    outputDir: z.string().optional().describe('Custom output directory'),
}, 
// annotations: readOnlyHint=false, destructiveHint=false, idempotentHint=false
{ readOnlyHint: false, destructiveHint: false, idempotentHint: false }, async ({ sessionId, maxDepth, maxScreens, captureStates, clean, outputDir }) => {
    return wrapHandler(() => handleDiscover({ sessionId, maxDepth, maxScreens, captureStates, clean, outputDir }, ctx), 'spectra_discover');
});
server.tool('spectra_walkthrough', 'Execute a multi-step UI flow with optional screenshot capture at each step. Reduces tool calls from 2N to 1 for N-step walkthroughs.', {
    sessionId: z.string().describe('Active session ID'),
    steps: z.array(z.object({
        intent: z.string().describe('What to do, e.g., "click the Login button"'),
        capture: z.boolean().optional().describe('Take screenshot after this step (default: true)'),
        waitMs: z.number().optional().describe('Wait ms after action before capture (default: 500)'),
    })).describe('Steps to execute in order'),
    clean: z.boolean().optional().describe('Apply visual cleanup for screenshots (default: true)'),
}, 
// annotations: readOnlyHint=false, destructiveHint=true, idempotentHint=false
{ readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async ({ sessionId, steps, clean }) => {
    return wrapHandler(() => handleWalkthrough({ sessionId, steps, clean }, ctx), 'spectra_walkthrough');
});
server.tool('spectra_session', 'List, get, close, or close all sessions.', {
    action: z.enum(['list', 'get', 'close', 'close_all']),
    sessionId: z.string().optional(),
}, 
// annotations: worst-case for mixed read/write — destructiveHint=true (close/close_all are destructive)
{ readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async ({ action, sessionId }) => {
    return wrapHandler(() => handleSession({ action, sessionId }, ctx), 'spectra_session');
});
server.tool('spectra_record', 'Record a terminal command session (stdout/stderr with timestamps) in asciicast format', {
    command: z.string().describe('Command to record'),
    timeout: z.number().optional().describe('Max duration in ms (default 300000)'),
    watch_files: z.array(z.string()).optional().describe('File paths to watch for changes during recording'),
    outputDir: z.string().optional().describe('Directory to write .cast file (default: .spectra/recordings/)'),
}, { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, async ({ command, timeout, watch_files, outputDir }) => {
    return wrapHandler(() => handleRecord({ command, timeout, watch_files, outputDir }), 'spectra_record');
});
server.tool('spectra_replay', 'Read, search, or summarize a terminal recording (.cast file)', {
    file: z.string().describe('Path to .cast file'),
    search: z.string().optional().describe('Search pattern (regex or string)'),
    commands_only: z.boolean().optional().describe('Extract only input commands'),
}, { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, async ({ file, search, commands_only }) => {
    return wrapHandler(() => handleReplay({ file, search, commands_only }), 'spectra_replay');
});
server.tool('spectra_library', 'Manage the spectra capture library (tag, find, gallery, export, status, delete, add, migrate-from-showcase). Action-dispatched like spectra_session.', {
    action: z
        .enum(['add', 'find', 'gallery', 'get', 'tag', 'delete', 'status', 'export', 'migrate-from-showcase'])
        .describe('Library operation to perform'),
    // add
    sourcePath: z.string().optional().describe('add: path to a media file to import'),
    type: z.enum(['screenshot', 'video', 'walkthrough']).optional(),
    platform: z.enum(['web', 'macos', 'ios', 'watchos', 'unknown']).optional(),
    url: z.string().optional(),
    viewport: z.string().optional(),
    selector: z.string().optional(),
    deviceName: z.string().optional(),
    title: z.string().optional(),
    feature: z.string().optional().describe('Canonical feature slug (kebab-case) used for grouping'),
    component: z.string().optional(),
    tags: z.array(z.string()).optional(),
    starred: z.boolean().optional(),
    walkthrough: z
        .object({ step_count: z.number(), steps: z.array(z.string()) })
        .optional(),
    durationMs: z.number().optional(),
    gitBranch: z.string().optional(),
    gitCommit: z.string().optional(),
    // find / export
    tagsAny: z.array(z.string()).optional(),
    tagsAll: z.array(z.string()).optional(),
    since: z.string().optional().describe('ISO date — only include captures on or after'),
    until: z.string().optional(),
    text: z.string().optional().describe('Free-text search over title / tags / feature / component'),
    limit: z.number().optional(),
    // gallery
    groupBy: z.enum(['feature', 'date', 'component', 'platform', 'type']).optional(),
    // get / tag / delete
    id: z.string().optional(),
    // export
    outDir: z.string().optional(),
    flatten: z.boolean().optional(),
    manifest: z.boolean().optional(),
    // migrate
    showcasePath: z.string().optional().describe('Path to a legacy .showcase/ directory'),
}, { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async (params) => {
    return wrapHandler(() => handleLibrary(params), 'spectra_library');
});
server.prompt('walkthrough', 'Walk through a UI flow and capture screenshots at each step', {
    url: z.string().describe('URL to connect to'),
    steps: z.string().describe('Comma-separated steps, e.g., "click Login, enter email test@example.com, click Submit"'),
}, ({ url, steps }) => ({
    messages: [{
            role: 'user',
            content: {
                type: 'text',
                text: `Connect to ${url} using spectra_connect, then use spectra_walkthrough to execute these steps in order: ${steps}. Capture a screenshot after each step.`,
            },
        }],
}));
server.prompt('capture-feature', 'Capture screenshots of a specific feature from multiple angles', {
    url: z.string().describe('URL to connect to'),
    feature: z.string().describe('Feature to capture, e.g., "dashboard", "settings page"'),
}, ({ url, feature }) => ({
    messages: [{
            role: 'user',
            content: {
                type: 'text',
                text: `Connect to ${url} using spectra_connect. Use spectra_analyze to find regions of interest. Navigate to the ${feature} and capture it using spectra_capture with mode=auto. Also capture with mode=region for each detected region. Save all captures.`,
            },
        }],
}));
server.prompt('full-audit', 'Discover and capture all screens in an app', {
    url: z.string().describe('URL to connect to'),
}, ({ url }) => ({
    messages: [{
            role: 'user',
            content: {
                type: 'text',
                text: `Connect to ${url} using spectra_connect, then use spectra_discover to auto-navigate the entire app. Set maxDepth=3 and captureStates=true to capture loading, error, and empty states as well. Report the manifest path and a summary of what was found.`,
            },
        }],
}));
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch(console.error);
//# sourceMappingURL=server.js.map