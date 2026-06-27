#!/usr/bin/env bash
#
# Sign Spectra's local native helpers with a stable development identity.
# Override with SPECTRA_CODESIGN_IDENTITY; set SPECTRA_CODESIGN=0 to skip.

set -euo pipefail

DEFAULT_IDENTITY="Apple Development: tyrone.ross@icloud.com (7AK2KDLAVP)"
TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
    echo "usage: scripts/codesign-native.sh <mach-o-or-app>" >&2
    exit 64
fi

if [[ "${SPECTRA_CODESIGN:-1}" == "0" ]]; then
    exit 0
fi

IDENTITY="${SPECTRA_CODESIGN_IDENTITY:-$DEFAULT_IDENTITY}"
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

args=(--force --timestamp=none --options runtime --sign "$IDENTITY")
if [[ -n "${SPECTRA_CODESIGN_ENTITLEMENTS:-}" ]]; then
    args+=(--entitlements "$SPECTRA_CODESIGN_ENTITLEMENTS")
fi
args+=("$TARGET")

codesign "${args[@]}"
codesign --verify --strict "$TARGET"
