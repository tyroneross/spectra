// src/contract/schemas.ts
//
// Zod I/O schemas for the daemon contract. These validate the operation params
// that every adapter (stdio MCP, CLI, menu-bar, slash command) sends to the
// daemon, plus the wire envelopes the daemon client parses back.
//
// apiVersion single-source: codex reconciled API_VERSION to live once in
// `wire.ts` (seq 596). This file IMPORTS it rather than redefining it, so there
// is still exactly one literal `2` in the contract. The compile-time
// exhaustiveness guards at the bottom make wire.ts type changes (new operation,
// event, error code, capability, surface) fail typecheck until the runtime
// mirrors + frozen snapshot are updated.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>
import { z } from 'zod';
import { API_VERSION, eventsRoute, mcpRoute, operationCapabilities, primarySocketMode, primarySocketPath, } from './wire.js';
// Re-export the single source so FE consumers can import apiVersion from the
// schema module without reaching into the wire layer.
export { API_VERSION };
export const apiVersion = API_VERSION;
// ─── Shared scalar schemas ─────────────────────────────────────
export const jsonValueSchema = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
]));
export const platformSchema = z.enum(['web', 'macos', 'ios', 'watchos', 'terminal']);
export const libraryPlatformSchema = z.enum(['web', 'macos', 'ios', 'watchos', 'terminal', 'unknown']);
export const captureModeSchema = z.enum(['full', 'element', 'region', 'auto']);
export const capturePresetSchema = z.enum(['docs', 'demo', 'social', 'app-store']);
export const captureQualitySchema = z.enum(['lossless', 'high', 'medium']);
export const videoCodecSchema = z.enum(['h264', 'hevc']);
export const videoBitrateSchema = z.enum(['4M', '8M']);
export const recordingFpsSchema = z.union([z.literal(30), z.literal(60)]);
export const actionTypeSchema = z.enum(['click', 'type', 'clear', 'select', 'scroll', 'hover', 'focus']);
export const permissionKindSchema = z.enum(['accessibility', 'screen-recording', 'automation', 'developer-tools']);
export const compositeSpotlightSchema = z.enum(['none', 'a', 'b']);
export const libraryCaptureTypeSchema = z.enum(['screenshot', 'video', 'walkthrough']);
export const libraryGroupBySchema = z.enum(['feature', 'date', 'component', 'platform', 'type']);
export const viewportSchema = z.object({
    width: z.number(),
    height: z.number(),
    devicePixelRatio: z.number().optional(),
});
export const recordingCompositePaneSchema = z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
});
export const recordingCompositeOptionsSchema = z.object({
    enabled: z.boolean().optional(),
    displayWidth: z.number().optional(),
    displayHeight: z.number().optional(),
    left: recordingCompositePaneSchema.optional(),
    right: recordingCompositePaneSchema.optional(),
});
export const actionPlanStepSchema = z.object({
    type: actionTypeSchema,
    elementId: z.string(),
    value: z.string().optional(),
    intent: z.string().optional(),
    waitAfterMs: z.number().optional(),
});
// ─── Operation param schemas (one per CoreApi operation) ───────
export const healthParamsSchema = z.object({
    includePermissions: z.boolean().optional(),
});
export const getPermissionsParamsSchema = z.object({
    permissions: z.array(permissionKindSchema).optional(),
});
export const requestPermissionsParamsSchema = z.object({
    permissions: z.array(permissionKindSchema),
    prompt: z.boolean().optional(),
    openSettings: z.boolean().optional(),
});
export const listWindowsParamsSchema = z.object({
    app: z.string().optional(),
    title: z.string().optional(),
    onScreenOnly: z.boolean().optional(),
});
export const createSessionParamsSchema = z.object({
    target: z.string(),
    name: z.string().optional(),
    record: z.boolean().optional(),
    repoPath: z.string().optional(),
});
export const listSessionsParamsSchema = z.object({
    includeClosed: z.boolean().optional(),
});
export const sessionByIdParamsSchema = z.object({
    sessionId: z.string(),
});
export const recordLlmUsageParamsSchema = z.object({
    sessionId: z.string(),
    usage: jsonValueSchema,
});
export const snapshotParamsSchema = z.object({
    sessionId: z.string(),
    screenshot: z.boolean().optional(),
});
export const observeParamsSchema = z.object({
    sessionId: z.string(),
    screenshot: z.boolean().optional(),
    analyze: z.boolean().optional(),
    viewport: viewportSchema.optional(),
});
export const actParamsSchema = z.object({
    sessionId: z.string(),
    elementId: z.string(),
    action: actionTypeSchema,
    value: z.string().optional(),
});
export const stepParamsSchema = z.object({
    sessionId: z.string(),
    intent: z.string(),
});
export const llmStepParamsSchema = z.object({
    sessionId: z.string(),
    actions: z.array(actionPlanStepSchema),
    continueOnError: z.boolean().optional(),
});
export const walkthroughParamsSchema = z.object({
    sessionId: z.string(),
    steps: z.array(z.object({
        intent: z.string(),
        capture: z.boolean().optional(),
        waitMs: z.number().optional(),
    })),
    clean: z.boolean().optional(),
});
export const screenshotParamsSchema = z.object({
    sessionId: z.string(),
    preset: capturePresetSchema.optional(),
    mode: captureModeSchema.optional(),
    elementId: z.string().optional(),
    region: z.string().optional(),
    aspectRatio: z.string().optional(),
    clean: z.boolean().optional(),
    quality: captureQualitySchema.optional(),
});
export const startRecordingParamsSchema = z.object({
    sessionId: z.string(),
    preset: capturePresetSchema.optional(),
    fps: recordingFpsSchema.optional(),
    codec: videoCodecSchema.optional(),
    bitrate: videoBitrateSchema.optional(),
    hardware: z.boolean().optional(),
    composite: recordingCompositeOptionsSchema.optional(),
});
export const stopRecordingParamsSchema = z.object({
    sessionId: z.string(),
    preset: capturePresetSchema.optional(),
});
const recordCompositeShape = {
    appA: z.string(),
    titleA: z.string().optional(),
    labelA: z.string().optional(),
    appB: z.string(),
    titleB: z.string().optional(),
    labelB: z.string().optional(),
    durationSeconds: z.number().optional(),
    fps: z.number().optional(),
    spotlight: compositeSpotlightSchema.optional(),
    caption: z.string().optional(),
    cursor: z.boolean().optional(),
    maxWidth: z.number().optional(),
    crf: z.number().optional(),
    outPath: z.string(),
    sessionId: z.string().optional(),
};
export const recordCompositeParamsSchema = z.object(recordCompositeShape);
export const analyzeParamsSchema = z.object({
    sessionId: z.string(),
    viewport: viewportSchema.optional(),
});
export const discoverParamsSchema = z.object({
    sessionId: z.string(),
    maxDepth: z.number().optional(),
    maxScreens: z.number().optional(),
    captureStates: z.boolean().optional(),
    clean: z.boolean().optional(),
    outputDir: z.string().optional(),
});
export const terminalRecordParamsSchema = z.object({
    command: z.string(),
    timeout: z.number().optional(),
    watch_files: z.array(z.string()).optional(),
    outputDir: z.string().optional(),
});
export const terminalReplayParamsSchema = z.object({
    file: z.string(),
    search: z.string().optional(),
    commands_only: z.boolean().optional(),
});
// Library — discriminated by `action`.
const libraryFiltersShape = {
    tagsAny: z.array(z.string()).optional(),
    tagsAll: z.array(z.string()).optional(),
    feature: z.string().optional(),
    component: z.string().optional(),
    platform: libraryPlatformSchema.optional(),
    type: libraryCaptureTypeSchema.optional(),
    since: z.string().optional(),
    until: z.string().optional(),
    starred: z.boolean().optional(),
    text: z.string().optional(),
    limit: z.number().optional(),
};
export const libraryParamsSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('add'),
        sourcePath: z.string(),
        type: libraryCaptureTypeSchema.optional(),
        platform: libraryPlatformSchema.optional(),
        url: z.string().optional(),
        viewport: z.string().optional(),
        selector: z.string().optional(),
        deviceName: z.string().optional(),
        title: z.string().optional(),
        feature: z.string().optional(),
        component: z.string().optional(),
        tags: z.array(z.string()).optional(),
        starred: z.boolean().optional(),
        walkthrough: z.object({ step_count: z.number(), steps: z.array(z.string()) }).optional(),
        durationMs: z.number().optional(),
        gitBranch: z.string().optional(),
        gitCommit: z.string().optional(),
    }),
    z.object({ action: z.literal('find'), ...libraryFiltersShape }),
    z.object({ action: z.literal('gallery'), groupBy: libraryGroupBySchema.optional() }),
    z.object({ action: z.literal('get'), id: z.string() }),
    z.object({
        action: z.literal('tag'),
        id: z.string(),
        tags: z.array(z.string()).optional(),
        feature: z.string().optional(),
        component: z.string().optional(),
        starred: z.boolean().optional(),
        title: z.string().optional(),
    }),
    z.object({ action: z.literal('delete'), id: z.string() }),
    z.object({ action: z.literal('status') }),
    z.object({
        action: z.literal('export'),
        outDir: z.string(),
        flatten: z.boolean().optional(),
        manifest: z.boolean().optional(),
        ...libraryFiltersShape,
    }),
    z.object({ action: z.literal('migrate-from-showcase'), showcasePath: z.string().optional() }),
]);
// Demo — discriminated by `action`.
const focalRectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const polishSegmentSchema = z.object({
    input: z.string(),
    startSec: z.number(),
    durationSec: z.number(),
    focal: focalRectSchema,
    caption: z.string().optional(),
    captionPngPath: z.string().optional(),
});
const polishDemoSpecSchema = z.object({
    canvas: z.object({ w: z.number(), h: z.number() }),
    fps: z.number().optional(),
    segments: z.array(polishSegmentSchema),
    speed: z.number().optional(),
});
// AutoRampDemoParams (no `action`) — the standalone autoRampDemo operation.
const autoRampDemoShape = {
    input: z.string(),
    out: z.string(),
    deadSpeed: z.number().optional(),
    minDeadSec: z.number().optional(),
    padSec: z.number().optional(),
    threshold: z.number().optional(),
    maxWidth: z.number().optional(),
    crf: z.number().optional(),
    fps: z.number().optional(),
};
export const autoRampDemoParamsSchema = z.object(autoRampDemoShape);
export const demoParamsSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('scan'),
        input: z.string(),
        threshold: z.number().optional(),
    }),
    z.object({
        action: z.literal('polish'),
        spec: polishDemoSpecSchema,
        out: z.string(),
    }),
    z.object({ action: z.literal('auto-ramp'), ...autoRampDemoShape }),
    z.object({ action: z.literal('record-composite'), ...recordCompositeShape }),
]);
// ─── Operation → param-schema registry ─────────────────────────
//
// `undefined` means the operation takes no params (closeAllSessions) or only
// optional params validated leniently at the adapter boundary. Adapters look
// up the schema here to validate before forwarding to the daemon.
export const operationParamSchemas = {
    health: healthParamsSchema,
    getPermissions: getPermissionsParamsSchema,
    requestPermissions: requestPermissionsParamsSchema,
    listWindows: listWindowsParamsSchema,
    createSession: createSessionParamsSchema,
    listSessions: listSessionsParamsSchema,
    getSession: sessionByIdParamsSchema,
    getRun: sessionByIdParamsSchema,
    closeSession: sessionByIdParamsSchema,
    closeAllSessions: z.void().optional(),
    recordLlmUsage: recordLlmUsageParamsSchema,
    snapshot: snapshotParamsSchema,
    observe: observeParamsSchema,
    act: actParamsSchema,
    step: stepParamsSchema,
    llmStep: llmStepParamsSchema,
    walkthrough: walkthroughParamsSchema,
    screenshot: screenshotParamsSchema,
    startRecording: startRecordingParamsSchema,
    stopRecording: stopRecordingParamsSchema,
    recordComposite: recordCompositeParamsSchema,
    analyze: analyzeParamsSchema,
    discover: discoverParamsSchema,
    recordTerminal: terminalRecordParamsSchema,
    replayTerminal: terminalReplayParamsSchema,
    library: libraryParamsSchema,
    demo: demoParamsSchema,
    autoRampDemo: autoRampDemoParamsSchema,
};
// ─── Authoritative runtime mirrors (frozen-surface inputs) ─────
//
// wire.ts declares these as TYPES only. The drift test + daemon client need
// them at runtime, so they are mirrored here and pinned to wire.ts via the
// compile-time exhaustiveness guards below — adding a value in wire.ts without
// updating these arrays (and the snapshot) fails typecheck.
export const apiOperations = Object.keys(operationCapabilities).sort();
export const clientSurfaces = [
    'stdio-mcp',
    'cli',
    'menubar',
    'slash-command',
    'http-mcp',
    'test',
    'unknown',
];
export const capabilities = [
    'daemon:read',
    'permissions:read',
    'permissions:request',
    'windows:read',
    'sessions:read',
    'sessions:write',
    'ui:read',
    'ui:act',
    'analysis:read',
    'discover:write',
    'media:capture',
    'media:record',
    'terminal:read',
    'terminal:record',
    'library:read',
    'library:write',
    'demo:write',
];
export const apiErrorCodes = [
    'bad_request',
    'unauthorized',
    'forbidden',
    'not_found',
    'conflict',
    'unsupported_api_version',
    'permission_denied',
    'capability_denied',
    'capture_failed',
    'recording_failed',
    'daemon_unhealthy',
    'internal_error',
];
export const daemonEventTypes = [
    'daemon.ready',
    'daemon.health',
    'permission.changed',
    'windows.changed',
    'session.created',
    'session.closed',
    'snapshot.observed',
    'decision.recorded',
    'action.completed',
    'artifact.added',
    'recording.status',
    'library.changed',
    'error',
];
// ─── Wire envelope schemas ─────────────────────────────────────
export const callerHintSchema = z.object({
    surface: z.enum(clientSurfaces),
    name: z.string().optional(),
    pid: z.number().optional(),
});
export const apiErrorBodySchema = z.object({
    code: z.enum(apiErrorCodes),
    message: z.string(),
    hint: z.string().optional(),
    details: jsonValueSchema.optional(),
    retryable: z.boolean().optional(),
});
export const verifiedCallerSchema = z.object({
    surface: z.enum(clientSurfaces),
    verifiedBy: z.enum(['unix-peer', 'bearer-token']),
    capabilities: z.array(z.enum(capabilities)),
    uid: z.number().optional(),
    gid: z.number().optional(),
    pid: z.number().optional(),
    tokenId: z.string().optional(),
});
export const apiRequestEnvelopeSchema = z.object({
    apiVersion: z.literal(API_VERSION),
    requestId: z.string(),
    operation: z.enum(apiOperations),
    caller: callerHintSchema.optional(),
    params: z.unknown().optional(),
});
export const apiSuccessEnvelopeSchema = z.object({
    apiVersion: z.literal(API_VERSION),
    requestId: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
    timestamp: z.number(),
    caller: verifiedCallerSchema.optional(),
    deliveryPath: z.enum(clientSurfaces).optional(),
});
export const apiErrorEnvelopeSchema = z.object({
    apiVersion: z.literal(API_VERSION),
    requestId: z.string().optional(),
    ok: z.literal(false),
    error: apiErrorBodySchema,
    timestamp: z.number(),
    caller: verifiedCallerSchema.optional(),
    deliveryPath: z.enum(clientSurfaces).optional(),
});
export const apiResponseEnvelopeSchema = z.discriminatedUnion('ok', [
    apiSuccessEnvelopeSchema,
    apiErrorEnvelopeSchema,
]);
export const daemonEventEnvelopeSchema = z.object({
    apiVersion: z.literal(API_VERSION),
    eventId: z.string(),
    type: z.enum(daemonEventTypes),
    emittedAt: z.number(),
    sessionId: z.string().optional(),
    caller: verifiedCallerSchema.optional(),
    deliveryPath: z.enum(clientSurfaces).optional(),
    data: z.unknown(),
});
function objectParamKeys(schema) {
    let current = schema;
    while (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
        current = current.unwrap();
    }
    if (current instanceof z.ZodObject)
        return Object.keys(current.shape).sort();
    return [];
}
export function contractSurface() {
    return {
        apiVersion: API_VERSION,
        operations: [...apiOperations],
        capabilities: [...capabilities],
        errorCodes: [...apiErrorCodes],
        clientSurfaces: [...clientSurfaces],
        eventTypes: [...daemonEventTypes],
        operationParams: Object.fromEntries(apiOperations.map((operation) => [
            operation,
            objectParamKeys(operationParamSchemas[operation]),
        ])),
        routes: {
            socketPath: primarySocketPath,
            socketMode: primarySocketMode,
            events: eventsRoute,
            mcp: mcpRoute,
        },
        envelopes: {
            request: ['apiVersion', 'requestId', 'operation', 'caller', 'params'],
            success: ['apiVersion', 'requestId', 'ok', 'result', 'timestamp', 'caller', 'deliveryPath'],
            error: ['apiVersion', 'requestId', 'ok', 'error', 'timestamp', 'caller', 'deliveryPath'],
            event: ['apiVersion', 'eventId', 'type', 'emittedAt', 'sessionId', 'caller', 'deliveryPath', 'data'],
        },
    };
}
const _surfacesExhaustive = true;
const _capabilitiesExhaustive = true;
const _errorCodesExhaustive = true;
const _eventTypesExhaustive = true;
// Every CoreApi operation must have a param schema (registry exhaustiveness is
// enforced by the `satisfies Record<CoreApiOperation, ...>` above; this pins the
// runtime operation list too).
const _operationsExhaustive = true;
void _surfacesExhaustive;
void _capabilitiesExhaustive;
void _errorCodesExhaustive;
void _eventTypesExhaustive;
void _operationsExhaustive;
//# sourceMappingURL=schemas.js.map