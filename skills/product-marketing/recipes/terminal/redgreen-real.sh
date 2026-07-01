#!/usr/bin/env bash
# redgreen-real.sh — a REAL test suite going FAIL -> real edit -> GREEN.
#
# Scaffolds a tiny pagination utility with a genuine off-by-one bug in a
# throwaway dir, runs vitest (RED), applies a real one-line fix, re-runs
# vitest (GREEN). No toy sum.js — a realistic multi-test module with an
# assertion diff a viewer can actually read.
#
# Usage:
#   ./redgreen-real.sh [workdir]
#
# If no workdir is given, a fresh temp dir is created and printed at the end
# (safe to delete). Re-runnable: each invocation starts from a clean dir.
set -euo pipefail
export FORCE_COLOR=1

WORKDIR="${1:-$(mktemp -d -t spectra-redgreen)}"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

beat() {
  printf '\n\033[1;36m▸ %s\033[0m\n' "$1"
  sleep "${2:-0.9}"
}

beat "Real repo: a pagination helper with 4 tests" 1.8

cat > package.json <<'EOF'
{ "name": "redgreen-demo", "private": true, "type": "module" }
EOF

# A pagination helper with a genuine off-by-one bug in hasNextPage().
cat > pagination.js <<'EOF'
export function paginate(items, pageSize, pageNumber) {
  const start = (pageNumber - 1) * pageSize;
  const end = start + pageSize;
  return items.slice(start, end);
}

export function hasNextPage(totalItems, pageSize, currentPage) {
  const totalPages = Math.ceil(totalItems / pageSize);
  // BUG: off-by-one — should be `currentPage < totalPages`.
  return currentPage < totalPages - 1;
}
EOF

cat > pagination.test.js <<'EOF'
import { describe, it, expect } from 'vitest';
import { paginate, hasNextPage } from './pagination.js';

const items = ['a', 'b', 'c', 'd', 'e'];

describe('paginate', () => {
  it('returns the first page (page 1)', () => {
    expect(paginate(items, 2, 1)).toEqual(['a', 'b']);
  });
  it('returns the second page (page 2)', () => {
    expect(paginate(items, 2, 2)).toEqual(['c', 'd']);
  });
  it('returns a partial last page (page 3)', () => {
    expect(paginate(items, 2, 3)).toEqual(['e']);
  });
  it('knows page 2 of 3 still has a next page', () => {
    expect(hasNextPage(5, 2, 2)).toBe(true);
  });
});
EOF

beat "$ npx vitest run" 1.0
npx --yes vitest run --color || true

beat "One real failure: hasNextPage() off-by-one on the page boundary" 3.5
beat "Fixing pagination.js (currentPage < totalPages - 1  ->  currentPage < totalPages)" 3.0

python3 - <<'PY'
p = "pagination.js"
s = open(p).read()
s = s.replace(
    "return currentPage < totalPages - 1;",
    "return currentPage < totalPages;",
)
open(p, "w").write(s)
PY

beat "$ npx vitest run" 1.0
npx --yes vitest run --color

beat "GREEN — 4/4 passing. Workdir: $WORKDIR" 2.5
