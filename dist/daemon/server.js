import { randomUUID } from 'node:crypto';
import { chmod } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { API_VERSION, eventsRoute, primarySocketPath, } from '../contract/wire.js';
import { createCoreApi } from './core-impl.js';
import { DaemonApiError, toDaemonApiError } from './errors.js';
import { allCapabilities, assertCapabilities, assertLoopbackTcpRequest, assertOperationAllowed, expandHomePath, getOrCreateBearerToken, isCoreApiOperation, prepareUnixSocketPath, verifyBearerCaller, verifyUnixCaller, } from './security.js';
const MAX_JSON_BYTES = 1024 * 1024;
class DaemonEventBus {
    subscribers = new Set();
    subscribe(subscriber) {
        this.subscribers.add(subscriber);
        return () => {
            this.subscribers.delete(subscriber);
        };
    }
    emit(event) {
        const envelope = toEventEnvelope(event);
        for (const subscriber of this.subscribers) {
            if (subscriber.filter.sessionId && subscriber.filter.sessionId !== envelope.sessionId) {
                continue;
            }
            if (subscriber.filter.eventTypes && !subscriber.filter.eventTypes.includes(envelope.type)) {
                continue;
            }
            subscriber.write(envelope);
        }
    }
}
export async function startDaemonServer(options = {}) {
    const bus = new DaemonEventBus();
    const api = options.api ?? createCoreApi({ eventSink: (event) => bus.emit(event) });
    const unixEnabled = options.unix?.enabled ?? true;
    const socketPath = unixEnabled
        ? expandHomePath(options.socketPath ?? primarySocketPath)
        : undefined;
    const servers = [];
    const handler = (transport) => async (req, res) => {
        await handleRequest({ req, res, transport, api, bus, options, socketPath }).catch((error) => {
            const apiError = toDaemonApiError(error);
            sendError(res, apiError.status, apiError, undefined, undefined, 'unknown');
        });
    };
    if (unixEnabled && socketPath) {
        await prepareUnixSocketPath(socketPath);
        const previousUmask = process.umask(0o177);
        const unixServer = createServer(handler('unix'));
        configureHttpServer(unixServer);
        await listenUnix(unixServer, socketPath).finally(() => {
            process.umask(previousUmask);
        });
        await chmod(socketPath, 0o600);
        servers.push(unixServer);
    }
    let tcpPort;
    let tcpToken;
    if (options.tcp?.enabled) {
        const token = await getOrCreateBearerToken(options.tcp.tokenPath ?? '~/.spectra/daemon.token', options.tcp.token);
        tcpToken = token.token;
        const tcpServer = createServer(handler('tcp'));
        configureHttpServer(tcpServer);
        await listenTcp(tcpServer, options.tcp.port ?? 0, options.tcp.host ?? '127.0.0.1');
        const address = tcpServer.address();
        tcpPort = typeof address === 'object' && address ? address.port : options.tcp.port;
        servers.push(tcpServer);
    }
    return {
        api,
        socketPath,
        tcpPort,
        tcpToken,
        emit: (event) => bus.emit(event),
        close: async () => {
            await Promise.all(servers.map((server) => closeServer(server)));
            const closeable = api;
            await closeable.close?.();
        },
    };
}
export function createDaemonRequestHandler(options) {
    const bus = new DaemonEventBus();
    return async (req, res) => {
        await handleRequest({
            req,
            res,
            transport: options.transport,
            api: options.api,
            bus,
            options,
            socketPath: options.socketPath,
        });
    };
}
async function handleRequest(context) {
    const { req, res } = context;
    const url = new URL(req.url ?? '/', 'http://spectra.local');
    const requestId = req.headers['x-request-id'];
    const fallbackRequestId = Array.isArray(requestId) ? requestId[0] : requestId;
    let caller;
    try {
        caller = await verifyCaller(context);
    }
    catch (error) {
        const apiError = toDaemonApiError(error);
        sendError(res, apiError.status, apiError, fallbackRequestId, undefined, 'unknown');
        return;
    }
    if (url.pathname === eventsRoute) {
        if ((req.method ?? 'GET') !== 'GET') {
            sendError(res, 405, new DaemonApiError('bad_request', 'SSE events endpoint requires GET', { status: 405 }), fallbackRequestId, caller, caller.surface);
            return;
        }
        try {
            assertCapabilities(caller, ['daemon:read']);
            await handleEvents(context, caller, url);
        }
        catch (error) {
            const apiError = toDaemonApiError(error);
            sendError(res, apiError.status, apiError, fallbackRequestId, caller, caller.surface);
        }
        return;
    }
    if ((req.method ?? 'GET') !== 'POST') {
        sendError(res, 405, new DaemonApiError('bad_request', 'CoreApi operations require POST', { status: 405 }), fallbackRequestId, caller, caller.surface);
        return;
    }
    const match = /^\/api\/v1\/([^/]+)$/.exec(url.pathname);
    const operationName = match?.[1];
    if (!operationName || !isCoreApiOperation(operationName)) {
        sendError(res, 404, new DaemonApiError('not_found', `Unknown daemon operation route: ${url.pathname}`, {
            status: 404,
        }), fallbackRequestId, caller, caller.surface);
        return;
    }
    const operation = operationName;
    let envelope;
    try {
        envelope = await readRequestEnvelope(req);
        validateEnvelope(envelope, operation);
        assertOperationAllowed(operation, caller);
    }
    catch (error) {
        const apiError = toDaemonApiError(error);
        sendError(res, apiError.status, apiError, envelope?.requestId ?? fallbackRequestId, caller, caller.surface);
        return;
    }
    try {
        const result = await dispatchCoreApi(context.api, operation, envelope.params);
        sendJson(res, 200, {
            apiVersion: API_VERSION,
            requestId: envelope.requestId,
            ok: true,
            result,
            timestamp: Date.now(),
            caller,
            deliveryPath: caller.surface,
        });
    }
    catch (error) {
        const apiError = toDaemonApiError(error);
        sendError(res, apiError.status, apiError, envelope.requestId, caller, caller.surface);
    }
}
async function verifyCaller(context) {
    if (context.transport === 'tcp') {
        const tcp = context.options.tcp;
        if (!tcp?.enabled) {
            throw new DaemonApiError('forbidden', 'Loopback TCP is not enabled', { status: 403 });
        }
        assertLoopbackTcpRequest(context.req, tcp.allowedOrigins);
        const token = await getOrCreateBearerToken(tcp.tokenPath ?? '~/.spectra/daemon.token', tcp.token);
        return verifyBearerCaller({
            req: context.req,
            token: token.token,
            tokenId: token.tokenId,
            surface: tcp.surface ?? 'http-mcp',
            capabilities: tcp.capabilities ?? allCapabilities,
        });
    }
    if (!context.socketPath) {
        throw new DaemonApiError('daemon_unhealthy', 'Unix socket path is not configured', {
            status: 503,
        });
    }
    return verifyUnixCaller({
        socket: context.req.socket,
        socketPath: context.socketPath,
        surface: context.options.unix?.surface ?? 'unknown',
        capabilities: context.options.unix?.capabilities ?? allCapabilities,
        peerCredentials: context.options.unix?.peerCredentials,
        enforceSocketMode: context.options.unix?.enforceSocketMode,
    });
}
function validateEnvelope(envelope, operation) {
    if (!envelope || typeof envelope !== 'object') {
        throw new DaemonApiError('bad_request', 'Request envelope must be a JSON object', { status: 400 });
    }
    if (envelope.apiVersion !== API_VERSION) {
        throw new DaemonApiError('unsupported_api_version', `Unsupported apiVersion ${String(envelope.apiVersion)}; expected ${API_VERSION}`, { status: 400 });
    }
    if (!envelope.requestId || typeof envelope.requestId !== 'string') {
        throw new DaemonApiError('bad_request', 'requestId is required', { status: 400 });
    }
    if (envelope.operation !== operation) {
        throw new DaemonApiError('bad_request', `Route operation ${operation} does not match envelope operation ${String(envelope.operation)}`, { status: 400 });
    }
}
async function readRequestEnvelope(req) {
    const body = await readBody(req);
    let parsed;
    try {
        parsed = body.length === 0 ? {} : JSON.parse(body);
    }
    catch (error) {
        throw new DaemonApiError('bad_request', 'Malformed JSON request body', {
            status: 400,
            cause: error,
        });
    }
    return parsed;
}
async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_JSON_BYTES) {
            throw new DaemonApiError('bad_request', 'Request body exceeds daemon limit', {
                status: 413,
            });
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
}
async function dispatchCoreApi(api, operation, params) {
    const handler = api[operation];
    return handler.call(api, params);
}
async function handleEvents(context, caller, url) {
    const { req, res, api, bus } = context;
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
    });
    const health = await api.health({});
    writeSse(res, {
        event: 'daemon.ready',
        id: randomUUID(),
        data: {
            apiVersion: API_VERSION,
            eventId: randomUUID(),
            type: 'daemon.ready',
            emittedAt: Date.now(),
            caller,
            deliveryPath: caller.surface,
            data: {
                apiVersion: API_VERSION,
                daemonVersion: health.daemonVersion,
                pid: process.pid,
                aquaSession: health.aquaSession,
                windowServerConnected: health.windowServer.connected,
            },
        },
    });
    const eventTypes = url.searchParams.get('eventTypes')?.split(',').filter(Boolean);
    const sessionId = url.searchParams.get('sessionId') ?? undefined;
    const unsubscribe = bus.subscribe({
        filter: { sessionId, eventTypes },
        write: (event) => writeSse(res, {
            event: event.type,
            id: event.eventId,
            data: event,
        }),
    });
    req.on('close', unsubscribe);
}
function toEventEnvelope(event) {
    const maybeSession = event;
    return {
        apiVersion: API_VERSION,
        eventId: randomUUID(),
        type: event.type,
        emittedAt: Date.now(),
        sessionId: maybeSession.sessionId,
        data: event.data,
    };
}
function writeSse(res, frame) {
    if (frame.retry !== undefined)
        res.write(`retry: ${frame.retry}\n`);
    res.write(`event: ${frame.event}\n`);
    res.write(`id: ${frame.id}\n`);
    res.write(`data: ${JSON.stringify(frame.data)}\n\n`);
}
function sendJson(res, status, body) {
    if (res.headersSent) {
        res.end();
        return;
    }
    const json = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(json);
}
function sendError(res, status, error, requestId, caller, deliveryPath) {
    sendJson(res, status, {
        apiVersion: API_VERSION,
        requestId,
        ok: false,
        error: error.toBody(),
        timestamp: Date.now(),
        caller,
        deliveryPath,
    });
}
function configureHttpServer(server) {
    server.headersTimeout = 5_000;
    server.requestTimeout = 30_000;
    // Long-running operations such as recordComposite do all work after the small
    // JSON request body is read. Do not close the Unix socket just because the
    // handler is encoding video and has not produced a response yet.
    server.timeout = 0;
}
async function listenUnix(server, socketPath) {
    await new Promise((resolveListen, reject) => {
        const onError = (error) => reject(error);
        server.once('error', onError);
        server.listen(socketPath, () => {
            server.off('error', onError);
            resolveListen();
        });
    });
}
async function listenTcp(server, port, host) {
    await new Promise((resolveListen, reject) => {
        const onError = (error) => reject(error);
        server.once('error', onError);
        server.listen(port, host, () => {
            server.off('error', onError);
            resolveListen();
        });
    });
}
async function closeServer(server) {
    await new Promise((resolveClose) => server.close(() => resolveClose()));
}
function isMainModule() {
    const entry = process.argv[1];
    if (!entry)
        return false;
    return fileURLToPath(import.meta.url) === resolve(entry);
}
if (isMainModule()) {
    startDaemonServer().then((running) => {
        process.once('SIGINT', () => {
            running.close().finally(() => process.exit(0));
        });
        process.once('SIGTERM', () => {
            running.close().finally(() => process.exit(0));
        });
    }).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
//# sourceMappingURL=server.js.map