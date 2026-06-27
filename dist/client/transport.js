// src/client/transport.ts
//
// Unix-domain-socket HTTP transport for the daemon client. The daemon serves
// the frozen wire contract (POST /api/v1/<operation> + GET /api/v1/events) over
// a 0600 unix socket at ~/.spectra/daemon.sock. node:http can speak HTTP over a
// unix socket via the `socketPath` option — no network surface, no TCP, no
// bearer token (the daemon authenticates by socket peer credentials).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>
import { request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
/** Expand a leading `~` (or `~/`) to the current user's home directory. */
export function expandHome(p) {
    if (p === '~')
        return homedir();
    if (p.startsWith('~/'))
        return join(homedir(), p.slice(2));
    return p;
}
/** A connection-level failure (socket missing / refused / timed out). The
 * daemon client treats these as "daemon down" and triggers the fail-open path. */
export class SocketConnectionError extends Error {
    cause;
    syscallCode;
    constructor(message, opts) {
        super(message);
        this.name = 'SocketConnectionError';
        this.cause = opts?.cause;
        this.syscallCode = opts?.code;
    }
}
const CONNECTION_CODES = new Set([
    'ENOENT', // socket file does not exist → daemon never started
    'ECONNREFUSED', // socket file exists but nothing is listening
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
]);
/**
 * Issue a single HTTP request over a unix socket. Resolves with status + parsed
 * body for any HTTP response (including 4xx/5xx). Rejects with
 * SocketConnectionError only for transport-level failures.
 */
export function socketRequest(opts) {
    const { socketPath, path, method = 'POST', body, headers = {}, timeoutMs = 30_000 } = opts;
    return new Promise((resolve, reject) => {
        const payload = body ?? '';
        const req = httpRequest({
            socketPath,
            path,
            method,
            // The Host header is irrelevant over a unix socket but some HTTP stacks
            // require one; use a fixed sentinel the daemon ignores.
            headers: {
                host: 'spectra.local',
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload).toString(),
                ...headers,
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let parsed = raw;
                if (raw.length > 0) {
                    try {
                        parsed = JSON.parse(raw);
                    }
                    catch { /* leave as raw string */ }
                }
                resolve({ status: res.statusCode ?? 0, body: parsed, raw });
            });
        });
        req.setTimeout(timeoutMs, () => {
            req.destroy(new SocketConnectionError(`Daemon request timed out after ${timeoutMs}ms`, { code: 'ETIMEDOUT' }));
        });
        req.on('error', (err) => {
            if (err instanceof SocketConnectionError) {
                reject(err);
                return;
            }
            const code = err.code;
            if (code && CONNECTION_CODES.has(code)) {
                reject(new SocketConnectionError(`Daemon socket unreachable (${code}) at ${socketPath}`, { cause: err, code }));
                return;
            }
            reject(new SocketConnectionError(err.message, { cause: err, code }));
        });
        if (method === 'POST')
            req.write(payload);
        req.end();
    });
}
//# sourceMappingURL=transport.js.map