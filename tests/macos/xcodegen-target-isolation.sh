#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/spectra-xcodegen-contract.XXXXXX")"
DERIVED="${SPECTRA_XCODE_CONTRACT_DERIVED:-/tmp/spectra-m1-xcode-contract-derived}"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/macos"
cp "$ROOT/macos/project.yml" "$ROOT/macos/Makefile" "$TMP/macos/"
cp -R "$ROOT/macos/Spectra" "$ROOT/macos/SpectraTests" "$TMP/macos/"

( cd "$TMP/macos" && xcodegen generate )

PBX="$TMP/macos/Spectra.xcodeproj/project.pbxproj"
if rg -q 'DaemonCore/main\.swift|verify-g[12]|verify-swift-op' "$PBX"; then
    echo "generated Spectra app project contains standalone DaemonCore entry/resources" >&2
    exit 1
fi
rg -q 'BundleHelperPaths\.swift' "$PBX"
if ! cmp -s "$PBX" "$ROOT/macos/Spectra.xcodeproj/project.pbxproj"; then
    echo "checked-in Spectra.xcodeproj is stale relative to project.yml" >&2
    diff -u "$ROOT/macos/Spectra.xcodeproj/project.pbxproj" "$PBX" | head -120 >&2 || true
    exit 1
fi

rm -rf "$DERIVED"
xcodebuild \
    -project "$TMP/macos/Spectra.xcodeproj" \
    -scheme Spectra \
    -configuration Debug \
    -destination 'platform=macOS' \
    -derivedDataPath "$DERIVED" \
    CODE_SIGNING_ALLOWED=NO \
    build-for-testing >/dev/null

test -d "$DERIVED/Build/Products/Debug/Spectra.app"
echo "xcodegen target isolation: DaemonCore excluded, resolver test source present, build succeeded"
