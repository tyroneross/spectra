#!/usr/bin/env bash
#
# Sign Spectra's local native helpers with a STABLE, grant-durable identity.
#
# WHY THIS EXISTS: without an explicit `-i`, codesign keeps swiftc's linker
# identifier (`spectra-<name>-<contenthash>`) and sets no Team ID, so macOS TCC
# pins the grant to the cdhash — which changes every rebuild, silently breaking
# Screen-Recording / Accessibility grants. This script always passes a stable
# `-i dev.spectra.<slug>` and, when a "Developer ID Application" identity is
# available, signs with it (stable Team ID → grant survives rebuilds).
#
# IDENTITY RESOLUTION (matches src/native/signing.ts):
#   SPECTRA_CODESIGN=0             → skip signing entirely
#   SPECTRA_CODESIGN_IDENTITY=<id> → explicit identity ('skip' → skip)
#   SPECTRA_STABLE_SIGNING=0       → force ad-hoc (still stable identifier)
#   else, Developer ID present     → sign with it (grant-durable default)
#   else                           → ad-hoc (stable identifier, cdhash-pinned)
#
# The Developer ID lookup is READ-ONLY (`security find-identity`); it never
# unlocks, modifies, or prompts the keychain.
#
# INSTALL GUARD: if a helper's signing identity CHANGES vs the copy already on
# disk AND a TCC grant was previously recorded, print a one-line re-grant
# warning and drop a marker the daemon surfaces on next start.

set -euo pipefail

TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
    echo "usage: scripts/codesign-native.sh <mach-o-or-app>" >&2
    exit 64
fi

if [[ "${SPECTRA_CODESIGN:-1}" == "0" ]]; then
    exit 0
fi

# SPECTRA_HOME override keeps this script's paths in lockstep with
# src/native/signing.ts (production → ~/.spectra; tests → a temp dir).
SPECTRA_HOME="${SPECTRA_HOME:-$HOME/.spectra}"
GRANTS_FILE="$SPECTRA_HOME/permission-grants.json"
REGRANT_MARKER="$SPECTRA_HOME/bin/.regrant-needed.json"

# Resolve the signing identity (see header for precedence).
resolve_identity() {
    local explicit="${SPECTRA_CODESIGN_IDENTITY:-}"
    if [[ -n "$explicit" ]]; then
        echo "$explicit"
        return 0
    fi
    if [[ "${SPECTRA_STABLE_SIGNING:-1}" != "0" ]]; then
        # First "Developer ID Application: …" identity, if any (read-only).
        local dev_id
        dev_id="$(security find-identity -v -p codesigning 2>/dev/null \
            | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -n1)"
        if [[ -n "$dev_id" ]]; then
            echo "$dev_id"
            return 0
        fi
    fi
    echo "-"  # ad-hoc
}

IDENTITY="$(resolve_identity)"
# AUTO_DEVID=1 when we auto-detected a Developer ID identity (no explicit
# override) — a sign failure with it degrades gracefully to ad-hoc rather than
# hard-failing the build (honors "never auto-touch/hard-fail on the keychain").
AUTO_DEVID=0
if [[ -z "${SPECTRA_CODESIGN_IDENTITY:-}" && "$IDENTITY" == "Developer ID Application:"* ]]; then
    AUTO_DEVID=1
fi
if [[ "$IDENTITY" == "skip" ]]; then
    exit 0
fi

if [[ ! -e "$TARGET" ]]; then
    echo "codesign target does not exist: $TARGET" >&2
    exit 66
fi

if ! command -v codesign >/dev/null 2>&1; then
    echo "codesign not found; install Xcode Command Line Tools" >&2
    exit 69
fi

# Stable identifier: strip a leading `spectra-` so it reads dev.spectra.<slug>.
BASENAME="$(basename "$TARGET")"
SLUG="${BASENAME#spectra-}"
IDENTIFIER="dev.spectra.$SLUG"

# INSTALL GUARD: capture the identity currently on disk BEFORE we overwrite it.
PREV_IDENTIFIER=""
PREV_TEAM=""
if [[ -e "$TARGET" ]]; then
    PREV_DESC="$(codesign -dvv "$TARGET" 2>&1 || true)"
    PREV_IDENTIFIER="$(printf '%s\n' "$PREV_DESC" | sed -n 's/^Identifier=//p' | head -n1)"
    PREV_TEAM="$(printf '%s\n' "$PREV_DESC" | sed -n 's/^TeamIdentifier=//p' | head -n1)"
fi

entitlement_args=()
if [[ -n "${SPECTRA_CODESIGN_ENTITLEMENTS:-}" ]]; then
    entitlement_args=(--entitlements "$SPECTRA_CODESIGN_ENTITLEMENTS")
fi

sign_with() {
    # ${arr[@]+"${arr[@]}"} — expand only when set, so an empty array is safe
    # under `set -u` on macOS's bash 3.2.
    codesign --force --timestamp=none --options runtime \
        -i "$IDENTIFIER" ${entitlement_args[@]+"${entitlement_args[@]}"} --sign "$1" "$TARGET"
}

if ! sign_with "$IDENTITY"; then
    if [[ "$AUTO_DEVID" == "1" ]]; then
        # Developer ID signing failed (unauthorized ACL / denied prompt / restricted
        # keychain). Fall back to ad-hoc with the SAME stable identifier so the build
        # never hard-fails; TCC grants are then cdhash-pinned until an identity is wired.
        echo "codesign: Developer ID signing failed for $BASENAME; falling back to ad-hoc (stable identifier kept)." >&2
        sign_with "-"
    else
        exit 1
    fi
fi
codesign --verify --strict "$TARGET"

NEW_DESC="$(codesign -dvv "$TARGET" 2>&1 || true)"
NEW_IDENTIFIER="$(printf '%s\n' "$NEW_DESC" | sed -n 's/^Identifier=//p' | head -n1)"
NEW_TEAM="$(printf '%s\n' "$NEW_DESC" | sed -n 's/^TeamIdentifier=//p' | head -n1)"

# INSTALL GUARD: warn + mark when the identity changed and a grant existed.
if [[ -n "$PREV_IDENTIFIER" && ( "$PREV_IDENTIFIER" != "$NEW_IDENTIFIER" || "$PREV_TEAM" != "$NEW_TEAM" ) ]]; then
    if [[ -f "$GRANTS_FILE" ]]; then
        echo "⚠️  Spectra: $BASENAME signing identity changed ($PREV_IDENTIFIER → $NEW_IDENTIFIER). Remove old Spectra entries in System Settings › Privacy & Security and re-grant Screen Recording / Accessibility." >&2
        mkdir -p "$(dirname "$REGRANT_MARKER")"
        printf '{\n  "reason": "signing identity changed on install",\n  "helper": "%s",\n  "previousIdentifier": "%s",\n  "newIdentifier": "%s",\n  "createdAt": "%s"\n}\n' \
            "$BASENAME" "$PREV_IDENTIFIER" "$NEW_IDENTIFIER" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$REGRANT_MARKER"
    fi
fi
