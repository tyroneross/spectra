#!/usr/bin/env bash
#
# macos/Spectra/DaemonCore/verify-g2-ondevice.sh
#
# M3.G2 (S7) — V-C, the on-device native-integration gate (T-25, plan
# "docs/plans/m3-g2-plan.md" §Verification design). USER-PRESENT, SCRIPTED,
# run ONCE before the flip commit (C10). This is a SCAFFOLD authored by S7 —
# it is NOT executed by S7; Opus runs it WITH the user present, per the
# handoff's acceptance sequence.
#
# STATUS: authored against the frozen DriverProtocol.swift + the G2 plan,
# BEFORE S1-S6's Swift implementations land. Several exact op params below
# (the TestApp target string in particular) are marked `TODO: Iteration 2` —
# confirm/adjust once S1 (ConnectOps.swift target-resolution) and S2
# (NativeDriver app-lookup) exist.
#
# Step 1 (the TCC-attribution spike, PC-2 in the plan) is the one step that
# MUST run under the PRODUCTION launchd context, not a dev shell — TCC
# attribution keys on parent process chain / responsible process / code
# signature, and a Terminal-launched dev-shell process does not carry the
# same attribution as a launchd-spawned one. This script therefore installs
# a REAL LaunchAgent (via `launchctl bootstrap`) rather than just `spawn`ing
# the binary — the ONE thing this script must never do is fall back to a
# plain background `&` spawn for step 1 and call it equivalent.
#
# Safety (CLAUDE.md: never auto-touch the real production install/keychain):
#   - DEFAULT mode installs a TEST-LABELED LaunchAgent
#     (dev.spectra.daemon-g2-tccspike[-ts]) at a DEDICATED path under
#     ~/.spectra-g2-ondevice/ — it NEVER touches the real
#     dev.spectra.daemon[-ts] LaunchAgents or the real ~/.spectra/bin
#     binaries (LaunchAgentManager.swift's own production paths).
#   - `--production` mode installs at the REAL dev.spectra.daemon path/label
#     (the strongest TCC-attribution evidence, since grants are per-code-
#     signature/per-path per ADR-05) — gated behind an interactive
#     confirmation prompt, since it can interact with a real running daemon.
#   - Codesigning uses scripts/codesign-native.sh's existing ad-hoc default
#     (SPECTRA_CODESIGN_IDENTITY is NEVER set by this script) — never
#     prompts, never touches the login keychain.
#   - Teardown always runs (`trap ... EXIT`), bootout-ing whatever this
#     script itself bootstrapped, even on a failed/interrupted run.
#
# Evidence: every step appends a red/green line to
#   .build-loop/flip-evidence/gate-g2-ondevice.txt
# Step 1 specifically also writes
#   .build-loop/flip-evidence/gate-g2-tcc-spike.txt
# (S2/S4's own success-path acceptance is CONDITIONAL on that file being
# green — plan §TCC spike).
#
# Usage:
#   macos/Spectra/DaemonCore/verify-g2-ondevice.sh [--production] [--keep-running] [--skip-build]
#
# SPDX-License-Identifier: Apache-2.0
# © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/.build-loop/flip-evidence"
EVIDENCE_FILE="$EVIDENCE_DIR/gate-g2-ondevice.txt"
TCC_SPIKE_EVIDENCE_FILE="$EVIDENCE_DIR/gate-g2-tcc-spike.txt"

PRODUCTION_MODE=0
KEEP_RUNNING=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --production) PRODUCTION_MODE=1 ;;
    --keep-running) KEEP_RUNNING=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 64 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "verify-g2-ondevice.sh requires macOS (real AX/ScreenCaptureKit/launchd) — refusing to run on $(uname -s)." >&2
  exit 1
fi
for tool in swiftc launchctl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "required tool not found: $tool (install Xcode Command Line Tools)" >&2
    exit 69
  fi
done

mkdir -p "$EVIDENCE_DIR"

if [[ "$PRODUCTION_MODE" == "1" ]]; then
  LABEL="dev.spectra.daemon"
  TS_LABEL="dev.spectra.daemon-ts"
  TEST_HOME="$HOME"
  BIN_DIR="$HOME/.spectra/bin"
  echo "*** --production requested: this will bootstrap the REAL dev.spectra.daemon LaunchAgent(s) at the real"
  echo "*** ~/.spectra paths — the strongest TCC-attribution evidence (grants are per-code-signature/per-path),"
  echo "*** but it interacts with a real installed daemon if one is already running."
  read -r -p "Type 'yes' to continue in --production mode: " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "aborted (production mode requires explicit confirmation)." >&2
    exit 1
  fi
else
  LABEL="dev.spectra.daemon-g2-tccspike"
  TS_LABEL="dev.spectra.daemon-g2-tccspike-ts"
  TEST_HOME="$HOME/.spectra-g2-ondevice"
  BIN_DIR="$TEST_HOME/bin"
  mkdir -p "$TEST_HOME"
fi

LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$LAUNCH_AGENTS_DIR" "$BIN_DIR" "$TEST_HOME/logs"
PLIST_PATH="$LAUNCH_AGENTS_DIR/$LABEL.plist"
TS_PLIST_PATH="$LAUNCH_AGENTS_DIR/$TS_LABEL.plist"
SOCKET_PATH="$TEST_HOME/daemon.sock"
TS_SOCKET_PATH="$TEST_HOME/daemon-ts.sock"
ROUTING_CONFIG_PATH="$TEST_HOME/routing-config.json"
DAEMON_CORE_BIN="$BIN_DIR/spectra-daemon-core"
TEST_APP_BIN="$BIN_DIR/spectra-test-app"

echo "· mode: $([[ "$PRODUCTION_MODE" == "1" ]] && echo PRODUCTION || echo test-scoped)"
echo "· front-door label: $LABEL (plist: $PLIST_PATH)"
echo "· socket: $SOCKET_PATH"

# ── Build (idempotent unless --skip-build) ─────────────────────────────────
if [[ "$SKIP_BUILD" == "0" ]]; then
  echo "· compiling the Swift daemon-core…"
  # shellcheck disable=SC2046
  swiftc $(ls "$HERE"/*.swift) -o "$DAEMON_CORE_BIN"
  echo "· compiling TestApp…"
  # -parse-as-library: a single-file @main SwiftUI compile is otherwise treated
  # as top-level code and rejected ("'main' attribute cannot be used…").
  swiftc -parse-as-library "$REPO_ROOT/native/swift/TestApp/TestApp.swift" -framework SwiftUI -framework AppKit -o "$TEST_APP_BIN"
  # Ad-hoc signing only — SPECTRA_CODESIGN_IDENTITY is never set here (see
  # this script's header comment / scripts/codesign-native.sh's own
  # guardrail: it needs no keychain and never prompts).
  bash "$REPO_ROOT/scripts/codesign-native.sh" "$DAEMON_CORE_BIN" || true
  bash "$REPO_ROOT/scripts/codesign-native.sh" "$TEST_APP_BIN" || true
else
  echo "· --skip-build: reusing $DAEMON_CORE_BIN / $TEST_APP_BIN as-is"
fi

# ── Provision the native AX helper into the test home (integration fix) ────
# BridgeClient resolves the helper at $HOME/.spectra/bin/spectra-native
# (BridgeClient.swift resolveBinaryPath) — the launchd plist sets
# HOME=$TEST_HOME, so without this the AX functional probe fails with
# "Native AX helper not found". Reuse the production-built helper when
# present (same binary the TS daemon shells), else build it via the TS
# compiler path. Signed the same way as the daemon (child-process TCC
# attribution flows to the daemon, but consistent signing is cleaner).
HELPER_DEST="$TEST_HOME/.spectra/bin/spectra-native"
if [[ ! -x "$HELPER_DEST" ]]; then
  mkdir -p "$(dirname "$HELPER_DEST")"
  if [[ -x "$HOME/.spectra/bin/spectra-native" ]]; then
    echo "· provisioning AX helper from production install…"
    cp "$HOME/.spectra/bin/spectra-native" "$HELPER_DEST"
  else
    echo "· building AX helper (production copy absent)…"
    (cd "$REPO_ROOT" && npx tsx -e "import {ensureBinary} from './src/native/compiler.js'; await ensureBinary()" && cp "$HOME/.spectra/bin/spectra-native" "$HELPER_DEST")
  fi
  bash "$REPO_ROOT/scripts/codesign-native.sh" "$HELPER_DEST" || true
fi

# G2 v2 routing config — ALL 16 G2 ops + G1's 5 native, matching the plan's
# real flip topology (§"Routing at the G2 flip"), NOT the FakeDriver-seeded
# all-native test config verify-g2-suite.ts uses — V-C exercises the REAL
# NativeDriver/BridgeClient/ScreenCaptureKit paths, no SPECTRA_CONFORMANCE_SEED.
cat > "$ROUTING_CONFIG_PATH" <<'JSON'
{
  "version": 2,
  "native": ["health", "getPermissions", "requestPermissions", "listWindows", "library", "recordTerminal", "replayTerminal", "computerUse"],
  "affinity": ["createSession", "snapshot", "observe", "act", "step", "llmStep", "walkthrough", "screenshot", "analyze", "discover", "startRecording", "stopRecording", "getSession", "getRun", "closeSession", "recordLlmUsage", "getRecording"],
  "merge": ["listSessions"],
  "fanout": ["closeAllSessions"]
}
JSON

# ── Plists (mirrors macos/Spectra/Daemon/LaunchAgentManager.swift's own
# production plist shape verbatim, so this test topology is as close to the
# real one as a non-production label/path allows) ──────────────────────────
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$DAEMON_CORE_BIN</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
        <key>SPECTRA_DAEMON_SOCKET</key>
        <string>$SOCKET_PATH</string>
        <key>SPECTRA_ROUTING_CONFIG</key>
        <string>$ROUTING_CONFIG_PATH</string>
        <key>SPECTRA_PROXY_BACKEND_SOCKET</key>
        <string>$TS_SOCKET_PATH</string>
        <key>HOME</key>
        <string>$TEST_HOME</string>
        <key>SPECTRA_HOME</key>
        <string>$TEST_HOME</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$TEST_HOME/logs/daemon.out.log</string>
    <key>StandardErrorPath</key>
    <string>$TEST_HOME/logs/daemon.err.log</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLIST

cat > "$TS_PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$TS_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(command -v node)</string>
        <string>$REPO_ROOT/dist/cli/index.js</string>
        <string>daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
        <key>SPECTRA_DAEMON_LISTEN_SOCKET</key>
        <string>$TS_SOCKET_PATH</string>
        <key>HOME</key>
        <string>$TEST_HOME</string>
        <key>SPECTRA_HOME</key>
        <string>$TEST_HOME</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$TEST_HOME/logs/daemon-ts.out.log</string>
    <key>StandardErrorPath</key>
    <string>$TEST_HOME/logs/daemon-ts.err.log</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLIST

UID_NUM="$(id -u)"

cleanup() {
  echo "· tearing down…"
  # TestApp is per-run scaffolding — always killed, even under --keep-running.
  if [[ -n "${TEST_APP_PID:-}" ]]; then kill "$TEST_APP_PID" 2>/dev/null || true; fi
  if [[ "$KEEP_RUNNING" == "1" ]]; then
    echo "  --keep-running set: leaving $LABEL / $TS_LABEL installed and loaded for manual inspection."
    return
  fi
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
  launchctl bootout "gui/$UID_NUM/$TS_LABEL" 2>/dev/null || true
  rm -f "$PLIST_PATH" "$TS_PLIST_PATH"
}
trap cleanup EXIT

echo "· launchctl bootstrapping $TS_LABEL (backend) then $LABEL (front door)…"
launchctl bootout "gui/$UID_NUM/$TS_LABEL" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$TS_PLIST_PATH"
launchctl bootstrap "gui/$UID_NUM" "$PLIST_PATH"

echo "· waiting for the front-door socket to appear (launchd-managed, NOT a dev-shell spawn)…"
for _ in $(seq 1 100); do
  [[ -S "$SOCKET_PATH" ]] && break
  sleep 0.2
done
if [[ ! -S "$SOCKET_PATH" ]]; then
  echo "front door did not bind $SOCKET_PATH within 20s — see $TEST_HOME/logs/daemon.err.log" >&2
  {
    echo "=== T-25 step 1 (TCC spike) — RED ==="
    echo "reason: front door failed to bind its socket under launchd (see $TEST_HOME/logs/daemon.err.log)"
    echo "context: PRODUCTION LAUNCH CONTEXT (launchctl bootstrap gui/$UID_NUM/$LABEL), NOT a dev shell"
    date -u +"timestamp: %Y-%m-%dT%H:%M:%SZ"
  } >> "$TCC_SPIKE_EVIDENCE_FILE"
  exit 1
fi

# Corroborating evidence that this really is a launchd-managed process (not
# a plain background `&` spawn masquerading as one): its parent PID must be
# launchd's own PID for this user (1 for the system launchd, or the per-user
# launchd instance — `launchctl print gui/$UID_NUM` on modern macOS runs
# everything under the per-user launchd, whose PID varies but is NEVER a
# Terminal/bash PID).
DAEMON_PID="$(launchctl print "gui/$UID_NUM/$LABEL" 2>/dev/null | awk '/pid = /{print $3; exit}')"
PARENT_PID="$(ps -o ppid= -p "${DAEMON_PID:-0}" 2>/dev/null | tr -d ' ')"
{
  echo "=== T-25 step 1 — production launch context corroboration ==="
  echo "label: $LABEL"
  echo "daemon pid: ${DAEMON_PID:-unknown}"
  echo "daemon parent pid: ${PARENT_PID:-unknown} (expected: launchd's pid, NEVER a Terminal/bash pid)"
  date -u +"timestamp: %Y-%m-%dT%H:%M:%SZ"
} >> "$TCC_SPIKE_EVIDENCE_FILE"

# ── Launch TestApp (integration fix): steps 1-9 drive real AX against it, but
# the scaffold only ever COMPILED it. Plain background spawn is correct here —
# TestApp is the AX *target*, not the TCC subject (that's the launchd daemon).
echo "· launching TestApp ($TEST_APP_BIN)…"
"$TEST_APP_BIN" &
TEST_APP_PID=$!
for _ in $(seq 1 50); do
  pgrep -x spectra-test-app >/dev/null 2>&1 && break
  sleep 0.2
done
sleep 1  # let the SwiftUI window materialize before the first AX snapshot

echo "· front door bound. Handing off to verify-g2-ondevice.ts for the 9-step socket-level script…"
SPECTRA_G2_ONDEVICE_SOCKET="$SOCKET_PATH" \
SPECTRA_G2_ONDEVICE_TCC_EVIDENCE="$TCC_SPIKE_EVIDENCE_FILE" \
SPECTRA_G2_ONDEVICE_EVIDENCE="$EVIDENCE_FILE" \
  npx tsx "$HERE/verify-g2-ondevice.ts"
STEP_STATUS=$?

echo "· evidence: $EVIDENCE_FILE"
echo "· TCC spike evidence: $TCC_SPIKE_EVIDENCE_FILE"
exit $STEP_STATUS
