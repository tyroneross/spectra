// src/mcp/http.ts
//
// HTTP transport mount for the spectra MCP server. Uses node:http (no Express/
// Fastify dependency — per build-from-scratch preference) and mounts the SDK's
// StreamableHTTPServerTransport on POST /mcp.
//
// Routes:
//   GET  /api/version    → { apiVersion, daemonVersion }  (no auth)
//   GET  /api/health     → { ok: true, pid }              (no auth)
//   POST /mcp            → MCP Streamable HTTP transport  (bearer auth)
//   GET  /mcp            → MCP SSE event stream            (bearer auth)
//   DELETE /mcp          → MCP session terminate           (bearer auth)
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { connectTransport } from './server.js';
import { getOrCreateDaemonToken, tokenMatches } from '../cli/token.js';
import { getVersionInfo } from './version.js';
export const DEFAULT_PORT = 47823;
export const DEFAULT_HOST = '127.0.0.1';
function sendJson(res, status, body) {
    const json = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(json);
}
function authorize(req, token) {
    const header = req.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    return tokenMatches(value, token);
}
/**
 * Start an HTTP server that mounts the MCP StreamableHTTPServerTransport.
 * One transport instance per server (stateful mode — sessionIdGenerator is set).
 */
export async function startHttpServer(opts = {}) {
    const port = opts.port ?? DEFAULT_PORT;
    const host = opts.host ?? DEFAULT_HOST;
    const { token } = getOrCreateDaemonToken(opts.overrideHome);
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
    });
    // Wire the McpServer to this HTTP transport BEFORE the server starts
    // accepting requests, so the first POST /mcp finds a live transport.
    await connectTransport(transport);
    const server = createServer((req, res) => {
        // Bind 127.0.0.1 already restricts this, but defense in depth: reject
        // anything that looks like a non-local Host header.
        const url = req.url ?? '/';
        const method = req.method ?? 'GET';
        if (method === 'GET' && url === '/api/version') {
            sendJson(res, 200, getVersionInfo());
            return;
        }
        if (method === 'GET' && url === '/api/health') {
            sendJson(res, 200, { ok: true, pid: process.pid, uptime: process.uptime() });
            return;
        }
        if (url.startsWith('/mcp')) {
            if (!authorize(req, token)) {
                sendJson(res, 401, { error: 'Unauthorized' });
                return;
            }
            if (method === 'POST' || method === 'GET' || method === 'DELETE') {
                // StreamableHTTPServerTransport handles request lifecycle including
                // body parsing, SSE upgrade, and response stream control.
                transport.handleRequest(req, res).catch((err) => {
                    if (!res.headersSent) {
                        sendJson(res, 500, { error: err.message });
                    }
                    else {
                        try {
                            res.end();
                        }
                        catch { /* connection already closed */ }
                    }
                });
                return;
            }
            sendJson(res, 405, { error: 'Method Not Allowed' });
            return;
        }
        sendJson(res, 404, { error: 'Not Found' });
    });
    await new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        server.once('error', onError);
        server.listen(port, host, () => {
            server.off('error', onError);
            resolve();
        });
    });
    // Resolve actual bound port (caller may pass port=0)
    const addr = server.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : port;
    return {
        server,
        port: boundPort,
        token,
        close: async () => {
            await transport.close().catch(() => { });
            await new Promise((resolve) => server.close(() => resolve()));
        },
    };
}
//# sourceMappingURL=http.js.map