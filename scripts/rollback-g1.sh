#!/usr/bin/env bash
#
# M3.G1 rollback drill (T-09) — boots out BOTH flip LaunchAgents and restores
# the ORIGINAL single-TS-daemon LaunchAgent on the PRIMARY socket. One
# command, no rebuild — must complete in under 2 minutes (this script prints
# its own elapsed time so the drill has evidence).
#
# This is the ADR-01 rollback path: if anything about the Swift front door
# is wrong, this returns the machine to pre-flip behavior byte-for-byte
# (same plist shape scripts/install-daemon.sh has always written).
#
# Usage:
#   bash scripts/rollback-g1.sh
#
# Re-flip afterwards with: bash scripts/flip-g1.sh
#
# SPDX-License-Identifier: Apache-2.0
# (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

set -euo pipefail

SECONDS=0

FRONT_LABEL="dev.spectra.daemon"
BACKEND_LABEL="dev.spectra.daemon-ts"
FRONT_PLIST="$HOME/Library/LaunchAgents/$FRONT_LABEL.plist"
BACKEND_PLIST="$HOME/Library/LaunchAgents/$BACKEND_LABEL.plist"

DAEMON_SCRIPT="$HOME/.spectra/dist/cli/index.js"
DAEMON_LAUNCHER="$HOME/.spectra/bin/spectra-daemon-launcher"
LOG_DIR="$HOME/.spectra/logs"
PRIMARY_SOCKET="$HOME/.spectra/daemon.sock"

if [[ "$(uname -s 2>/dev/null || echo unknown)" != "Darwin" ]]; then
    echo "rollback-g1: macOS-only (launchd), nothing to do here" >&2
    exit 1
fi

resolve_node() {
    for cand in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do
        if [[ -x "$cand" ]]; then
            echo "$cand"; return 0
        fi
    done
    command -v node 2>/dev/null || { echo "ERROR: node not found in PATH or standard locations" >&2; exit 1; }
}

# ─── Step 1: tear down BOTH flip agents ──────────────────────────────────
teardown_flip_agents() {
    local uid
    uid="$(id -u)"
    launchctl bootout "gui/$uid/$FRONT_LABEL" 2>/dev/null || true
    launchctl bootout "gui/$uid/$BACKEND_LABEL" 2>/dev/null || true
    echo "rollback-g1: booted out $FRONT_LABEL and $BACKEND_LABEL"

    if [[ -f "$BACKEND_PLIST" ]]; then
        rm -f "$BACKEND_PLIST"
        echo "rollback-g1: removed $BACKEND_PLIST (flip-only agent, retired on rollback)"
    fi
}

# ─── Step 2: restore the ORIGINAL single-TS plist on the primary socket ──
# Byte-shape matches scripts/install-daemon.sh's pre-flip template exactly
# (no SPECTRA_DAEMON_LISTEN_SOCKET override — this process owns the PRIMARY
# socket again, the pre-flip default).
restore_single_ts_plist() {
    if [[ ! -f "$DAEMON_SCRIPT" ]]; then
        echo "rollback-g1: ABORT — TS daemon entry not found at $DAEMON_SCRIPT" >&2
        echo "             Cannot restore a working daemon; fix the install before retrying." >&2
        exit 1
    fi

    mkdir -p "$(dirname "$FRONT_PLIST")" "$LOG_DIR"

    local node_path program_args
    node_path="$(resolve_node)"
    if [[ -x "$DAEMON_LAUNCHER" ]]; then
        program_args="\
        <string>$DAEMON_LAUNCHER</string>
        <string>--node</string>
        <string>$node_path</string>
        <string>--script</string>
        <string>$DAEMON_SCRIPT</string>"
    else
        program_args="\
        <string>$node_path</string>
        <string>$DAEMON_SCRIPT</string>
        <string>daemon</string>"
    fi

    cat > "$FRONT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$FRONT_LABEL</string>
    <key>ProgramArguments</key>
    <array>
$program_args
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/daemon.out.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/daemon.err.log</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
EOF
    echo "rollback-g1: restored single-TS plist at $FRONT_PLIST (primary socket, no rebuild)"

    launchctl bootstrap "gui/$(id -u)" "$FRONT_PLIST"
    echo "rollback-g1: bootstrapped $FRONT_LABEL on the primary socket"
}

# ─── Step 3: prove a client op succeeds (T-09's falsifier) ───────────────
verify_client_op() {
    sleep 1
    if ! command -v curl >/dev/null 2>&1; then
        echo "rollback-g1: curl not found — skipping client-op verification (verify manually)" >&2
        return 0
    fi
    if curl -s --unix-socket "$PRIMARY_SOCKET" \
        -H 'Content-Type: application/json' \
        -d '{"apiVersion":2,"requestId":"rollback-g1-drill"}' \
        http://localhost/api/v1/health >/tmp/rollback-g1-smoke.json 2>/dev/null; then
        echo "rollback-g1: client op OK — TS answered on $PRIMARY_SOCKET"
        cat /tmp/rollback-g1-smoke.json
        echo
    else
        echo "rollback-g1: WARNING — client-op verification against $PRIMARY_SOCKET failed." >&2
        echo "             The rollback drill (T-09) requires a passing client op — investigate before declaring it done." >&2
        exit 1
    fi
}

echo "=== rollback-g1: restoring TS-primary (T-09 drill) ==="
teardown_flip_agents
restore_single_ts_plist
verify_client_op

echo
echo "rollback-g1: DONE in ${SECONDS}s (drill requires < 120s)"
if [[ "$SECONDS" -ge 120 ]]; then
    echo "rollback-g1: WARNING — elapsed ${SECONDS}s exceeds the 2-minute T-09 threshold." >&2
fi
echo "rollback-g1: re-flip with: bash scripts/flip-g1.sh"
