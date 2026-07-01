#!/usr/bin/env bash
# git-workflow.sh — a REAL git flow: status -> stage -> commit -> log -> diff -> commit.
#
# Runs against a throwaway git repo (never the calling repo), so it's safe to
# run repeatedly. Shows actual repo work: an untracked file, a first commit,
# a real edit, a real diff, and a second commit landing in the log.
#
# Usage:
#   ./git-workflow.sh [workdir]
set -euo pipefail

WORKDIR="${1:-$(mktemp -d -t spectra-gitflow)}"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

beat() {
  printf '\n\033[1;36m▸ %s\033[0m\n' "$1"
  sleep "${2:-0.9}"
}

beat "New repo, real file, nothing committed yet" 1.5
git init -q
git config user.email "demo@spectra.local"
git config user.name "Spectra Demo"

cat > README.md <<'EOF'
# Spectra Demo Project

A tiny project used to record a real git workflow.
EOF

beat "$ git status" 1.2
git status

beat "$ git add README.md && git commit" 1.8
git add README.md
git -c color.ui=always commit -m "Initial commit: add README"

beat "$ git log --oneline" 1.5
git -c color.ui=always --no-pager log --oneline --color=always

beat "Real edit: add a Usage section" 2.0
cat >> README.md <<'EOF'

## Usage
Run `./demo.sh` to see it in action.
EOF

beat "$ git status" 1.2
git -c color.ui=always status

beat "$ git diff" 1.5
git -c color.ui=always --no-pager diff --color=always

beat "$ git add README.md && git commit" 1.8
git add README.md
git -c color.ui=always commit -m "docs: add usage section"

beat "$ git log --oneline" 1.5
git -c color.ui=always --no-pager log --oneline --color=always

beat "Two real commits landed. Workdir: $WORKDIR" 2.0
