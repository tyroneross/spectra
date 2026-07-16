#!/usr/bin/env bash
#
# Plugin postinstall — runs when `spectra` plugin is installed via the
# Claude marketplace. Two responsibilities:
#
# 1. If /Applications/Spectra.app is missing AND a Spectra.dmg sits at the
#    plugin root, open the DMG so the user can drag-install. Idempotent —
#    if /Applications/Spectra.app already exists, do nothing.
#
# 2. Mirror the compiled daemon into ~/.spectra/dist/ so the launchd
#    LaunchAgent (C4) can run it without resolving paths relative to a
#    plugin-cache directory that gets wiped on plugin updates.
#
# Safe to re-run.
#
# SPDX-License-Identifier: Apache-2.0
# (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

set -eu

# Non-macOS hosts: nothing to do. Stay silent so CI doesn't get noisy.
if [[ "$(uname -s 2>/dev/null || echo unknown)" != "Darwin" ]]; then
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_INSTALLED="/Applications/Spectra.app"
DMG_PATH="$PLUGIN_ROOT/Spectra.dmg"
SPECTRA_HOME="$HOME/.spectra"

# 1. App install prompt.
# Only fires under the marketplace plugin-install path, signalled by
# CLAUDE_PLUGIN_INSTALL=1 in the environment (set by the plugin manager).
# In the dev `npm install` path, no env var → no DMG window opens.
if [[ "${CLAUDE_PLUGIN_INSTALL:-}" == "1" ]] && [[ ! -d "$APP_INSTALLED" ]]; then
    if [[ -f "$DMG_PATH" ]]; then
        echo "Spectra.app not found in /Applications. Opening DMG for drag-install…"
        open "$DMG_PATH" 2>/dev/null || echo "(could not open DMG; install manually from $DMG_PATH)"
    else
        echo "Spectra.app not installed and no DMG bundled in plugin. Run 'npm run build:dmg' from the spectra repo to build one."
    fi
fi

# 2. Mirror dist/ to ~/.spectra/dist so launchd doesn't depend on plugin cache path
if [[ -d "$PLUGIN_ROOT/dist" ]]; then
    mkdir -p "$SPECTRA_HOME"
    # Use rsync if available for atomicity; cp otherwise.
    if command -v rsync >/dev/null 2>&1; then
        rsync -a --delete "$PLUGIN_ROOT/dist/" "$SPECTRA_HOME/dist/"
    else
        rm -rf "$SPECTRA_HOME/dist"
        cp -R "$PLUGIN_ROOT/dist" "$SPECTRA_HOME/dist"
    fi
    if [[ -f "$PLUGIN_ROOT/package.json" ]]; then
        cp "$PLUGIN_ROOT/package.json" "$SPECTRA_HOME/package.json"
    fi
    if [[ -d "$PLUGIN_ROOT/node_modules" ]]; then
        rm -rf "$SPECTRA_HOME/node_modules"
        ln -s "$PLUGIN_ROOT/node_modules" "$SPECTRA_HOME/node_modules"
    fi
    echo "Mirrored daemon dist/ to $SPECTRA_HOME/dist/"
fi

# 3. Dev checkouts only: install tracked git hooks (pre-push dist rebuild).
#    No-op on plugin-cache installs, which have no .git.
if [[ -d "$PLUGIN_ROOT/.git" && -x "$PLUGIN_ROOT/scripts/install-git-hooks.sh" ]]; then
    bash "$PLUGIN_ROOT/scripts/install-git-hooks.sh" || true
fi
