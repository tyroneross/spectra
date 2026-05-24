// src/cli/token.ts
//
// Daemon bearer-token file at ~/.spectra/daemon.token (mode 0600).
// Token is generated on first daemon start, reused on subsequent starts.
// Loopback alone is not a security boundary on macOS — any local process
// can connect to 127.0.0.1; the bearer token gates write operations.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const SPECTRA_HOME = join(homedir(), '.spectra');
export const TOKEN_PATH = join(SPECTRA_HOME, 'daemon.token');
const TOKEN_BYTES = 32; // 256-bit
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
/**
 * Read the existing daemon token, or mint a new one. The on-disk file is
 * chmod 0600. Caller must trust the token after this returns.
 *
 * Pass overrideHome to test against a tmp dir without setting $HOME.
 */
export function getOrCreateDaemonToken(overrideHome) {
    const base = overrideHome ?? SPECTRA_HOME;
    const path = overrideHome ? join(overrideHome, 'daemon.token') : TOKEN_PATH;
    mkdirSync(base, { recursive: true, mode: 0o700 });
    if (existsSync(path)) {
        const existing = readFileSync(path, 'utf8').trim();
        if (TOKEN_PATTERN.test(existing)) {
            // Re-assert perms in case they got widened
            try {
                chmodSync(path, 0o600);
            }
            catch { /* best-effort */ }
            return { token: existing, path, created: false };
        }
        // Existing file is malformed — overwrite. This is the safer default; an
        // unparseable token is functionally no token, and leaving it would block
        // the daemon forever.
    }
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    writeFileSync(path, token + '\n', { mode: 0o600 });
    // writeFileSync's mode is advisory on some FS; re-assert
    chmodSync(path, 0o600);
    return { token, path, created: true };
}
/** Returns true if Authorization header matches the daemon token via timingSafeEqual. */
export function tokenMatches(headerValue, token) {
    if (!headerValue)
        return false;
    const parts = headerValue.split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer')
        return false;
    const provided = parts[1];
    if (provided.length !== token.length)
        return false;
    // crypto.timingSafeEqual requires equal-length Buffers
    const a = Buffer.from(provided);
    const b = Buffer.from(token);
    return timingSafeEqual(a, b);
}
/** Returns the on-disk file mode (lower 9 bits), or -1 if missing. */
export function tokenFileMode(path = TOKEN_PATH) {
    if (!existsSync(path))
        return -1;
    return statSync(path).mode & 0o777;
}
//# sourceMappingURL=token.js.map