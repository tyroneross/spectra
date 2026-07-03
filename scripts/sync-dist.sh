#!/usr/bin/env bash
#
# Propagate the freshly-built dist/ to the running daemon's home
# (~/.spectra/dist) so `npm run build` reaches the launchd daemon without a
# manual rsync. Dev convenience: ONLY mirrors when ~/.spectra already exists
# (i.e. Spectra is installed) — never creates it, so this is a no-op on a clean
# checkout and can't surprise a fresh install. Mirrors the logic in
# postinstall.sh §2 (single source of behavior: dist + package.json + node_modules link).
#
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPECTRA_HOME="$HOME/.spectra"

# No-op when Spectra isn't installed (clean checkout / CI).
[[ -d "$SPECTRA_HOME" ]] || { exit 0; }
[[ -d "$REPO_ROOT/dist" ]] || { echo "sync-dist: no dist/ to sync (run npm run build first)"; exit 0; }

if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$REPO_ROOT/dist/" "$SPECTRA_HOME/dist/"
else
    rm -rf "$SPECTRA_HOME/dist"
    cp -R "$REPO_ROOT/dist" "$SPECTRA_HOME/dist"
fi
cp "$REPO_ROOT/package.json" "$SPECTRA_HOME/package.json" 2>/dev/null || true
if [[ -d "$REPO_ROOT/node_modules" ]]; then
    # -sfn: idempotent — force-replace an existing or BROKEN symlink without
    # dereferencing it (plain `ln -s` fails "File exists" on a stale link,
    # which under `set -e` aborted flip-g1's dist-mirror step at Gate E).
    ln -sfn "$REPO_ROOT/node_modules" "$SPECTRA_HOME/node_modules"
fi
echo "sync-dist: mirrored dist/ -> $SPECTRA_HOME/dist/ (restart the daemon to load: spectra daemon restart)"
