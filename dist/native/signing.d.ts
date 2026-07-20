declare const BIN_DIR: string;
declare const SIGNING_MANIFEST_PATH: string;
declare const PERMISSION_GRANTS_PATH: string;
declare const REGRANT_MARKER_PATH: string;
export declare const ADHOC_IDENTITY = "-";
/**
 * Stable identifier slug for a helper: strip the leading `spectra-` so the
 * identifier reads `dev.spectra.daemon-core` rather than the doubled-up
 * `dev.spectra.spectra-daemon-core`. This mapping is FROZEN — the shell signer
 * (scripts/codesign-native.sh) derives the identical value in bash, and the
 * daemon's staleness detector keys grants by helper basename, so all three
 * surfaces MUST agree.
 */
export declare function slugFor(binaryPathOrName: string): string;
/** Stable code-signing identifier for a helper: `dev.spectra.<slug>`. */
export declare function identifierFor(binaryPathOrName: string): string;
export type SigningMode = 'skip' | 'adhoc' | 'explicit' | 'devid';
export interface ResolvedSigningIdentity {
    /** The `--sign` argument, or null when signing is skipped entirely. */
    identity: string | null;
    mode: SigningMode;
}
/** Record that Developer ID signing is not usable in this process → resolve ad-hoc. */
export declare function markDevidUnavailable(): void;
/**
 * First "Developer ID Application: …" identity in the login keychain, or null.
 * READ-ONLY: `security find-identity` enumerates identities; it never unlocks,
 * modifies, or prompts. Cached for the process.
 */
export declare function detectDeveloperIdIdentity(): string | null;
/** Test seam — reset the cached Developer ID lookup + fallback latch. */
export declare function resetSigningIdentityCache(): void;
/**
 * Resolve which identity to sign with, honoring the guardrail env vars:
 *   - SPECTRA_CODESIGN=0                → skip (no signature touched)
 *   - SPECTRA_CODESIGN_IDENTITY=<id>    → explicit (release/notarize; 'skip' → skip)
 *   - SPECTRA_STABLE_SIGNING=0          → force ad-hoc (still stable identifier)
 *   - else, if a Developer ID identity  → devid  (grant-durable default)
 *   - else                              → ad-hoc (stable identifier, cdhash-pinned grant)
 */
export declare function resolveSigningIdentity(): ResolvedSigningIdentity;
export interface SignatureInfo {
    identifier: string | null;
    cdhash: string | null;
    teamId: string | null;
    adhoc: boolean;
}
/** Parse `codesign -dvvv` for the fields that identify a signature. */
export declare function readSignatureInfo(binaryPath: string): SignatureInfo;
/** Just the cdhash of a signed binary, or null. */
export declare function readCdhash(binaryPath: string): string | null;
export interface SigningManifestEntry {
    identifier: string | null;
    cdhash: string | null;
    teamId: string | null;
    adhoc: boolean;
    signedAt: string;
}
type SigningManifest = Record<string, SigningManifestEntry>;
export declare function readSigningManifest(): SigningManifest;
export declare function readSigningManifestEntry(binaryPathOrName: string): SigningManifestEntry | undefined;
/**
 * Record a helper's signature into the manifest, keyed by basename. Called
 * right after a successful sign. Reads the on-disk signature so the manifest
 * reflects reality (not what we intended to sign). Best-effort; never throws
 * into a build.
 */
export declare function recordSigningManifest(binaryPath: string): SigningManifestEntry;
export interface GrantRecord {
    helper: string;
    grantedCdhash: string;
    grantedAt: string;
}
type PermissionGrants = Record<string, GrantRecord>;
export declare function readPermissionGrants(): PermissionGrants;
/**
 * Remember that `permission` is currently granted, pinned to `helperBinary`'s
 * cdhash. Called from getPermissions whenever a probe returns `granted`, so the
 * "last known granted" cdhash tracks the live binary. No-op if the cdhash can't
 * be read.
 */
export declare function recordGrant(permission: string, helperBinary: string): void;
export type StalenessVerdict = {
    stale: false;
} | {
    stale: true;
    grantedCdhash: string;
    currentCdhash: string | null;
};
/**
 * Decide whether a currently-DENIED permission is denied *because the helper
 * was rebuilt since the grant*. True iff we recorded a granted cdhash for this
 * permission and the helper's current cdhash differs (or the binary is gone).
 */
export declare function assessGrantStaleness(permission: string, helperBinary: string): StalenessVerdict;
export interface RegrantMarker {
    reason: string;
    helper: string;
    previousIdentifier: string | null;
    newIdentifier: string | null;
    createdAt: string;
}
export declare function readRegrantMarker(): RegrantMarker | null;
export declare function clearRegrantMarker(): void;
export { SIGNING_MANIFEST_PATH, PERMISSION_GRANTS_PATH, REGRANT_MARKER_PATH, BIN_DIR as SIGNING_BIN_DIR, };
//# sourceMappingURL=signing.d.ts.map