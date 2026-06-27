#!/usr/bin/env bash
#
# Install + start the Spectra daemon as a per-user LaunchAgent.
# Fallback for users who prefer not to use the SwiftUI app's auto-install.
# Idempotent: safe to re-run.
#
# Usage:
#   bash scripts/install-daemon.sh               # install + bootstrap
#   bash scripts/install-daemon.sh --uninstall   # bootout + remove plist
#
# SPDX-License-Identifier: Apache-2.0
# (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

set -euo pipefail

LABEL="dev.spectra.daemon"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
DAEMON_SCRIPT="$HOME/.spectra/dist/cli/index.js"
DAEMON_LAUNCHER="$HOME/.spectra/bin/spectra-daemon-launcher"
LOG_DIR="$HOME/.spectra/logs"

resolve_node() {
    for cand in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do
        if [[ -x "$cand" ]]; then
            echo "$cand"; return 0
        fi
    done
    command -v node 2>/dev/null || { echo "ERROR: node not found in PATH or standard locations" >&2; exit 1; }
}

install_agent() {
    local node_path
    local program_args
    node_path="$(resolve_node)"

    if [[ ! -f "$DAEMON_SCRIPT" ]]; then
        echo "ERROR: daemon script not found at $DAEMON_SCRIPT" >&2
        echo "       Run 'npm install' or scripts/postinstall.sh from the spectra plugin first." >&2
        exit 1
    fi

    mkdir -p "$(dirname "$PLIST_PATH")"
    mkdir -p "$LOG_DIR"

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

    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
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
    echo "Wrote $PLIST_PATH"

    # Bootstrap (idempotent — bootout first to clear any stale registration)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
    echo "Bootstrapped — daemon should be reachable at http://127.0.0.1:47823 in a moment."
    echo "Verify: curl -s http://127.0.0.1:47823/api/version"
}

uninstall_agent() {
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    if [[ -f "$PLIST_PATH" ]]; then
        rm -f "$PLIST_PATH"
        echo "Removed $PLIST_PATH"
    fi
    echo "Daemon stopped + LaunchAgent removed."
}

case "${1:-install}" in
    install) install_agent ;;
    --uninstall|uninstall) uninstall_agent ;;
    *)
        echo "Usage: $0 [install|--uninstall]" >&2
        exit 64
        ;;
esac
