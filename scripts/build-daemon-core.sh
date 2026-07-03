#!/usr/bin/env bash
#
# Compile the Swift daemon-core (M3.G1 front door) to
# ~/.spectra/bin/spectra-daemon-core.
#
# This is the binary macos/Spectra/Daemon/LaunchAgentManager.swift's
# `dev.spectra.daemon` (front-door) LaunchAgent execs directly — install()
# refuses with an actionable error when this binary is missing, since the
# GUI never runs this script itself.
#
# GUARDRAIL: signing defaults to AD-HOC (--sign -, no keychain, no prompt) via
# scripts/codesign-native.sh. A real Apple Development / Developer ID identity
# is used ONLY when the caller explicitly sets SPECTRA_CODESIGN_IDENTITY.
#
# Usage:
#   bash scripts/build-daemon-core.sh
#   SPECTRA_CODESIGN_IDENTITY="Apple Development: …" bash scripts/build-daemon-core.sh
#
# SPDX-License-Identifier: Apache-2.0
# (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO_ROOT/macos/Spectra/DaemonCore"
BIN_DIR="$HOME/.spectra/bin"
OUT="$BIN_DIR/spectra-daemon-core"

if [[ "$(uname -s 2>/dev/null || echo unknown)" != "Darwin" ]]; then
    echo "build-daemon-core: macOS-only (swiftc + LaunchAgents), nothing to do here" >&2
    exit 1
fi

if [[ ! -d "$SRC_DIR" ]]; then
    echo "build-daemon-core: DaemonCore source not found at $SRC_DIR" >&2
    exit 1
fi

if ! command -v swiftc >/dev/null 2>&1; then
    echo "build-daemon-core: swiftc not found; install Xcode Command Line Tools" >&2
    exit 69
fi

mkdir -p "$BIN_DIR"

# Glob only *.swift — the DaemonCore dir also holds verify-g1-suite.ts and
# verify-swift-op.ts (TS oracle harnesses), which swiftc must never see.
shopt -s nullglob
SWIFT_SOURCES=("$SRC_DIR"/*.swift)
shopt -u nullglob

if [[ ${#SWIFT_SOURCES[@]} -eq 0 ]]; then
    echo "build-daemon-core: no .swift sources found in $SRC_DIR" >&2
    exit 1
fi

echo "build-daemon-core: compiling ${#SWIFT_SOURCES[@]} source file(s) -> $OUT"
swiftc "${SWIFT_SOURCES[@]}" \
    -framework Foundation \
    -framework AppKit \
    -framework ApplicationServices \
    -framework CoreGraphics \
    -o "$OUT"

bash "$REPO_ROOT/scripts/codesign-native.sh" "$OUT"

echo "build-daemon-core: built $OUT"
