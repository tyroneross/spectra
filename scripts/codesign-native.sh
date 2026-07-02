#!/usr/bin/env bash
#
# Sign Spectra's local native helpers.
#
# GUARDRAIL: the DEFAULT is AD-HOC signing (`--sign -`), which needs NO keychain
# and never prompts — ad-hoc-signed binaries run fine for local dev/automation.
# A real Apple Development / Developer ID identity is used ONLY when the user
# explicitly sets SPECTRA_CODESIGN_IDENTITY (for a release/notarize build). Agents
# must not sign with the user's Apple identity automatically. SPECTRA_CODESIGN=0
# skips signing entirely.

set -euo pipefail

DEFAULT_IDENTITY="-"  # ad-hoc; set SPECTRA_CODESIGN_IDENTITY="Apple Development: …" for release
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
