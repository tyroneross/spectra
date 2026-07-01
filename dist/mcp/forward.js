// src/mcp/forward.ts
//
// Pure tool → CoreApi-operation mapping for the coreless stdio MCP proxy. The
// stdio server holds NO core; every tool call is mapped here to a frozen-
// contract operation + params and forwarded to the daemon via DaemonClient.
//
// Keeping the mapping pure (no MCP transport, no I/O) makes the forwarding
// surface fully unit-testable against the mock daemon — the daemon path is
// exercised on every `npm test` (anti-dormancy, per the aligned plan §3.4).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>
/** Thrown when a tool's dispatch field (type/action) is unrecognized. */
export class ToolMappingError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolMappingError';
    }
}
/**
 * Map an MCP tool name + raw arguments to a single CoreApi operation call.
 * Dispatched tools (spectra_capture, spectra_session, spectra_demo) resolve the
 * operation from their `type` / `action` field.
 */
export function mapToolCall(toolName, args = {}) {
    switch (toolName) {
        case 'spectra_connect':
            return op('createSession', pick(args, ['target', 'name', 'record', 'repoPath']));
        case 'spectra_snapshot':
            return op('snapshot', pick(args, ['sessionId', 'screenshot']));
        case 'spectra_act':
            return op('act', pick(args, ['sessionId', 'elementId', 'action', 'value']));
        case 'spectra_step':
            return op('step', pick(args, ['sessionId', 'intent']));
        case 'spectra_analyze':
            return op('analyze', pick(args, ['sessionId', 'viewport']));
        case 'spectra_discover':
            return op('discover', pick(args, ['sessionId', 'maxDepth', 'maxScreens', 'captureStates', 'clean', 'outputDir']));
        case 'spectra_walkthrough':
            return op('walkthrough', pick(args, ['sessionId', 'steps', 'clean']));
        case 'spectra_llm_step':
            return op('llmStep', pick(args, ['sessionId', 'actions', 'continueOnError']));
        case 'spectra_record':
            return op('recordTerminal', pick(args, ['command', 'timeout', 'watch_files', 'outputDir']));
        case 'spectra_replay':
            return op('replayTerminal', pick(args, ['file', 'search', 'commands_only']));
        case 'spectra_library':
            // Action-discriminated union — forward args verbatim.
            return op('library', { ...args });
        case 'spectra_capture':
            return mapCapture(args);
        case 'spectra_session':
            return mapSession(args);
        case 'spectra_demo':
            return mapDemo(args);
        default:
            throw new ToolMappingError(`Unknown spectra tool: ${toolName}`);
    }
}
function mapCapture(args) {
    const type = args.type;
    switch (type) {
        case 'screenshot':
            return op('screenshot', pick(args, ['sessionId', 'preset', 'mode', 'elementId', 'region', 'aspectRatio', 'clean', 'quality']));
        case 'start_recording':
            return op('startRecording', pick(args, ['sessionId', 'preset', 'fps', 'codec', 'bitrate', 'hardware', 'captureCursor', 'composite']));
        case 'stop_recording':
            return op('stopRecording', pick(args, ['sessionId', 'preset']));
        default:
            throw new ToolMappingError(`spectra_capture: unknown type "${String(type)}" (expected screenshot | start_recording | stop_recording)`);
    }
}
function mapSession(args) {
    const action = args.action;
    switch (action) {
        case 'list':
            return op('listSessions', pick(args, ['includeClosed']));
        case 'get':
            return op('getSession', pick(args, ['sessionId']));
        case 'run':
            return op('getRun', pick(args, ['sessionId']));
        case 'close':
            return op('closeSession', pick(args, ['sessionId']));
        case 'close_all':
            return op('closeAllSessions', undefined);
        case 'record_llm_usage':
            return op('recordLlmUsage', pick(args, ['sessionId', 'usage']));
        default:
            throw new ToolMappingError(`spectra_session: unknown action "${String(action)}"`);
    }
}
function mapDemo(args) {
    const action = args.action;
    const knownActions = ['scan', 'polish', 'auto-ramp', 'record-composite', 'polish-clip', 'polish-script', 'run-script'];
    if (typeof action !== 'string' || !knownActions.includes(action)) {
        throw new ToolMappingError(`spectra_demo: unknown action "${String(action)}"`);
    }
    // demo() is action-discriminated in the contract — forward args verbatim.
    return op('demo', { ...args });
}
function op(operation, params) {
    return { operation, params };
}
function pick(args, keys) {
    const out = {};
    for (const k of keys) {
        if (args[k] !== undefined)
            out[k] = args[k];
    }
    return out;
}
/**
 * Map + forward a tool call to the daemon. Returns the raw operation result.
 * DaemonError (actionable) propagates to the caller's error formatter.
 */
export async function forwardTool(client, toolName, args = {}) {
    const { operation, params } = mapToolCall(toolName, args);
    return client.call(operation, params);
}
//# sourceMappingURL=forward.js.map