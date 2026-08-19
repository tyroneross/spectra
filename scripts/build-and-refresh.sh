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
# (c) 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

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

# Helper prebuilds never use a keychain identity. Xcode re-signs every nested
# helper with the selected app identity during the enclosing build phase.
export SPECTRA_CODESIGN_IDENTITY="-"

EXPORT_APP="$MACOS_DIR/build/dmg-staging/$APP_NAME.app"
RELEASE_DMG="$MACOS_DIR/release/$APP_NAME.dmg"

echo "==> 1. Build complete ad-hoc helper inventory"
export SPECTRA_UNIVERSAL_HELPERS=1
( cd "$REPO_ROOT" && npm run build:native )
( cd "$REPO_ROOT" && npm run build:daemon-helper )
( cd "$REPO_ROOT" && npm run build:composite )
( cd "$REPO_ROOT" && npm run build:cursor-sampler )
( cd "$REPO_ROOT" && npm run build:window-bounds )
( cd "$REPO_ROOT" && npm run build:text-render )
bash "$REPO_ROOT/scripts/build-daemon-core.sh"

echo "==> 2. xcodegen (idempotent — regenerates xcodeproj from project.yml)"
( cd "$MACOS_DIR" && xcodegen generate )

echo "==> 3. Build + DMG ($MODE, strict helper inventory)"
if [[ "$MODE" == "signed" ]]; then
    SPECTRA_REQUIRE_BUNDLED_HELPERS=1 make -C "$MACOS_DIR" dmg
else
    SPECTRA_REQUIRE_BUNDLED_HELPERS=1 make -C "$MACOS_DIR" dmg-adhoc
fi

echo "==> 4. Verify built Release bundle before replacing artifacts"
if [[ ! -d "$EXPORT_APP" ]]; then
    echo "ERROR: expected exported app missing at $EXPORT_APP" >&2
    exit 1
fi
SPECTRA_EXPECTED_SIGNING_MODE="$MODE" \
    bash "$REPO_ROOT/tests/macos/release-bundle-contract.sh" "$EXPORT_APP"

echo "==> 5. Refresh top-level $APP_NAME.app"
rm -rf "$TOP_APP"
cp -R "$EXPORT_APP" "$TOP_APP"

echo "==> 6. Refresh top-level $APP_NAME.dmg"
if [[ ! -f "$RELEASE_DMG" ]]; then
    echo "ERROR: expected dmg missing at $RELEASE_DMG" >&2
    exit 1
fi
rm -f "$TOP_DMG"
cp "$RELEASE_DMG" "$TOP_DMG"

echo "==> 7. Verify refreshed app"
SPECTRA_EXPECTED_SIGNING_MODE="$MODE" \
    bash "$REPO_ROOT/tests/macos/release-bundle-contract.sh" "$TOP_APP"

echo
echo "Top-level artifacts refreshed:"
printf '   %s\n' "$TOP_APP" "$TOP_DMG"
