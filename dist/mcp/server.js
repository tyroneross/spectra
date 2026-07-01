// src/mcp/server.ts
//
// CORELESS stdio MCP proxy. This server holds NO core and imports NO core
// modules (no createContext, no tool handlers, no drivers). Every tool call is
// mapped to a frozen-contract operation and forwarded to the GUI-session daemon
// over the unix socket via DaemonClient. On daemon-down the client health-
// probes, auto-bootstraps, and returns an ACTIONABLE error — never a raw
// CGS_REQUIRE_INIT or bare socket error.
//
// The tool registrations (names, descriptions, input schemas, annotations) are
// the public MCP surface and are preserved exactly; only the handler bodies
// changed from in-process calls to daemon forwards.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getVersionInfo } from './version.js';
import { registerResources } from './resources.js';
import { forwardTool, ToolMappingError } from './forward.js';
import { DaemonClient } from '../client/daemon-client.js';
import { DaemonError } from '../client/daemon-client.js';
import { spawnDaemonBootstrap } from '../client/bootstrap.js';
/** Format any forwarding error as an actionable MCP error payload. */
function formatError(err, toolName) {
    if (err instanceof DaemonError) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: err.code, hint: err.hint, retryable: err.retryable, tool: toolName, timestamp: Date.now() }, null, 2) }],
            isError: true,
        };
    }
    if (err instanceof ToolMappingError) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: 'bad_request', tool: toolName, timestamp: Date.now() }, null, 2) }],
            isError: true,
        };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
        content: [{ type: 'text', text: JSON.stringify({ error: message, tool: toolName, timestamp: Date.now() }, null, 2) }],
        isError: true,
    };
}
/** Forward a tool call and wrap the result as MCP text content. */
async function forward(client, toolName, args) {
    try {
        const result = await forwardTool(client, toolName, args);
        return { content: [{ type: 'text', text: JSON.stringify({ ...Object(result), timestamp: Date.now() }, null, 2) }] };
    }
    catch (err) {
        return formatError(err, toolName);
    }
}
// ─── spectra_demo: polish-clip / polish-script wire shapes ─────────────────
// Mirrors src/contract/schemas.ts (demoClicksJsonSchema / demoScriptSchema /
// demoSpotlightSchema) so the MCP boundary accepts the same payload shapes
// the rich polish pipeline (src/pipeline/polish.ts) expects. This is the
// PUBLIC MCP input gate — the SDK rejects anything not described here before
// forward()/handleDemo ever run, so these must stay in lockstep with
// contract/schemas.ts and pipeline/polish.ts's option types.
const demoZoomClickShape = z.object({ tMs: z.number(), cx: z.number(), cy: z.number() });
const demoCursorPointShape = z.object({ tMs: z.number(), cx: z.number(), cy: z.number() });
const demoClicksJsonShape = z.union([
    z.string(),
    z.array(demoZoomClickShape),
    z.object({
        clicks: z.array(demoZoomClickShape).optional(),
        cursorPath: z.array(demoCursorPointShape).optional(),
    }),
]);
const demoScriptBeatActionShape = z.object({
    kind: z.enum(['search', 'click', 'scroll', 'navigate', 'hold']),
    target: z.string().optional(),
    value: z.string().optional(),
});
const demoScriptBeatShape = z.object({
    id: z.string(),
    stepLabel: z.string().optional(),
    stepText: z.string().optional(),
    startMs: z.number(),
    endMs: z.number(),
    zoom: z.object({ cx: z.number(), cy: z.number(), scale: z.number() }).optional(),
    action: demoScriptBeatActionShape.optional(),
});
const demoScriptShape = z.object({
    title: z.string().optional(),
    finalCaption: z.string().optional(),
    beats: z.array(demoScriptBeatShape),
});
const demoSpotlightFocalShape = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const demoSpotlightObjectShape = z.object({
    focal: demoSpotlightFocalShape,
    dim: z.number().optional(),
    blur: z.number().optional(),
    feather: z.number().optional(),
});
/**
 * Flat ZodRawShape for the `spectra_demo` tool input — exported (rather than
 * inlined into the `server.tool(...)` call) so tests can validate the EXACT
 * shape the MCP SDK enforces at the public boundary, instead of only
 * exercising the daemon-side handleDemo handler (which a prior pass did,
 * masking the fact that the SDK rejected polish-clip/polish-script before
 * forward() ever ran). Keep this a flat object of zod fields (not a
 * discriminatedUnion) — that's what server.tool()'s SDK signature requires.
 */
export const spectraDemoInputShape = {
    action: z.enum(['scan', 'polish', 'auto-ramp', 'record-composite', 'polish-clip', 'polish-script', 'run-script']).describe('scan: find active stretches | polish: render spotlight segments and merge | auto-ramp: auto-speed dead air, keep motion 1x | record-composite: window-isolated two-pane recording driven directly via MCP | polish-clip: render the rich pipeline (zoom, window chrome, caption banner + numbered step chips, optional spotlight) from a clicks/cursor track | polish-script: render the rich pipeline from a structured beat script | run-script: execute a DemoScript beat-by-beat live against an already-open CDP page target (search/click/scroll/navigate), no rendering'),
    input: z.string().optional().describe('scan/auto-ramp/polish-clip/polish-script: path to the source video file'),
    threshold: z.number().optional().describe('scan/auto-ramp: scene-change sensitivity (default: 0.04)'),
    deadSpeed: z.number().optional().describe('auto-ramp: speed multiplier for dead-air spans (default 1.8)'),
    minDeadSec: z.number().optional().describe('auto-ramp: min gap length to ramp, seconds (default 1.5)'),
    maxWidth: z.number().optional().describe('auto-ramp: lanczos-downscale max width (default 1600)'),
    crf: z.number().optional().describe('auto-ramp: x264 quality (default 20)'),
    fps: z.number().optional().describe('auto-ramp: output fps (default 60) | polish-clip/polish-script: output fps (default 60)'),
    spec: z.object({
        canvas: z.object({ w: z.number(), h: z.number() }).describe('Output canvas dimensions (pixels)'),
        fps: z.number().optional().describe('Target frame rate (informational)'),
        segments: z.array(z.object({
            input: z.string().describe('Path to the source recording for this segment'),
            startSec: z.number().describe('Start offset in seconds'),
            durationSec: z.number().describe('Segment duration in seconds'),
            focal: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).describe('Focal region in source pixels'),
            caption: z.string().optional().describe('Lower-third caption text'),
            captionPngPath: z.string().optional().describe('PNG overlay fallback when drawtext is unavailable'),
        })).describe('Ordered segments to render and merge'),
        speed: z.number().optional().describe('Speed multiplier applied to all segments (e.g. 1.5 = 50% faster)'),
    }).optional().describe('polish: segment specification'),
    out: z.string().optional().describe('polish/auto-ramp/polish-clip/polish-script: output mp4 path'),
    appA: z.string().optional().describe('record-composite: app name / bundle substring for the LEFT pane'),
    titleA: z.string().optional().describe('record-composite: optional window-title substring for the left pane'),
    labelA: z.string().optional().describe('record-composite: optional label for the left pane'),
    appB: z.string().optional().describe('record-composite: app name / bundle substring for the RIGHT pane'),
    titleB: z.string().optional().describe('record-composite: optional window-title substring for the right pane'),
    labelB: z.string().optional().describe('record-composite: optional label for the right pane'),
    durationSeconds: z.number().optional().describe('record-composite: capture duration in seconds (default 5)'),
    caption: z.string().optional().describe('record-composite: optional lower-third caption strip text | polish-clip: optional caption banner text'),
    spotlight: z.union([
        z.enum(['none', 'a', 'b']),
        demoSpotlightObjectShape,
    ]).optional().describe('record-composite: dim+blur the non-focal pane — none | a (left) | b (right), default none || polish-clip: whole-clip dark-crush spotlight pre-pass — {focal:{x,y,w,h}, dim?, blur?, feather?}'),
    cursor: z.boolean().optional().describe('record-composite: composite a smoothed cursor sprite (default true)'),
    outPath: z.string().optional().describe('record-composite: composite MP4 output path'),
    sessionId: z.string().optional().describe('record-composite: optional session to register the artifact against'),
    async: z.boolean().optional().describe('record-composite: return a recordingId immediately and finish via recording.status/artifact.added events'),
    clicksJson: demoClicksJsonShape.optional().describe('polish-clip: click/cursor track driving the zoom — JSON string, inline array of {tMs,cx,cy}, or {clicks?,cursorPath?} object'),
    script: demoScriptShape.optional().describe('polish-script/run-script: structured beat script — {title?, finalCaption?, beats:[{id,startMs,endMs,stepLabel?,stepText?,zoom?,action?}]}'),
    voiceover: z.string().optional().describe('polish-script: path to a voiceover/narration audio file — REPLACES input audio, starts at t=0, padded/trimmed to the video duration (short VO never truncates the video; long VO is cut to video length)'),
    cdpUrl: z.string().optional().describe('run-script: WebSocket debugger URL of an already-open CDP page target to drive the script against'),
};
// ─── spectra_computer_use: AX-first, focused-window computer use ───────────
// Exported (like spectraDemoInputShape) so tests validate the EXACT shape the
// MCP SDK enforces at the public boundary. Deliberately lenient (the daemon's
// computerUseParamsSchema is the strict gate) but structured enough that the SDK
// accepts snapshot/act/fill-form before forward() runs. Keep it a flat object.
export const spectraComputerUseInputShape = {
    action: z.enum(['snapshot', 'act', 'fill-form']).describe('snapshot: scoped AX tree of the focused window | act: run one action (click/set-value/key) | fill-form: resolve a {label:value} map, set + verify each field'),
    app: z.string().optional().describe('Target app name substring. Omit (with pid) to target the FOCUSED/frontmost app.'),
    pid: z.number().optional().describe('Target process id. Takes precedence over app.'),
    threshold: z.number().optional().describe('snapshot: min AX node-count before the vision fallback is signalled (default 1)'),
    op: z.object({
        kind: z.enum(['click', 'set-value', 'key']),
        role: z.string().optional().describe('click: optional AX role filter (e.g. AXButton)'),
        label: z.string().optional().describe('click/set-value: the element label to resolve against the AX tree'),
        value: z.string().optional().describe('set-value: the value to set (verified by read-back)'),
        key: z.string().optional().describe('key: one of return|tab|space|delete|escape|left|right|up|down'),
    }).optional().describe('act: the single action to perform'),
    fields: z.record(z.string()).optional().describe('fill-form: {fieldLabel: value} map resolved against editable AX nodes'),
};
/**
 * Build a coreless Spectra MCP server bound to the given daemon client. The
 * client is injectable so tests can point it at a mock daemon.
 */
export function createSpectraServer(client) {
    const server = new McpServer({ name: 'spectra', version: getVersionInfo().daemonVersion });
    registerResources(server, client);
    server.tool('spectra_connect', 'Start a new UI automation session. Target: URL (web), app name (macOS), sim:device (iOS/watchOS). If repoPath is set, the launcher first boots a dev server / macOS app from that directory and uses its resolved URL/app-name as the effective target.', {
        target: z.string().describe('URL, app name, or sim:device identifier. Ignored if repoPath is set and the launcher resolves a target.'),
        name: z.string().optional().describe('Human-readable session name'),
        record: z.boolean().optional().describe('Start video recording'),
        repoPath: z.string().optional().describe('Absolute path to a repo to launch first (Next.js / Vite / static HTML / macOS Xcode project).'),
    }, { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, async (args) => forward(client, 'spectra_connect', args));
    server.tool('spectra_snapshot', 'Get current AX tree snapshot of the active session.', {
        sessionId: z.string().describe('Session ID'),
        screenshot: z.boolean().optional().describe('Include screenshot'),
    }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, async (args) => forward(client, 'spectra_snapshot', args));
    server.tool('spectra_act', 'Perform an action on an element (click, type, clear, scroll, hover, focus).', {
        sessionId: z.string(),
        elementId: z.string().describe('Element ID from snapshot (e.g., "e4")'),
        action: z.enum(['click', 'type', 'clear', 'select', 'scroll', 'hover', 'focus']),
        value: z.string().optional().describe('Text to type or scroll amount'),
    }, { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async (args) => forward(client, 'spectra_act', args));
    server.tool('spectra_step', 'Natural language step: describe what to do, Spectra finds the element and optionally executes.', {
        sessionId: z.string(),
        intent: z.string().describe('What to do, e.g., "click the Log In button"'),
    }, { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async (args) => {
        // step returns mixed content (text + optional image); preserve that.
        try {
            const result = (await forwardTool(client, 'spectra_step', args));
            const { screenshot, ...textResult } = result;
            const content = [
                { type: 'text', text: JSON.stringify({ ...textResult, timestamp: Date.now() }, null, 2) },
            ];
            if (typeof screenshot === 'string' && screenshot.length > 0) {
                content.push({ type: 'image', data: screenshot, mimeType: 'image/png' });
            }
            return { content };
        }
        catch (err) {
            return formatError(err, 'spectra_step');
        }
    });
    server.tool('spectra_capture', 'Capture screenshot or manage video recording. Supports intelligent framing modes: full, element, region, auto.', {
        sessionId: z.string(),
        type: z.enum(['screenshot', 'start_recording', 'stop_recording']),
        preset: z.enum(['docs', 'demo', 'social', 'app-store']).optional().describe('Production capture preset'),
        mode: z.enum(['full', 'element', 'region', 'auto']).optional().describe('Capture mode (default: full)'),
        elementId: z.string().optional().describe('Element ID for mode=element'),
        region: z.string().optional().describe('Region label for mode=region (e.g., "Navigation", "Form")'),
        aspectRatio: z.string().optional().describe('Output aspect ratio e.g. "16:9", "4:3", "1:1"'),
        clean: z.boolean().optional().describe('Apply visual cleanup before capture (default: true)'),
        quality: z.enum(['lossless', 'high', 'medium']).optional().describe('Output quality'),
        fps: z.union([z.literal(30), z.literal(60)]).optional().describe('Recording frame rate'),
        codec: z.enum(['h264', 'hevc']).optional().describe('Recording codec'),
        bitrate: z.enum(['4M', '8M']).optional().describe('Recording bitrate'),
        hardware: z.boolean().optional().describe('Use hardware encoding when available'),
        captureCursor: z.boolean().optional().describe('Record cursor telemetry beside a single-window recording'),
        composite: z.object({
            enabled: z.boolean().optional(),
            displayWidth: z.number().optional(),
            displayHeight: z.number().optional(),
            left: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
            right: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
        }).optional().describe('Side-by-side composite recording (start_recording): split the full-display capture into left/right panes and hstack them. Omit rects/dims for an auto equal-halves split.'),
    }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, async (args) => forward(client, 'spectra_capture', args));
    server.tool('spectra_analyze', 'Score the current screen and identify regions of interest, UI state, and top elements by importance', {
        sessionId: z.string().describe('Active session ID'),
        viewport: z.object({
            width: z.number(),
            height: z.number(),
            devicePixelRatio: z.number().optional(),
        }).optional().describe('Viewport dimensions for scoring (defaults: 1280x800@1x)'),
    }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, async (args) => forward(client, 'spectra_analyze', args));
    server.tool('spectra_discover', 'Auto-navigate and capture an entire app — discovers screens via BFS crawl, scores elements, detects UI states, and produces framed screenshots', {
        sessionId: z.string().describe('Active session ID'),
        maxDepth: z.number().optional().describe('Max navigation depth (default: 3)'),
        maxScreens: z.number().optional().describe('Max screens to discover (default: 50)'),
        captureStates: z.boolean().optional().describe('Capture loading/error/empty states (default: false)'),
        clean: z.boolean().optional().describe('Apply visual cleanup before capture (default: true)'),
        outputDir: z.string().optional().describe('Custom output directory'),
    }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, async (args) => forward(client, 'spectra_discover', args));
    server.tool('spectra_walkthrough', 'Execute a multi-step UI flow with optional screenshot capture at each step. Reduces tool calls from 2N to 1 for N-step walkthroughs.', {
        sessionId: z.string().describe('Active session ID'),
        steps: z.array(z.object({
            intent: z.string().describe('What to do, e.g., "click the Login button"'),
            capture: z.boolean().optional().describe('Take screenshot after this step (default: true)'),
            waitMs: z.number().optional().describe('Wait ms after action before capture (default: 500)'),
        })).describe('Steps to execute in order'),
        clean: z.boolean().optional().describe('Apply visual cleanup for screenshots (default: true)'),
    }, { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async (args) => forward(client, 'spectra_walkthrough', args));
    server.tool('spectra_llm_step', 'Execute a fully-formed action plan from a client-side LLM planner (the Spectra menu-bar app holds the API key; the daemon never sees it). Each action is { type, elementId, value?, intent?, waitAfterMs? }. Short-circuits on first failure unless continueOnError=true.', {
        sessionId: z.string().describe('Active session ID'),
        actions: z.array(z.object({
            type: z.enum(['click', 'type', 'clear', 'select', 'scroll', 'hover', 'focus']),
            elementId: z.string(),
            value: z.string().optional(),
            intent: z.string().optional(),
            waitAfterMs: z.number().optional(),
        })).describe('Action plan to execute in order'),
        continueOnError: z.boolean().optional().describe('Continue past a failing step (default: false)'),
    }, { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async (args) => forward(client, 'spectra_llm_step', args));
    server.tool('spectra_session', 'List, get, inspect run manifests, close, close all sessions, or record LLM token usage against a session.', {
        action: z.enum(['list', 'get', 'run', 'close', 'close_all', 'record_llm_usage']),
        sessionId: z.string().optional(),
        usage: z.unknown().optional().describe('For action=record_llm_usage: token usage payload to append to llm-usage.json.'),
    }, { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async (args) => forward(client, 'spectra_session', args));
    server.tool('spectra_record', 'Record a terminal command session (stdout/stderr with timestamps) in asciicast format', {
        command: z.string().describe('Command to record'),
        timeout: z.number().optional().describe('Max duration in ms (default 300000)'),
        watch_files: z.array(z.string()).optional().describe('File paths to watch for changes during recording'),
        outputDir: z.string().optional().describe('Directory to write .cast file (default: .spectra/recordings/)'),
    }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, async (args) => forward(client, 'spectra_record', args));
    server.tool('spectra_replay', 'Read, search, or summarize a terminal recording (.cast file)', {
        file: z.string().describe('Path to .cast file'),
        search: z.string().optional().describe('Search pattern (regex or string)'),
        commands_only: z.boolean().optional().describe('Extract only input commands'),
    }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, async (args) => forward(client, 'spectra_replay', args));
    server.tool('spectra_library', 'Manage the spectra capture library (tag, find, gallery, export, status, delete, add, migrate-from-showcase). Action-dispatched like spectra_session.', {
        action: z
            .enum(['add', 'find', 'gallery', 'get', 'tag', 'delete', 'status', 'export', 'migrate-from-showcase'])
            .describe('Library operation to perform'),
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
        tagsAny: z.array(z.string()).optional(),
        tagsAll: z.array(z.string()).optional(),
        since: z.string().optional().describe('ISO date — only include captures on or after'),
        until: z.string().optional(),
        text: z.string().optional().describe('Free-text search over title / tags / feature / component'),
        limit: z.number().optional(),
        groupBy: z.enum(['feature', 'date', 'component', 'platform', 'type']).optional(),
        id: z.string().optional(),
        outDir: z.string().optional(),
        flatten: z.boolean().optional(),
        manifest: z.boolean().optional(),
        showcasePath: z.string().optional().describe('Path to a legacy .showcase/ directory'),
    }, { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async (args) => forward(client, 'spectra_library', args));
    server.tool('spectra_demo', 'Produce polished agent demo video clips from screen recordings. Use action=scan to find active stretches via scene-change detection, action=polish to apply spotlight focus, captions, and speed to a set of segments and merge them, action=auto-ramp to automatically speed dead-air spans while keeping motion at real cadence, action=record-composite to drive the WINDOW-ISOLATED composite recorder (two app windows side-by-side via ScreenCaptureKit, caffeinate-wrapped so the display never sleeps, with a post-capture black-frame guard), or action=polish-clip / action=polish-script to render the rich pipeline (zoom, window chrome, caption banner + numbered step chips, optional dark-crush spotlight) from a click track or a structured beat script. Audio is preserved when the source has an audio track; stripped otherwise.', spectraDemoInputShape, { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, async (args) => forward(client, 'spectra_demo', args));
    server.tool('spectra_computer_use', 'AX-first, focused-window macOS computer use. action=snapshot returns the scoped Accessibility tree of the focused window (semantic role/label, ~30-80ms, no screenshot); action=act runs one action (click-by-role-label, set-value, or key) against a resolved AX node; action=fill-form resolves a {label:value} map against editable AX nodes, sets each via AX, and VERIFIES each by read-back. Omit app/pid to target the frontmost app. Drives via the Accessibility API (not coordinate clicks); when the AX tree is empty/thin it returns a needsVisionFallback signal instead of failing.', spectraComputerUseInputShape, { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async (args) => forward(client, 'spectra_computer_use', args));
    // ─── Prompts (unchanged) ───────────────────────────────────
    server.prompt('walkthrough', 'Walk through a UI flow and capture screenshots at each step', {
        url: z.string().describe('URL to connect to'),
        steps: z.string().describe('Comma-separated steps, e.g., "click Login, enter email test@example.com, click Submit"'),
    }, ({ url, steps }) => ({
        messages: [{
                role: 'user',
                content: { type: 'text', text: `Connect to ${url} using spectra_connect, then use spectra_walkthrough to execute these steps in order: ${steps}. Capture a screenshot after each step.` },
            }],
    }));
    server.prompt('capture-feature', 'Capture screenshots of a specific feature from multiple angles', {
        url: z.string().describe('URL to connect to'),
        feature: z.string().describe('Feature to capture, e.g., "dashboard", "settings page"'),
    }, ({ url, feature }) => ({
        messages: [{
                role: 'user',
                content: { type: 'text', text: `Connect to ${url} using spectra_connect. Use spectra_analyze to find regions of interest. Navigate to the ${feature} and capture it using spectra_capture with mode=auto. Also capture with mode=region for each detected region. Save all captures.` },
            }],
    }));
    server.prompt('full-audit', 'Discover and capture all screens in an app', {
        url: z.string().describe('URL to connect to'),
    }, ({ url }) => ({
        messages: [{
                role: 'user',
                content: { type: 'text', text: `Connect to ${url} using spectra_connect, then use spectra_discover to auto-navigate the entire app. Set maxDepth=3 and captureStates=true to capture loading, error, and empty states as well. Report the manifest path and a summary of what was found.` },
            }],
    }));
    return server;
}
/** Build a stdio client whose auto-bootstrap polls a separate probe client on
 * the same socket (avoids a self-referential bootstrap). */
function buildStdioClient() {
    const probe = new DaemonClient({ surface: 'stdio-mcp', callerName: 'spectra-stdio' });
    return new DaemonClient({
        surface: 'stdio-mcp',
        callerName: 'spectra-stdio',
        bootstrap: spawnDaemonBootstrap(probe),
    });
}
/** Default stdio entry — the path Claude Code spawns (coreless daemon proxy). */
export async function startStdio() {
    const server = createSpectraServer(buildStdioClient());
    await server.connect(new StdioServerTransport());
}
// Run stdio if this file is the entry point (preserves the
// `node dist/mcp/server.js` invocation from .claude-plugin/plugin.json).
const isEntry = import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(process.argv[1] ?? '');
if (isEntry) {
    startStdio().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=server.js.map