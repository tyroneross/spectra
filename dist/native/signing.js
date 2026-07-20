// src/native/signing.ts
//
// Stable code-signing identity + TCC-grant durability for Spectra's local
// native helpers (~/.spectra/bin).
//
// THE BUG THIS FIXES: every helper was ad-hoc signed WITHOUT an explicit
// `-i <identifier>`, so codesign kept swiftc's linker-generated identifier
// (`spectra-daemon-core-<contenthash>`) and set no Team ID. macOS TCC derives
// the *designated requirement* of an ad-hoc binary from its cdhash, which
// changes on every rebuild — so a Screen-Recording / Accessibility grant made
// against one build silently stops matching the next one. The System Settings
// pane still shows an enabled toggle (pinned to the OLD build), while the newly
// built binary reports `state: denied`.
//
// THE FIX, in layers:
//   1. STABLE IDENTIFIER — always pass `-i dev.spectra.<slug>`. This alone makes
//      the identifier reproducible across rebuilds (no content-hash suffix).
//   2. STABLE TEAM IDENTITY — when a real "Developer ID Application" identity is
//      present in the keychain, sign with it. TCC then keys the grant on
//      (identifier, Team ID leaf), which is STABLE across rebuilds regardless of
//      cdhash — so the grant survives. This is proven non-prompting for an
//      already-authorized key ACL; it never modifies the keychain.
//   3. STALENESS RECORD — record each helper's cdhash at sign time and the
//      cdhash a permission was last granted against, so the daemon can tell
//      "denied because rebuilt since grant" from a plain "denied".
//
// GUARDRAIL: `SPECTRA_CODESIGN=0` skips signing entirely; `SPECTRA_STABLE_SIGNING=0`
// forces ad-hoc (CI / headless / no-identity hosts) while KEEPING the stable
// identifier. An explicit `SPECTRA_CODESIGN_IDENTITY` always wins.
//
// SPDX-License-Identifier: Apache-2.0
// (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
// `SPECTRA_HOME` overrides the state dir. Production never sets it (→ ~/.spectra);
// tests point it at a temp dir for hermetic isolation, since os.homedir() is not
// reliably redirectable under the test runner.
const SPECTRA_HOME = process.env.SPECTRA_HOME?.trim() || join(homedir(), '.spectra');
const BIN_DIR = join(SPECTRA_HOME, 'bin');
const SIGNING_MANIFEST_PATH = join(BIN_DIR, '.signing-manifest.json');
const PERMISSION_GRANTS_PATH = join(SPECTRA_HOME, 'permission-grants.json');
const REGRANT_MARKER_PATH = join(BIN_DIR, '.regrant-needed.json');
export const ADHOC_IDENTITY = '-';
/**
 * Stable identifier slug for a helper: strip the leading `spectra-` so the
 * identifier reads `dev.spectra.daemon-core` rather than the doubled-up
 * `dev.spectra.spectra-daemon-core`. This mapping is FROZEN — the shell signer
 * (scripts/codesign-native.sh) derives the identical value in bash, and the
 * daemon's staleness detector keys grants by helper basename, so all three
 * surfaces MUST agree.
 */
export function slugFor(binaryPathOrName) {
    const name = basename(binaryPathOrName);
    return name.startsWith('spectra-') ? name.slice('spectra-'.length) : name;
}
/** Stable code-signing identifier for a helper: `dev.spectra.<slug>`. */
export function identifierFor(binaryPathOrName) {
    return `dev.spectra.${slugFor(binaryPathOrName)}`;
}
let cachedDeveloperId;
/**
 * First "Developer ID Application: …" identity in the login keychain, or null.
 * READ-ONLY: `security find-identity` enumerates identities; it never unlocks,
 * modifies, or prompts. Cached for the process.
 */
export function detectDeveloperIdIdentity() {
    if (cachedDeveloperId !== undefined)
        return cachedDeveloperId;
    if (process.platform !== 'darwin') {
        cachedDeveloperId = null;
        return null;
    }
    try {
        const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
            encoding: 'utf8',
            timeout: 5_000,
        });
        const out = `${result.stdout ?? ''}`;
        // Line shape: `  1) <40-hex> "Developer ID Application: Name (TEAMID)"`
        const match = out.match(/"(Developer ID Application:[^"]+)"/);
        cachedDeveloperId = match ? match[1] : null;
    }
    catch {
        cachedDeveloperId = null;
    }
    return cachedDeveloperId;
}
/** Test seam — reset the cached Developer ID lookup. */
export function resetSigningIdentityCache() {
    cachedDeveloperId = undefined;
}
/**
 * Resolve which identity to sign with, honoring the guardrail env vars:
 *   - SPECTRA_CODESIGN=0                → skip (no signature touched)
 *   - SPECTRA_CODESIGN_IDENTITY=<id>    → explicit (release/notarize; 'skip' → skip)
 *   - SPECTRA_STABLE_SIGNING=0          → force ad-hoc (still stable identifier)
 *   - else, if a Developer ID identity  → devid  (grant-durable default)
 *   - else                              → ad-hoc (stable identifier, cdhash-pinned grant)
 */
export function resolveSigningIdentity() {
    if (process.env.SPECTRA_CODESIGN === '0')
        return { identity: null, mode: 'skip' };
    const explicit = process.env.SPECTRA_CODESIGN_IDENTITY?.trim();
    if (explicit) {
        if (explicit === 'skip')
            return { identity: null, mode: 'skip' };
        if (explicit === ADHOC_IDENTITY)
            return { identity: ADHOC_IDENTITY, mode: 'adhoc' };
        return { identity: explicit, mode: 'explicit' };
    }
    if (process.env.SPECTRA_STABLE_SIGNING !== '0') {
        const devId = detectDeveloperIdIdentity();
        if (devId)
            return { identity: devId, mode: 'devid' };
    }
    return { identity: ADHOC_IDENTITY, mode: 'adhoc' };
}
/** Parse `codesign -dvvv` for the fields that identify a signature. */
export function readSignatureInfo(binaryPath) {
    const empty = { identifier: null, cdhash: null, teamId: null, adhoc: false };
    if (!existsSync(binaryPath))
        return empty;
    try {
        const result = spawnSync('codesign', ['-dvvv', binaryPath], { encoding: 'utf8', timeout: 5_000 });
        const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
        const identifier = out.match(/^Identifier=(.+)$/m)?.[1]?.trim() ?? null;
        const cdhash = out.match(/^CDHash=([0-9a-f]+)/m)?.[1]?.trim() ?? null;
        const teamRaw = out.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? null;
        const teamId = teamRaw && teamRaw !== 'not set' ? teamRaw : null;
        const adhoc = /^Signature=adhoc/m.test(out);
        return { identifier, cdhash, teamId, adhoc };
    }
    catch {
        return empty;
    }
}
/** Just the cdhash of a signed binary, or null. */
export function readCdhash(binaryPath) {
    return readSignatureInfo(binaryPath).cdhash;
}
function readJsonFile(path, fallback) {
    try {
        if (!existsSync(path))
            return fallback;
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return fallback;
    }
}
function writeJsonFile(path, value) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
export function readSigningManifest() {
    return readJsonFile(SIGNING_MANIFEST_PATH, {});
}
export function readSigningManifestEntry(binaryPathOrName) {
    return readSigningManifest()[basename(binaryPathOrName)];
}
/**
 * Record a helper's signature into the manifest, keyed by basename. Called
 * right after a successful sign. Reads the on-disk signature so the manifest
 * reflects reality (not what we intended to sign). Best-effort; never throws
 * into a build.
 */
export function recordSigningManifest(binaryPath) {
    const info = readSignatureInfo(binaryPath);
    const entry = {
        identifier: info.identifier,
        cdhash: info.cdhash,
        teamId: info.teamId,
        adhoc: info.adhoc,
        signedAt: new Date().toISOString(),
    };
    try {
        const manifest = readSigningManifest();
        manifest[basename(binaryPath)] = entry;
        writeJsonFile(SIGNING_MANIFEST_PATH, manifest);
    }
    catch {
        // Non-fatal — the manifest is a diagnostic aid, not a build gate.
    }
    return entry;
}
export function readPermissionGrants() {
    return readJsonFile(PERMISSION_GRANTS_PATH, {});
}
/**
 * Remember that `permission` is currently granted, pinned to `helperBinary`'s
 * cdhash. Called from getPermissions whenever a probe returns `granted`, so the
 * "last known granted" cdhash tracks the live binary. No-op if the cdhash can't
 * be read.
 */
export function recordGrant(permission, helperBinary) {
    const cdhash = readCdhash(helperBinary);
    if (!cdhash)
        return;
    try {
        const grants = readPermissionGrants();
        grants[permission] = {
            helper: basename(helperBinary),
            grantedCdhash: cdhash,
            grantedAt: new Date().toISOString(),
        };
        writeJsonFile(PERMISSION_GRANTS_PATH, grants);
    }
    catch {
        // Non-fatal.
    }
}
/**
 * Decide whether a currently-DENIED permission is denied *because the helper
 * was rebuilt since the grant*. True iff we recorded a granted cdhash for this
 * permission and the helper's current cdhash differs (or the binary is gone).
 */
export function assessGrantStaleness(permission, helperBinary) {
    const grant = readPermissionGrants()[permission];
    if (!grant)
        return { stale: false };
    const currentCdhash = readCdhash(helperBinary);
    if (currentCdhash && currentCdhash === grant.grantedCdhash)
        return { stale: false };
    return { stale: true, grantedCdhash: grant.grantedCdhash, currentCdhash };
}
export function readRegrantMarker() {
    return readJsonFile(REGRANT_MARKER_PATH, null);
}
export function clearRegrantMarker() {
    try {
        if (existsSync(REGRANT_MARKER_PATH))
            writeFileSync(REGRANT_MARKER_PATH, '');
    }
    catch {
        // Non-fatal.
    }
}
export { SIGNING_MANIFEST_PATH, PERMISSION_GRANTS_PATH, REGRANT_MARKER_PATH, BIN_DIR as SIGNING_BIN_DIR, };
//# sourceMappingURL=signing.js.map