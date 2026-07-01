#!/usr/bin/env bash
# plugin-in-action.sh — a REAL linter flags a real bug, then fixes it.
#
# Lightweight, dependency-free stand-in for "a plugin/tool doing something
# visible": ESLint (via npx, core rules only — no config package needed)
# flags an unused variable and a `==` vs `===` bug in a real file, then a
# real edit clears both and a re-run proves 0 problems.
#
# Swap the "tool" section below for any other lightweight, visible tool
# (a codegen script, a formatter, a schema validator) using the same
# flag -> fix -> re-verify shape.
#
# Usage:
#   ./plugin-in-action.sh [workdir]
set -euo pipefail
export FORCE_COLOR=1

WORKDIR="${1:-$(mktemp -d -t spectra-lintdemo)}"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

beat() {
  printf '\n\033[1;36m▸ %s\033[0m\n' "$1"
  sleep "${2:-0.9}"
}

beat "A real file with two real issues" 1.8

cat > package.json <<'EOF'
{ "name": "lint-demo", "private": true, "type": "module" }
EOF

# Core ESLint rules only — no @eslint/js or other config package required.
cat > eslint.config.js <<'EOF'
export default [
  {
    rules: {
      'no-unused-vars': 'error',
      eqeqeq: 'error',
    },
  },
];
EOF

cat > greet.js <<'EOF'
function greet(name) {
  const unusedGreeting = 'howdy';
  if (name == null) {
    return 'Hello, stranger!';
  }
  return `Hello, ${name}!`;
}

console.log(greet('Spectra'));
EOF

beat "$ npx eslint greet.js" 1.2
npx --yes eslint greet.js || true

beat "Real fix: drop the dead variable, use ===" 4.5

cat > greet.js <<'EOF'
function greet(name) {
  if (name === null) {
    return 'Hello, stranger!';
  }
  return `Hello, ${name}!`;
}

console.log(greet('Spectra'));
EOF

beat "$ npx eslint greet.js" 1.2
npx --yes eslint greet.js && printf '\033[32m0 problems\033[0m\n'

beat "$ node greet.js" 1.2
node greet.js

beat "Real lint pass, real run. Workdir: $WORKDIR" 2.5
