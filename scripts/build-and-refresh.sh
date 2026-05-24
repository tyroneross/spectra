#!/usr/bin/env bash
#
# Build Spectra.app + Spectra.dmg and refresh BOTH at the spectra repo
# root. Mirrors ~/dev/git-folder/secrets-vault/scripts/build-and-refresh.sh.
#
# Default: signed build (requires Apple Development cert + Mac Development
# provisioning profile for dev.spectra.app).
#
# Pass --adhoc to ad-hoc-sign (runs locally; no Keychain biometric,
# breaks notarization; useful for development).
#
# SPDX-License-Identifier: Apache-2.0
# (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACOS_DIR="$REPO_ROOT/macos"
APP_NAME="Spectra"
TOP_APP="$REPO_ROOT/$APP_NAME.app"
TOP_DMG="$REPO_ROOT/$APP_NAME.dmg"

MODE="signed"
if [[ "${1:-}" == "--adhoc" ]]; then
    MODE="adhoc"
fi

EXPORT_APP="$MACOS_DIR/build/dmg-staging/$APP_NAME.app"
RELEASE_DMG="$MACOS_DIR/release/$APP_NAME.dmg"

echo "==> 1. xcodegen (idempotent — regenerates xcodeproj from project.yml)"
( cd "$MACOS_DIR" && xcodegen generate )

echo "==> 2. Build + DMG ($MODE)"
if [[ "$MODE" == "signed" ]]; then
    make -C "$MACOS_DIR" dmg
else
    make -C "$MACOS_DIR" dmg-adhoc
fi

echo "==> 3. Refresh top-level $APP_NAME.app"
if [[ ! -d "$EXPORT_APP" ]]; then
    echo "ERROR: expected exported app missing at $EXPORT_APP" >&2
    exit 1
fi
rm -rf "$TOP_APP"
cp -R "$EXPORT_APP" "$TOP_APP"

echo "==> 4. Refresh top-level $APP_NAME.dmg"
if [[ ! -f "$RELEASE_DMG" ]]; then
    echo "ERROR: expected dmg missing at $RELEASE_DMG" >&2
    exit 1
fi
rm -f "$TOP_DMG"
cp "$RELEASE_DMG" "$TOP_DMG"

echo "==> 5. Verify codesign"
if [[ "$MODE" == "signed" ]]; then
    if codesign --verify --deep --strict "$TOP_APP" 2>&1; then
        echo "    Signed: OK"
    else
        echo "    WARNING: codesign --verify --deep --strict failed."
        echo "    The Release build did not produce a signed bundle — likely"
        echo "    a missing Mac Development provisioning profile for"
        echo "    dev.spectra.app. Open Spectra.xcodeproj in Xcode once,"
        echo "    let it provision automatically, then re-run."
        exit 1
    fi
else
    echo "    Ad-hoc mode — codesign --verify --deep --strict is NOT"
    echo "    expected to pass against the Apple Developer trust roots."
fi

echo
echo "Top-level artifacts refreshed:"
ls -la "$TOP_APP" "$TOP_DMG" | awk '{print "   " $0}'
