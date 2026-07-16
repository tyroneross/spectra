#!/usr/bin/env bash
# Install spectra's tracked git hooks (scripts/git-hooks/*) into .git/hooks.
#
# Copy-install (not core.hooksPath): this repo already carries per-machine
# hooks installed by other tools (build-loop pre-commit, plugin-sync
# post-commit) in .git/hooks — switching hooksPath would silently disable
# them. Copying only OUR hook names, guarded by a marker line, coexists.
#
# Idempotent; re-run any time. Also invoked from scripts/postinstall.sh on
# dev checkouts (where .git exists), so a plain `npm install` wires the hooks.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_SRC="$REPO_ROOT/scripts/git-hooks"
GIT_DIR="$(cd "$REPO_ROOT" && git rev-parse --git-dir 2>/dev/null || true)"
[[ -n "$GIT_DIR" ]] || { echo "install-git-hooks: not a git checkout; nothing to do"; exit 0; }
HOOKS_DST="$REPO_ROOT/$GIT_DIR/hooks"
[[ -d "$HOOKS_DST" ]] || HOOKS_DST="$GIT_DIR/hooks"   # absolute git-dir
mkdir -p "$HOOKS_DST"

MARKER="spectra-managed"
for src in "$HOOKS_SRC"/*; do
    name="$(basename "$src")"
    dst="$HOOKS_DST/$name"
    if [[ -e "$dst" ]] && ! grep -q "$MARKER" "$dst"; then
        echo "install-git-hooks: SKIP $name — a foreign hook exists at $dst (merge manually)" >&2
        continue
    fi
    cp "$src" "$dst"
    chmod +x "$dst"
    echo "install-git-hooks: installed $name -> $dst"
done
