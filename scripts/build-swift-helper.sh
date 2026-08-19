#!/usr/bin/env bash
# Build and ad-hoc sign one Swift command-line helper.
#
# Development builds target the current host architecture. Release packaging
# sets SPECTRA_UNIVERSAL_HELPERS=1 so every embedded helper matches the
# universal Spectra.app executable (arm64 + x86_64).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-}"
if [[ -z "$OUTPUT" || "$#" -lt 2 ]]; then
    echo "usage: scripts/build-swift-helper.sh <output> <swift sources/options...>" >&2
    exit 64
fi
shift

if [[ "$(uname -s 2>/dev/null || echo unknown)" != "Darwin" ]]; then
    echo "build-swift-helper: macOS-only (swiftc + lipo)" >&2
    exit 1
fi
if ! command -v swiftc >/dev/null 2>&1; then
    echo "build-swift-helper: swiftc not found; install Xcode Command Line Tools" >&2
    exit 69
fi

mkdir -p "$(dirname "$OUTPUT")"

if [[ "${SPECTRA_UNIVERSAL_HELPERS:-0}" == "1" ]]; then
    if ! command -v lipo >/dev/null 2>&1; then
        echo "build-swift-helper: lipo is required for universal helpers" >&2
        exit 69
    fi
    DEPLOYMENT_TARGET="${SPECTRA_MACOS_DEPLOYMENT_TARGET:-14.0}"
    TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/spectra-universal-helper.XXXXXX")"
    trap 'rm -rf "$TEMP_DIR"' EXIT

    swiftc -target "arm64-apple-macos$DEPLOYMENT_TARGET" "$@" -o "$TEMP_DIR/arm64"
    swiftc -target "x86_64-apple-macos$DEPLOYMENT_TARGET" "$@" -o "$TEMP_DIR/x86_64"
    lipo -create "$TEMP_DIR/arm64" "$TEMP_DIR/x86_64" -output "$OUTPUT"
    lipo "$OUTPUT" -verify_arch arm64 x86_64
else
    swiftc "$@" -o "$OUTPUT"
fi

bash "$REPO_ROOT/scripts/codesign-native.sh" "$OUTPUT"
