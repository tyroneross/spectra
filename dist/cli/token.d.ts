export declare const SPECTRA_HOME: string;
export declare const TOKEN_PATH: string;
export interface TokenInfo {
    token: string;
    path: string;
    created: boolean;
}
/**
 * Read the existing daemon token, or mint a new one. The on-disk file is
 * chmod 0600. Caller must trust the token after this returns.
 *
 * Pass overrideHome to test against a tmp dir without setting $HOME.
 */
export declare function getOrCreateDaemonToken(overrideHome?: string): TokenInfo;
/** Returns true if Authorization header matches the daemon token via timingSafeEqual. */
export declare function tokenMatches(headerValue: string | undefined, token: string): boolean;
/** Returns the on-disk file mode (lower 9 bits), or -1 if missing. */
export declare function tokenFileMode(path?: string): number;
//# sourceMappingURL=token.d.ts.map