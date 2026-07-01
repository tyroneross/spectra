#!/usr/bin/env bash
# build-and-run.sh — a REAL TypeScript build, then run the built CLI.
#
# Scaffolds a one-file TS tool (a slugify CLI) in a throwaway dir, builds it
# with the real TypeScript compiler via npx, then runs the compiled output
# and shows real, colored, computed output — not a mock.
#
# Usage:
#   ./build-and-run.sh [workdir]
set -euo pipefail
export FORCE_COLOR=1

WORKDIR="${1:-$(mktemp -d -t spectra-buildrun)}"
mkdir -p "$WORKDIR/src"
cd "$WORKDIR"

beat() {
  printf '\n\033[1;36m▸ %s\033[0m\n' "$1"
  sleep "${2:-0.9}"
}

beat "A one-file TypeScript CLI: slugify" 3.0

cat > package.json <<'EOF'
{
  "name": "slugify-cli",
  "private": true,
  "type": "module"
}
EOF

cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true
  },
  "include": ["src"]
}
EOF

cat > src/cli.ts <<'EOF'
declare const process: { argv: string[]; exit(code?: number): void };

const input = process.argv.slice(2).join(' ');

if (!input) {
  console.error('Usage: slugify <text>');
  process.exit(1);
}

const slug = input
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

console.log(`\x1b[2minput:\x1b[0m  ${input}`);
console.log(`\x1b[32mslug:\x1b[0m   ${slug}`);
EOF

beat "$ npx tsc -p ." 2.5
npx --yes -p typescript tsc -p .

beat "Build passed. Running the compiled CLI:" 3.5
beat '$ node dist/cli.js "Spectra Ships Real Demos!"' 1.5
node dist/cli.js "Spectra Ships Real Demos!"

beat "Real output from a real build. Workdir: $WORKDIR" 3.0
