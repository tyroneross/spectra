#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DERIVED="${SPECTRA_XCODE_CONTRACT_DERIVED:-/tmp/spectra-m1-info-plist-derived}"

SPECTRA_XCODE_CONTRACT_DERIVED="$DERIVED" \
    "$ROOT/tests/macos/xcodegen-target-isolation.sh" >/dev/null

INFO="$DERIVED/Build/Products/Debug/Spectra.app/Contents/Info.plist"
test -f "$INFO"
VALUE="$(/usr/libexec/PlistBuddy -c 'Print :NSAudioCaptureUsageDescription' "$INFO")"
if [[ -z "${VALUE//[[:space:]]/}" ]]; then
    echo "built app has an empty NSAudioCaptureUsageDescription" >&2
    exit 1
fi

echo "Info.plist privacy contract: built app declares system-audio purpose"
