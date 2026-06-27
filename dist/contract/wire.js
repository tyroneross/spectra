// src/contract/wire.ts
//
// Wire contract for the daemon HTTP shape served over the primary Unix domain
// socket. CoreApi stays transport-neutral; this file defines only envelopes,
// event frames, transport policy, and error vocabulary.
export const API_VERSION = 2;
export const apiVersion = API_VERSION;
export const primarySocketPath = '~/.spectra/daemon.sock';
export const primarySocketMode = '0600';
export const eventsRoute = '/api/v1/events';
export const mcpRoute = '/mcp';
export const operationCapabilities = {
    health: ['daemon:read'],
    getPermissions: ['permissions:read'],
    requestPermissions: ['permissions:request'],
    listWindows: ['windows:read'],
    createSession: ['sessions:write', 'ui:read'],
    listSessions: ['sessions:read'],
    getSession: ['sessions:read'],
    getRun: ['sessions:read'],
    closeSession: ['sessions:write'],
    closeAllSessions: ['sessions:write'],
    recordLlmUsage: ['sessions:write'],
    snapshot: ['ui:read'],
    observe: ['ui:read'],
    act: ['ui:act'],
    step: ['ui:act'],
    llmStep: ['ui:act'],
    walkthrough: ['ui:act', 'media:capture'],
    screenshot: ['media:capture'],
    startRecording: ['media:record'],
    stopRecording: ['media:record'],
    recordComposite: ['media:record', 'windows:read'],
    analyze: ['analysis:read'],
    discover: ['discover:write', 'ui:act', 'media:capture'],
    recordTerminal: ['terminal:record'],
    replayTerminal: ['terminal:read'],
    library: ['library:read', 'library:write'],
    demo: ['demo:write'],
    autoRampDemo: ['demo:write'],
};
export const unixSocketTransportPolicy = {
    kind: 'unix-socket',
    primary: true,
    socketPath: primarySocketPath,
    socketMode: primarySocketMode,
    auth: {
        verifyPeerCredentials: true,
        defaultDenyCapabilities: true,
    },
};
export const loopbackHttpTransportPolicy = {
    kind: 'loopback-http',
    primary: false,
    optInOnly: true,
    allowedHosts: ['127.0.0.1', '::1', 'localhost'],
    rejectNonLoopbackHost: true,
    bearer: {
        required: true,
        tokenPath: '~/.spectra/daemon.token',
        tokenFileMode: '0600',
        requiredOnEveryRequest: true,
    },
    origin: {
        validate: true,
        allowedOrigins: [],
    },
    routes: ['/api/v1/*', '/api/v1/events', '/mcp'],
};
//# sourceMappingURL=wire.js.map