#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_RAW="$(mktemp -d "${TMPDIR:-/tmp}/spectra-launch-agent-contract.XXXXXX")"
TMP="$(cd "$TMP_RAW" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
ORIGINAL_HOME="$HOME"
ORIGINAL_PATH="$PATH"

HOME_DIR="$TMP/home"
BUNDLE="$HOME_DIR/Applications/Spectra.app"
HELPERS="$BUNDLE/Contents/Helpers"
FAKE_BIN="$TMP/fake-bin"
LAUNCHCTL_LOG="$TMP/launchctl.log"

mkdir -p "$HELPERS" "$FAKE_BIN" "$HOME_DIR/.spectra/dist/cli" "$HOME_DIR/.spectra/dist/daemon"
printf '// daemon entry\n' > "$HOME_DIR/.spectra/dist/cli/index.js"
printf '// SPECTRA_DAEMON_LISTEN_SOCKET\n' > "$HOME_DIR/.spectra/dist/daemon/server.js"
touch -t 203001010000 "$HOME_DIR/.spectra/dist/daemon/server.js"

HELPER_NAMES=(
    spectra-daemon-core
    spectra-daemon-launcher
    spectra-native
    spectra-composite-capture
    spectra-screen-recording-preflight
    spectra-cursor-sampler
    spectra-window-bounds
    spectra-text-render
)
for helper in "${HELPER_NAMES[@]}"; do
    printf '#!/bin/sh\nexit 0\n' > "$HELPERS/$helper"
    chmod +x "$HELPERS/$helper"
done

# The fake script must expand these variables when it runs, not while the
# fixture is authored.
# shellcheck disable=SC2016
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "$SPECTRA_TEST_LAUNCHCTL_LOG"\nexit 0\n' > "$FAKE_BIN/launchctl"
printf '#!/bin/sh\nprintf "{\\\"ok\\\":true}\\n"\n' > "$FAKE_BIN/curl"
printf '#!/bin/sh\nexit 0\n' > "$FAKE_BIN/sleep"
chmod +x "$FAKE_BIN/launchctl" "$FAKE_BIN/curl" "$FAKE_BIN/sleep"

export HOME="$HOME_DIR"
export PATH="$FAKE_BIN:$PATH"
export SPECTRA_TEST_LAUNCHCTL_LOG="$LAUNCHCTL_LOG"
export SPECTRA_HELPER_MODE=bundle
export SPECTRA_APP_BUNDLE_PATH="$BUNDLE"
unset SPECTRA_APP_BUNDLE_HELPERS_DIR SPECTRA_NATIVE_HELPER_PATH
unset SPECTRA_CURSOR_SAMPLER_PATH SPECTRA_WINDOW_BOUNDS_BIN

plist_value() {
    /usr/libexec/PlistBuddy -c "Print :$2" "$1"
}

assert_common_bundle_environment() {
    local plist="$1"
    [[ "$(plist_value "$plist" AssociatedBundleIdentifiers:0)" == "dev.spectra.app" ]]
    [[ "$(plist_value "$plist" EnvironmentVariables:SPECTRA_HELPER_MODE)" == "bundle" ]]
    [[ "$(plist_value "$plist" EnvironmentVariables:SPECTRA_APP_BUNDLE_PATH)" == "$BUNDLE" ]]
    [[ "$(plist_value "$plist" EnvironmentVariables:SPECTRA_APP_BUNDLE_HELPERS_DIR)" == "$HELPERS" ]]
    [[ "$(plist_value "$plist" EnvironmentVariables:SPECTRA_NATIVE_HELPER_PATH)" == "$HELPERS/spectra-native" ]]
    [[ "$(plist_value "$plist" EnvironmentVariables:SPECTRA_CURSOR_SAMPLER_PATH)" == "$HELPERS/spectra-cursor-sampler" ]]
    [[ "$(plist_value "$plist" EnvironmentVariables:SPECTRA_WINDOW_BOUNDS_BIN)" == "$HELPERS/spectra-window-bounds" ]]
}

# Single-TS install path: bundle launcher, primary socket by absence of an override.
bash "$ROOT/scripts/install-daemon.sh" >/dev/null
FRONT="$HOME_DIR/Library/LaunchAgents/dev.spectra.daemon.plist"
plutil -lint "$FRONT" >/dev/null
[[ "$(plist_value "$FRONT" Label)" == "dev.spectra.daemon" ]]
[[ "$(plist_value "$FRONT" ProgramArguments:0)" == "$HELPERS/spectra-daemon-launcher" ]]
assert_common_bundle_environment "$FRONT"
if /usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:SPECTRA_DAEMON_LISTEN_SOCKET' "$FRONT" >/dev/null 2>&1; then
    echo "single-TS install must retain the primary socket" >&2
    exit 1
fi
cp "$FRONT" "$TMP/install.plist"

# A partial production bundle must fail before overwriting the installed plist.
BEFORE_SUM="$(shasum -a 256 "$FRONT" | awk '{print $1}')"
rm -f "$HELPERS/spectra-text-render"
if bash "$ROOT/scripts/install-daemon.sh" >/dev/null 2>&1; then
    echo "install-daemon accepted a partial production helper inventory" >&2
    exit 1
fi
AFTER_SUM="$(shasum -a 256 "$FRONT" | awk '{print $1}')"
[[ "$BEFORE_SUM" == "$AFTER_SUM" ]]
printf '#!/bin/sh\nexit 0\n' > "$HELPERS/spectra-text-render"
chmod +x "$HELPERS/spectra-text-render"

# A transient/staging bundle path is rejected and cannot replace the plist.
if SPECTRA_APP_BUNDLE_PATH="$TMP/staging/Spectra.app" \
    bash "$ROOT/scripts/install-daemon.sh" >/dev/null 2>&1; then
    echo "install-daemon accepted an unstable production bundle path" >&2
    exit 1
fi
[[ "$BEFORE_SUM" == "$(shasum -a 256 "$FRONT" | awk '{print $1}')" ]]

# A supported-looking symlink into DerivedData is still transient and rejected.
SYMLINK_TARGET="$TMP/DerivedData/Build/Products/Release/Spectra.app"
mkdir -p "$(dirname "$SYMLINK_TARGET")"
mv "$BUNDLE" "$SYMLINK_TARGET"
ln -s "$SYMLINK_TARGET" "$BUNDLE"
if bash "$ROOT/scripts/install-daemon.sh" >/dev/null 2>&1; then
    echo "install-daemon accepted a stable-looking bundle symlink into DerivedData" >&2
    exit 1
fi
[[ "$BEFORE_SUM" == "$(shasum -a 256 "$FRONT" | awk '{print $1}')" ]]
rm -f "$BUNDLE"
mv "$SYMLINK_TARGET" "$BUNDLE"

# A physical-looking app beneath a symlinked ~/Applications directory is also
# transient and must be rejected before any plist changes.
REAL_APPLICATIONS="$TMP/real-applications"
mv "$HOME_DIR/Applications" "$REAL_APPLICATIONS"
ln -s "$REAL_APPLICATIONS" "$HOME_DIR/Applications"
if bash "$ROOT/scripts/install-daemon.sh" >/dev/null 2>&1; then
    echo "install-daemon accepted a symlinked stable parent directory" >&2
    exit 1
fi
[[ "$BEFORE_SUM" == "$(shasum -a 256 "$FRONT" | awk '{print $1}')" ]]
rm -f "$HOME_DIR/Applications"
mv "$REAL_APPLICATIONS" "$HOME_DIR/Applications"

# Present-but-empty helper overrides are authoritative invalid configuration;
# they must not silently fall through to a bundled default.
for override in \
    SPECTRA_NATIVE_HELPER_PATH \
    SPECTRA_CURSOR_SAMPLER_PATH \
    SPECTRA_WINDOW_BOUNDS_BIN; do
    if env "$override=" bash "$ROOT/scripts/install-daemon.sh" >/dev/null 2>&1; then
        echo "install-daemon accepted an empty $override" >&2
        exit 1
    fi
    [[ "$BEFORE_SUM" == "$(shasum -a 256 "$FRONT" | awk '{print $1}')" ]]
done

# Dual-agent flip path: Swift front door on primary, TS backend on secondary.
: > "$LAUNCHCTL_LOG"
export SPECTRA_ROUTING_CONFIG='route&<unsafe'
bash "$ROOT/scripts/flip-g1.sh" >/dev/null
BACKEND="$HOME_DIR/Library/LaunchAgents/dev.spectra.daemon-ts.plist"
plutil -lint "$FRONT" "$BACKEND" >/dev/null
[[ "$(plist_value "$FRONT" ProgramArguments:0)" == "$HELPERS/spectra-daemon-core" ]]
[[ "$(plist_value "$BACKEND" ProgramArguments:0)" == "$HELPERS/spectra-daemon-launcher" ]]
[[ "$(plist_value "$FRONT" EnvironmentVariables:SPECTRA_PROXY_BACKEND_SOCKET)" == "$HOME_DIR/.spectra/daemon-ts.sock" ]]
[[ "$(plist_value "$BACKEND" EnvironmentVariables:SPECTRA_DAEMON_LISTEN_SOCKET)" == "$HOME_DIR/.spectra/daemon-ts.sock" ]]
[[ "$(plist_value "$FRONT" EnvironmentVariables:SPECTRA_ROUTING_CONFIG)" == 'route&<unsafe' ]]
assert_common_bundle_environment "$FRONT"
assert_common_bundle_environment "$BACKEND"
BACKEND_LINE="$(rg -n 'bootstrap .*dev\.spectra\.daemon-ts\.plist' "$LAUNCHCTL_LOG" | head -1 | cut -d: -f1)"
FRONT_LINE="$(rg -n 'bootstrap .*dev\.spectra\.daemon\.plist' "$LAUNCHCTL_LOG" | head -1 | cut -d: -f1)"
[[ -n "$BACKEND_LINE" && -n "$FRONT_LINE" && "$BACKEND_LINE" -lt "$FRONT_LINE" ]]

# The single-TS installer retires both halves of a prior dual topology.
bash "$ROOT/scripts/install-daemon.sh" >/dev/null
unset SPECTRA_ROUTING_CONFIG
test ! -e "$BACKEND"
[[ "$(plist_value "$FRONT" ProgramArguments:0)" == "$HELPERS/spectra-daemon-launcher" ]]
if /usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:SPECTRA_DAEMON_LISTEN_SOCKET' "$FRONT" >/dev/null 2>&1; then
    echo "single-TS install retained the secondary listen-socket override" >&2
    exit 1
fi

# Recreate dual topology, then prove rollback bypasses a failed daemon-core.
bash "$ROOT/scripts/flip-g1.sh" >/dev/null
rm -f "$HELPERS/spectra-daemon-core"
bash "$ROOT/scripts/rollback-g1.sh" >/dev/null
test ! -e "$BACKEND"
[[ "$(plist_value "$FRONT" ProgramArguments:0)" == "$HELPERS/spectra-daemon-launcher" ]]
assert_common_bundle_environment "$FRONT"
if /usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:SPECTRA_DAEMON_LISTEN_SOCKET' "$FRONT" >/dev/null 2>&1; then
    echo "rollback must not retain the secondary listen-socket override" >&2
    exit 1
fi
printf '#!/bin/sh\nexit 0\n' > "$HELPERS/spectra-daemon-core"
chmod +x "$HELPERS/spectra-daemon-core"
if /usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:SPECTRA_PROXY_BACKEND_SOCKET' "$FRONT" >/dev/null 2>&1; then
    echo "rollback must not retain the front-door proxy override" >&2
    exit 1
fi

# Explicit development mode alone preserves the home launcher fallback.
mkdir -p "$HOME_DIR/.spectra/bin"
printf '#!/bin/sh\nexit 0\n' > "$HOME_DIR/.spectra/bin/spectra-daemon-launcher"
chmod +x "$HOME_DIR/.spectra/bin/spectra-daemon-launcher"
SPECTRA_HELPER_MODE=development \
SPECTRA_APP_BUNDLE_PATH='' \
SPECTRA_APP_BUNDLE_HELPERS_DIR='' \
    bash "$ROOT/scripts/install-daemon.sh" >/dev/null
[[ "$(plist_value "$FRONT" ProgramArguments:0)" == "$HOME_DIR/.spectra/bin/spectra-daemon-launcher" ]]
[[ "$(plist_value "$FRONT" EnvironmentVariables:SPECTRA_HELPER_MODE)" == "development" ]]

# Program arguments are escaped before they enter XML.
# shellcheck source=scripts/spectra-helper-paths.sh
source "$ROOT/scripts/spectra-helper-paths.sh"
[[ "$(spectra_program_arguments_xml "" 'a&<b')" == '<string>a&amp;&lt;b</string>' ]]

# The legacy on-device harness is test-scoped only. It must refuse the old
# real-label producer and explicitly configure both agents for development.
ONDEVICE_VERIFIER="$ROOT/macos/Spectra/DaemonCore/verify-g2-ondevice.sh"
if bash "$ONDEVICE_VERIFIER" --production >"$TMP/ondevice-production.log" 2>&1; then
    echo "legacy on-device verifier still accepts --production" >&2
    exit 1
fi
rg -q -- '--production is no longer supported' "$TMP/ondevice-production.log"
[[ "$(rg -c '<key>SPECTRA_HELPER_MODE</key>' "$ONDEVICE_VERIFIER")" == "2" ]]
[[ "$(rg -c '<key>SPECTRA_NATIVE_HELPER_PATH</key>' "$ONDEVICE_VERIFIER")" == "2" ]]

# The native manager owns a separate producer; exercise its behavioral XCTest.
HOME="$ORIGINAL_HOME" PATH="$ORIGINAL_PATH" xcodebuild \
    -project "$ROOT/macos/Spectra.xcodeproj" \
    -scheme Spectra \
    -destination 'platform=macOS' \
    -derivedDataPath "$TMP/derived" \
    CODE_SIGNING_ALLOWED=NO \
    -only-testing:SpectraTests/LaunchAgentManagerTests \
    test >/dev/null

echo "launch-agent contract: manager, install, flip, and rollback preserve bundle attribution and socket topology"
