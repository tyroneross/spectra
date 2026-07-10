#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_RAW="$(mktemp -d "${TMPDIR:-/tmp}/spectra-helper-packaging.XXXXXX")"
TMP="$(cd "$TMP_RAW" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

BIN="$TMP/bin"
DEST="$TMP/Spectra.app/Contents/Helpers"
FAKE_BIN="$TMP/fake-bin"
CODESIGN_LOG="$TMP/codesign.log"
mkdir -p "$BIN" "$DEST" "$FAKE_BIN"

HELPERS=(
    spectra-daemon-core
    spectra-daemon-launcher
    spectra-native
    spectra-composite-capture
    spectra-screen-recording-preflight
    spectra-cursor-sampler
    spectra-window-bounds
    spectra-text-render
)

for helper in "${HELPERS[@]}"; do
    printf '#!/bin/sh\nexit 0\n' > "$BIN/$helper"
    chmod +x "$BIN/$helper"
done

# shellcheck disable=SC2016
printf '#!/bin/sh\nif [ "${SPECTRA_TEST_CODESIGN_FAIL:-0}" = "1" ]; then exit 73; fi\nprintf "%%s\\n" "$*" >> "$SPECTRA_TEST_CODESIGN_LOG"\n' > "$FAKE_BIN/codesign"
chmod +x "$FAKE_BIN/codesign"

SPECTRA_REQUIRE_BUNDLED_HELPERS=1 \
CODE_SIGNING_ALLOWED=NO \
make -s -C "$ROOT/macos" embed-helpers \
    SPECTRA_BIN_DIR="$BIN" \
    SPECTRA_EMBED_DEST="$DEST"

for helper in "${HELPERS[@]}"; do
    test -x "$DEST/$helper"
done

# Signing-enabled embedding signs every nested helper before the outer app's
# later Xcode code-sign step.
rm -rf "$DEST"
mkdir -p "$DEST"
PATH="$FAKE_BIN:$PATH" \
SPECTRA_TEST_CODESIGN_LOG="$CODESIGN_LOG" \
SPECTRA_REQUIRE_BUNDLED_HELPERS=1 \
CODE_SIGNING_ALLOWED=YES \
EXPANDED_CODE_SIGN_IDENTITY=test-identity \
make -s -C "$ROOT/macos" embed-helpers \
    SPECTRA_BIN_DIR="$BIN" \
    SPECTRA_EMBED_DEST="$DEST" >/dev/null
[[ "$(wc -l < "$CODESIGN_LOG" | tr -d ' ')" == "${#HELPERS[@]}" ]]
rg -q -- '--options runtime --sign test-identity' "$CODESIGN_LOG"

# A nested signing failure must fail the enclosing Make/Xcode phase.
rm -rf "$DEST"
mkdir -p "$DEST"
if PATH="$FAKE_BIN:$PATH" \
    SPECTRA_TEST_CODESIGN_LOG="$CODESIGN_LOG" \
    SPECTRA_TEST_CODESIGN_FAIL=1 \
    SPECTRA_REQUIRE_BUNDLED_HELPERS=1 \
    CODE_SIGNING_ALLOWED=YES \
    EXPANDED_CODE_SIGN_IDENTITY=test-identity \
    make -s -C "$ROOT/macos" embed-helpers \
        SPECTRA_BIN_DIR="$BIN" \
        SPECTRA_EMBED_DEST="$DEST" >"$TMP/codesign-failure.log" 2>&1; then
    echo "helper embedding swallowed a nested codesign failure" >&2
    exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
rm -f "$BIN/spectra-cursor-sampler"

if SPECTRA_REQUIRE_BUNDLED_HELPERS=1 \
    CODE_SIGNING_ALLOWED=NO \
    make -s -C "$ROOT/macos" embed-helpers \
        SPECTRA_BIN_DIR="$BIN" \
        SPECTRA_EMBED_DEST="$DEST" >"$TMP/missing.log" 2>&1; then
    echo "expected strict helper embedding to fail when cursor sampler is absent" >&2
    exit 1
fi
rg -q 'required helper inventory incomplete:.*spectra-cursor-sampler' "$TMP/missing.log"

# An executable symlink is not a valid production helper boundary.
ln -s "$BIN/spectra-native" "$BIN/spectra-cursor-sampler"
rm -rf "$DEST"
mkdir -p "$DEST"
if SPECTRA_REQUIRE_BUNDLED_HELPERS=1 \
    CODE_SIGNING_ALLOWED=NO \
    make -s -C "$ROOT/macos" embed-helpers \
        SPECTRA_BIN_DIR="$BIN" \
        SPECTRA_EMBED_DEST="$DEST" >"$TMP/symlink.log" 2>&1; then
    echo "strict helper embedding accepted an executable symlink" >&2
    exit 1
fi
rg -q 'MISSING or unsafe spectra-cursor-sampler' "$TMP/symlink.log"

# A pre-existing destination symlink must never redirect the copy outside the
# app bundle.
rm -f "$BIN/spectra-cursor-sampler"
printf '#!/bin/sh\nexit 0\n' > "$BIN/spectra-cursor-sampler"
chmod +x "$BIN/spectra-cursor-sampler"
rm -rf "$DEST"
mkdir -p "$DEST"
OUTSIDE="$TMP/outside-native"
printf 'outside-must-not-change\n' > "$OUTSIDE"
ln -s "$OUTSIDE" "$DEST/spectra-native"
if SPECTRA_REQUIRE_BUNDLED_HELPERS=1 \
    CODE_SIGNING_ALLOWED=NO \
    make -s -C "$ROOT/macos" embed-helpers \
        SPECTRA_BIN_DIR="$BIN" \
        SPECTRA_EMBED_DEST="$DEST" >"$TMP/destination-symlink.log" 2>&1; then
    echo "strict helper embedding accepted a destination symlink" >&2
    exit 1
fi
[[ "$(cat "$OUTSIDE")" == 'outside-must-not-change' ]]
rg -q 'UNSAFE existing destination.*spectra-native' "$TMP/destination-symlink.log"

# A symlink anywhere in the destination directory chain must not redirect the
# complete inventory outside the app bundle.
rm -rf "$DEST"
REAL_APP="$TMP/real/Spectra.app"
mkdir -p "$REAL_APP/Contents/Helpers"
ln -s "$REAL_APP" "$TMP/Alias.app"
if SPECTRA_REQUIRE_BUNDLED_HELPERS=1 \
    CODE_SIGNING_ALLOWED=NO \
    make -s -C "$ROOT/macos" embed-helpers \
        SPECTRA_BIN_DIR="$BIN" \
        SPECTRA_EMBED_DEST="$TMP/Alias.app/Contents/Helpers" >"$TMP/destination-directory-symlink.log" 2>&1; then
    echo "strict helper embedding accepted a symlinked destination directory chain" >&2
    exit 1
fi
rg -q 'destination path contains a symlink' "$TMP/destination-directory-symlink.log"
test -z "$(find "$REAL_APP/Contents/Helpers" -mindepth 1 -print -quit)"

# A symlinked source directory is equally unsafe: helper-level lstat checks
# cannot prove where the inventory originated.
rm -f "$TMP/Alias.app"
mv "$BIN" "$TMP/real-bin"
ln -s "$TMP/real-bin" "$BIN"
mkdir -p "$DEST"
if SPECTRA_REQUIRE_BUNDLED_HELPERS=1 \
    CODE_SIGNING_ALLOWED=NO \
    make -s -C "$ROOT/macos" embed-helpers \
        SPECTRA_BIN_DIR="$BIN" \
        SPECTRA_EMBED_DEST="$DEST" >"$TMP/source-directory-symlink.log" 2>&1; then
    echo "strict helper embedding accepted a symlinked source directory" >&2
    exit 1
fi
rg -q 'source path contains a symlink' "$TMP/source-directory-symlink.log"

echo "helper packaging contract: inventory, signing, missing, and file/directory symlink cases passed"
