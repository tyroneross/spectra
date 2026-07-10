#!/usr/bin/env bash
#
# M3.G1 routing flip — install + bootstrap BOTH LaunchAgents (ADR-03):
#   dev.spectra.daemon     front door (Swift daemon-core), PRIMARY socket
#   dev.spectra.daemon-ts  backend (node), SECONDARY socket
#
# Mirrors macos/Spectra/Daemon/LaunchAgentManager.swift's plist templates in
# bash (the existing scripts/install-daemon.sh precedent — a non-GUI path
# that does not depend on a compiled Swift host binary). Keep the two in
# sync: same labels, same env-var names, same socket paths.
#
# CRITICAL (plan risk row — "Stale dist ignores listen override"): before
# bootstrapping dev.spectra.daemon-ts this script verifies
# ~/.spectra/dist/daemon/server.js actually supports
# SPECTRA_DAEMON_LISTEN_SOCKET (rebuilding + re-mirroring if not). A stale
# dist silently binds the PRIMARY socket instead of the secondary one and
# un-flips the topology without any error.
#
# This script performs a REAL launchd bootstrap on THIS machine (gui/<uid>).
# It is meant to be run ONCE, coordinated, at gate E — not from CI, and not
# repeatedly during development (scripts/install-daemon.sh remains the
# single-daemon dev convenience path pre-flip).
#
# Usage:
#   bash scripts/flip-g1.sh
#   SPECTRA_HELPER_MODE=development bash scripts/flip-g1.sh  # local bare helpers
#
# Rollback: bash scripts/rollback-g1.sh (T-09 drill — restores TS-primary,
# <2 minutes, no rebuild).
#
# SPDX-License-Identifier: Apache-2.0
# (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPECTRA_HOME="$HOME/.spectra"
# shellcheck source=scripts/spectra-helper-paths.sh
source "$REPO_ROOT/scripts/spectra-helper-paths.sh"

FRONT_LABEL="dev.spectra.daemon"
BACKEND_LABEL="dev.spectra.daemon-ts"
FRONT_PLIST="$HOME/Library/LaunchAgents/$FRONT_LABEL.plist"
BACKEND_PLIST="$HOME/Library/LaunchAgents/$BACKEND_LABEL.plist"

DAEMON_CORE_BIN=""
DAEMON_LAUNCHER=""
DAEMON_SCRIPT="$SPECTRA_HOME/dist/cli/index.js"
DIST_TS_ENTRY="$SPECTRA_HOME/dist/daemon/server.js"
REPO_DIST_TS_ENTRY="$REPO_ROOT/dist/daemon/server.js"
BACKEND_SOCKET="$SPECTRA_HOME/daemon-ts.sock"
LOG_DIR="$SPECTRA_HOME/logs"

if [[ "$(uname -s 2>/dev/null || echo unknown)" != "Darwin" ]]; then
    echo "flip-g1: macOS-only (launchd), nothing to do here" >&2
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

configure_helper_paths() {
    spectra_resolve_helper_paths
    DAEMON_CORE_BIN="$SPECTRA_RESOLVED_DAEMON_CORE"
    DAEMON_LAUNCHER="$SPECTRA_RESOLVED_DAEMON_LAUNCHER"
    if [[ "$SPECTRA_RESOLVED_HELPER_MODE" == "bundle" ]]; then
        spectra_require_bundle_inventory
    fi
}

# ─── Step 1: front-door binary present (build it if not — this script is
# meant to be a one-command flip) ─────────────────────────────────────────
ensure_daemon_core() {
    if [[ -x "$DAEMON_CORE_BIN" ]]; then
        echo "flip-g1: daemon-core binary present at $DAEMON_CORE_BIN"
        return 0
    fi
    if [[ "$SPECTRA_RESOLVED_HELPER_MODE" == "bundle" ]]; then
        echo "flip-g1: ABORT — bundled daemon-core is missing or not executable at $DAEMON_CORE_BIN" >&2
        exit 1
    fi
    echo "flip-g1: daemon-core binary missing — building via scripts/build-daemon-core.sh"
    bash "$REPO_ROOT/scripts/build-daemon-core.sh"
    if [[ ! -x "$DAEMON_CORE_BIN" ]]; then
        echo "flip-g1: ABORT — build-daemon-core.sh ran but $DAEMON_CORE_BIN is still missing." >&2
        exit 1
    fi
}

# ─── Step 2: TS backend script present + verified CURRENT (the stale-dist
# guard). "Current" = the compiled server.js actually reads
# SPECTRA_DAEMON_LISTEN_SOCKET; a build predating S4's callsite change would
# ignore the override and bind the PRIMARY socket, silently un-flipping. ───
ensure_ts_dist_current() {
    if [[ ! -f "$DAEMON_SCRIPT" ]]; then
        echo "flip-g1: ABORT — TS daemon entry not found at $DAEMON_SCRIPT" >&2
        echo "         Run 'npm install' or scripts/postinstall.sh first." >&2
        exit 1
    fi

    local needs_rebuild=0
    if [[ ! -f "$DIST_TS_ENTRY" ]]; then
        echo "flip-g1: no TS dist at $DIST_TS_ENTRY — building"
        needs_rebuild=1
    elif ! grep -q "SPECTRA_DAEMON_LISTEN_SOCKET" "$DIST_TS_ENTRY" 2>/dev/null; then
        echo "flip-g1: $DIST_TS_ENTRY is STALE — missing SPECTRA_DAEMON_LISTEN_SOCKET support."
        echo "         A stale dist binds the PRIMARY socket and silently un-flips the topology."
        needs_rebuild=1
    elif [[ -f "$REPO_DIST_TS_ENTRY" && "$REPO_DIST_TS_ENTRY" -nt "$DIST_TS_ENTRY" ]]; then
        echo "flip-g1: repo dist/ is newer than the mirrored ~/.spectra/dist/ — re-mirroring"
        needs_rebuild=1
    else
        echo "flip-g1: TS dist is current (listen-socket override present) at $DIST_TS_ENTRY"
    fi

    if [[ "$needs_rebuild" == "1" ]]; then
        echo "flip-g1: rebuilding TS dist (npm run build) and re-mirroring to $SPECTRA_HOME/dist"
        (cd "$REPO_ROOT" && npm run build)
        bash "$REPO_ROOT/scripts/sync-dist.sh"
    fi

    if [[ ! -f "$DIST_TS_ENTRY" ]] || ! grep -q "SPECTRA_DAEMON_LISTEN_SOCKET" "$DIST_TS_ENTRY" 2>/dev/null; then
        echo "flip-g1: ABORT — $DIST_TS_ENTRY still lacks SPECTRA_DAEMON_LISTEN_SOCKET support after rebuild." >&2
        echo "         Check src/daemon/server.ts's main-entry callsite (S4, P3 pin)." >&2
        exit 1
    fi
}

# ─── Plist authors (mirrors LaunchAgentManager.swift's templates) ────────
make_front_door_program_args() {
    spectra_program_arguments_xml "        " "$DAEMON_CORE_BIN"
}

make_backend_program_args() {
    local node_path
    node_path="$(resolve_node)"
    if [[ -x "$DAEMON_LAUNCHER" ]]; then
        spectra_program_arguments_xml "        " \
            "$DAEMON_LAUNCHER" "--node" "$node_path" "--script" "$DAEMON_SCRIPT"
    else
        spectra_program_arguments_xml "        " "$node_path" "$DAEMON_SCRIPT" "daemon"
    fi
}

write_front_door_plist() {
    local log_dir_xml
    log_dir_xml="$(spectra_xml_escape "$LOG_DIR")"
    mkdir -p "$(dirname "$FRONT_PLIST")" "$LOG_DIR"
    cat > "$FRONT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$FRONT_LABEL</string>
$(spectra_associated_bundle_identifiers_xml "    ")
    <key>ProgramArguments</key>
    <array>
$(make_front_door_program_args)
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
$(spectra_environment_entry_xml "        " "SPECTRA_PROXY_BACKEND_SOCKET" "$BACKEND_SOCKET")
$(spectra_environment_entry_xml "        " "SPECTRA_DUAL_RUN" "${SPECTRA_DUAL_RUN:-1}")
$(spectra_helper_environment_xml "        ")
$(if [[ -n "${SPECTRA_ROUTING_CONFIG:-}" ]]; then spectra_environment_entry_xml "        " "SPECTRA_ROUTING_CONFIG" "$SPECTRA_ROUTING_CONFIG"; fi)
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
    echo "flip-g1: wrote $FRONT_PLIST"
}

write_backend_plist() {
    local log_dir_xml
    log_dir_xml="$(spectra_xml_escape "$LOG_DIR")"
    mkdir -p "$(dirname "$BACKEND_PLIST")" "$LOG_DIR"
    cat > "$BACKEND_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$BACKEND_LABEL</string>
$(spectra_associated_bundle_identifiers_xml "    ")
    <key>ProgramArguments</key>
    <array>
$(make_backend_program_args)
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
$(spectra_environment_entry_xml "        " "SPECTRA_DAEMON_LISTEN_SOCKET" "$BACKEND_SOCKET")
$(spectra_helper_environment_xml "        ")
    </dict>
    <key>StandardOutPath</key>
    <string>$log_dir_xml/daemon-ts.out.log</string>
    <key>StandardErrorPath</key>
    <string>$log_dir_xml/daemon-ts.err.log</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
EOF
    echo "flip-g1: wrote $BACKEND_PLIST"
}

# ─── Bootstrap ─────────────────────────────────────────────────────────────
bootstrap_both() {
    local uid
    uid="$(id -u)"
    # Idempotent — bootout first so re-running this script doesn't fight a
    # stale registration (same idiom as scripts/install-daemon.sh).
    launchctl bootout "gui/$uid/$BACKEND_LABEL" 2>/dev/null || true
    launchctl bootout "gui/$uid/$FRONT_LABEL" 2>/dev/null || true

    # Backend first so the front door's proxy has somewhere to reach as soon
    # as it comes up (ADR-01: the boot-order gap is benign either way —
    # proxied ops answer daemon_unhealthy until the backend appears).
    launchctl bootstrap "gui/$uid" "$BACKEND_PLIST"
    echo "flip-g1: bootstrapped $BACKEND_LABEL (backend, socket=$BACKEND_SOCKET)"
    launchctl bootstrap "gui/$uid" "$FRONT_PLIST"
    echo "flip-g1: bootstrapped $FRONT_LABEL (front door, primary socket)"
}

smoke_check() {
    local primary_socket="$SPECTRA_HOME/daemon.sock"
    sleep 1
    if ! command -v curl >/dev/null 2>&1; then
        echo "flip-g1: curl not found — skipping smoke check (verify manually)"
        return 0
    fi
    if curl -s --unix-socket "$primary_socket" \
        -H 'Content-Type: application/json' \
        -d '{"apiVersion":2,"requestId":"flip-g1-smoke"}' \
        http://localhost/api/v1/health >/tmp/flip-g1-smoke.json 2>/dev/null; then
        echo "flip-g1: smoke check OK — front door answered on $primary_socket"
        cat /tmp/flip-g1-smoke.json
        echo
    else
        echo "flip-g1: WARNING — smoke check against $primary_socket failed or timed out." >&2
        echo "         This is best-effort only; run the real T-01/T-02 verifiers before declaring gate A/B green." >&2
    fi
}

echo "=== flip-g1: M3.G1 routing flip (two-LaunchAgent topology) ==="
configure_helper_paths
ensure_daemon_core
ensure_ts_dist_current
write_front_door_plist
write_backend_plist
bootstrap_both
smoke_check

cat <<'EOF'

flip-g1: both agents installed + bootstrapped.
  Front door : dev.spectra.daemon    (primary socket, Swift daemon-core)
  Backend    : dev.spectra.daemon-ts (secondary socket, node/TS)

Next steps (gate E, Opus-coordinated):
  - Run T-01/T-02/T-02b/T-04 against this live install before trusting it.
  - Enable soak: this plist already sets SPECTRA_DUAL_RUN=1 by default
    (override with SPECTRA_DUAL_RUN=0 before running this script to disable).
  - Post a rally fact announcing the flip window before other agents probe
    the daemon.
  - Rollback drill (T-09, mandatory, <2 min): bash scripts/rollback-g1.sh
EOF
