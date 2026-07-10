#!/usr/bin/env bash
#
# Install + start the Spectra daemon as a per-user LaunchAgent.
# Fallback for users who prefer not to use the SwiftUI app's auto-install.
# Idempotent: safe to re-run.
#
# Usage:
#   bash scripts/install-daemon.sh               # install + bootstrap
#   SPECTRA_HELPER_MODE=development bash scripts/install-daemon.sh
#                                                # explicit ~/.spectra/bin mode
#   bash scripts/install-daemon.sh --uninstall   # bootout + remove plist
#
# SPDX-License-Identifier: Apache-2.0
# (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/spectra-helper-paths.sh
source "$REPO_ROOT/scripts/spectra-helper-paths.sh"

LABEL="dev.spectra.daemon"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
DAEMON_SCRIPT="$HOME/.spectra/dist/cli/index.js"
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
    local daemon_launcher
    local log_dir_xml
    spectra_resolve_helper_paths
    daemon_launcher="$SPECTRA_RESOLVED_DAEMON_LAUNCHER"
    log_dir_xml="$(spectra_xml_escape "$LOG_DIR")"
    node_path="$(resolve_node)"

    if [[ ! -f "$DAEMON_SCRIPT" ]]; then
        echo "ERROR: daemon script not found at $DAEMON_SCRIPT" >&2
        echo "       Run 'npm install' or scripts/postinstall.sh from the spectra plugin first." >&2
        exit 1
    fi

    mkdir -p "$(dirname "$PLIST_PATH")"
    mkdir -p "$LOG_DIR"

    if [[ "$SPECTRA_RESOLVED_HELPER_MODE" == "bundle" ]]; then
        spectra_require_bundle_inventory
    fi

    if [[ -x "$daemon_launcher" ]]; then
        program_args="$(spectra_program_arguments_xml "        " \
            "$daemon_launcher" "--node" "$node_path" "--script" "$DAEMON_SCRIPT")"
    else
        program_args="$(spectra_program_arguments_xml "        " \
            "$node_path" "$DAEMON_SCRIPT" "daemon")"
    fi

    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
$(spectra_associated_bundle_identifiers_xml "    ")
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
$(spectra_helper_environment_xml "        ")
    </dict>
    <key>StandardOutPath</key>
    <string>$log_dir_xml/daemon.out.log</string>
    <key>StandardErrorPath</key>
    <string>$log_dir_xml/daemon.err.log</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
EOF
    echo "Wrote $PLIST_PATH"

    # Bootstrap (idempotent — bootout first to clear any stale registration)
    launchctl bootout "gui/$(id -u)/dev.spectra.daemon-ts" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/dev.spectra.daemon-ts.plist"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
    echo "Bootstrapped — daemon should be reachable at http://127.0.0.1:47823 in a moment."
    echo "Verify: curl -s http://127.0.0.1:47823/api/version"
}

uninstall_agent() {
    launchctl bootout "gui/$(id -u)/dev.spectra.daemon-ts" 2>/dev/null || true
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/dev.spectra.daemon-ts.plist"
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
