#!/usr/bin/env bash
# Shared helper-path contract for Spectra's legacy LaunchAgent operators.
# Source this file; do not execute it directly.

SPECTRA_APP_BUNDLE_ID="dev.spectra.app"

spectra_helper_error() {
    echo "spectra helper paths: $*" >&2
    return 1
}

spectra_stable_bundle_path() {
    local candidate="$1"
    [[ "$candidate" == "/Applications/Spectra.app" || \
       "$candidate" == "$HOME/Applications/Spectra.app" ]]
}

spectra_require_physical_path() {
    local path="$1"
    local label="$2"
    local remaining current component

    if [[ "$path" != /* ]]; then
        spectra_helper_error "$label must be an absolute physical path, not $path"
        return 1
    fi

    remaining="${path#/}"
    current=""
    while [[ -n "$remaining" ]]; do
        component="${remaining%%/*}"
        current="$current/$component"
        if [[ -L "$current" ]]; then
            spectra_helper_error "$label contains a symbolic-link component at $current"
            return 1
        fi
        if [[ "$remaining" == */* ]]; then
            remaining="${remaining#*/}"
        else
            break
        fi
    done
}

spectra_xml_escape() {
    local value="$1"
    value=${value//&/&amp;}
    value=${value//</&lt;}
    value=${value//>/&gt;}
    value=${value//\"/&quot;}
    value=${value//\'/&apos;}
    printf '%s' "$value"
}

spectra_resolve_helper_paths() {
    local mode="${SPECTRA_HELPER_MODE:-}"
    local bundle_path="${SPECTRA_APP_BUNDLE_PATH:-}"
    local helpers_dir="${SPECTRA_APP_BUNDLE_HELPERS_DIR:-}"

    if [[ -z "$mode" ]]; then
        if [[ -n "$bundle_path" || -n "$helpers_dir" || -d "/Applications/Spectra.app/Contents/Helpers" ]]; then
            mode="bundle"
        elif [[ -d "$HOME/Applications/Spectra.app/Contents/Helpers" ]]; then
            mode="bundle"
            bundle_path="$HOME/Applications/Spectra.app"
        else
            spectra_helper_error "no stable Spectra.app was found; set SPECTRA_HELPER_MODE=development to use $HOME/.spectra/bin explicitly"
            return 1
        fi
    fi

    case "$mode" in
        bundle)
            if [[ "${SPECTRA_APP_BUNDLE_PATH+configured}" == "configured" && -z "${SPECTRA_APP_BUNDLE_PATH:-}" ]]; then
                spectra_helper_error "SPECTRA_APP_BUNDLE_PATH is configured but empty"
                return 1
            fi
            if [[ "${SPECTRA_APP_BUNDLE_HELPERS_DIR+configured}" == "configured" && -z "${SPECTRA_APP_BUNDLE_HELPERS_DIR:-}" ]]; then
                spectra_helper_error "SPECTRA_APP_BUNDLE_HELPERS_DIR is configured but empty"
                return 1
            fi
            if [[ -z "$bundle_path" && -n "$helpers_dir" ]]; then
                if [[ "$helpers_dir" != */Contents/Helpers ]]; then
                    spectra_helper_error "SPECTRA_APP_BUNDLE_HELPERS_DIR must end in Contents/Helpers"
                    return 1
                fi
                bundle_path="${helpers_dir%/Contents/Helpers}"
            fi
            if [[ -z "$bundle_path" ]]; then
                if [[ -d "/Applications/Spectra.app/Contents/Helpers" ]]; then
                    bundle_path="/Applications/Spectra.app"
                else
                    bundle_path="$HOME/Applications/Spectra.app"
                fi
            fi
            if ! spectra_stable_bundle_path "$bundle_path"; then
                spectra_helper_error "production LaunchAgents require /Applications/Spectra.app or $HOME/Applications/Spectra.app, not $bundle_path"
                return 1
            fi
            local expected_helpers="$bundle_path/Contents/Helpers"
            if [[ -n "$helpers_dir" && "$helpers_dir" != "$expected_helpers" ]]; then
                spectra_helper_error "configured helpers directory must be $expected_helpers in bundle mode"
                return 1
            fi
            helpers_dir="$expected_helpers"
            if ! spectra_require_physical_path "$bundle_path" "production bundle"; then
                return 1
            fi
            if ! spectra_require_physical_path "$helpers_dir" "production helpers directory"; then
                return 1
            fi
            if [[ ! -d "$helpers_dir" ]]; then
                spectra_helper_error "bundle helpers directory is missing at $helpers_dir"
                return 1
            fi
            local physical_bundle physical_helpers expected_physical_bundle expected_physical_helpers
            physical_bundle="$(cd "$bundle_path" 2>/dev/null && pwd -P)" || {
                spectra_helper_error "cannot resolve production bundle at $bundle_path"
                return 1
            }
            physical_helpers="$(cd "$helpers_dir" 2>/dev/null && pwd -P)" || {
                spectra_helper_error "cannot resolve production helpers at $helpers_dir"
                return 1
            }
            expected_physical_bundle="$(cd "$(dirname "$bundle_path")" 2>/dev/null && pwd -P)/$(basename "$bundle_path")"
            expected_physical_helpers="$physical_bundle/Contents/Helpers"
            if [[ "$physical_bundle" != "$expected_physical_bundle" || "$physical_helpers" != "$expected_physical_helpers" ]]; then
                spectra_helper_error "production bundle and helpers must be physical stable paths, not symlinks (bundle=$physical_bundle helpers=$physical_helpers)"
                return 1
            fi

            local native_default="$helpers_dir/spectra-native"
            local cursor_default="$helpers_dir/spectra-cursor-sampler"
            local window_default="$helpers_dir/spectra-window-bounds"
            if [[ "${SPECTRA_NATIVE_HELPER_PATH+configured}" == "configured" ]]; then
                if [[ -z "$SPECTRA_NATIVE_HELPER_PATH" ]]; then
                    spectra_helper_error "SPECTRA_NATIVE_HELPER_PATH is configured but empty"
                    return 1
                elif [[ "$SPECTRA_NATIVE_HELPER_PATH" != "$native_default" ]]; then
                    spectra_helper_error "bundle-mode native helper override must remain inside $helpers_dir"
                    return 1
                fi
            fi
            if [[ "${SPECTRA_CURSOR_SAMPLER_PATH+configured}" == "configured" ]]; then
                if [[ -z "$SPECTRA_CURSOR_SAMPLER_PATH" ]]; then
                    spectra_helper_error "SPECTRA_CURSOR_SAMPLER_PATH is configured but empty"
                    return 1
                elif [[ "$SPECTRA_CURSOR_SAMPLER_PATH" != "$cursor_default" ]]; then
                    spectra_helper_error "bundle-mode cursor helper override must remain inside $helpers_dir"
                    return 1
                fi
            fi
            if [[ "${SPECTRA_WINDOW_BOUNDS_BIN+configured}" == "configured" ]]; then
                if [[ -z "$SPECTRA_WINDOW_BOUNDS_BIN" ]]; then
                    spectra_helper_error "SPECTRA_WINDOW_BOUNDS_BIN is configured but empty"
                    return 1
                elif [[ "$SPECTRA_WINDOW_BOUNDS_BIN" != "$window_default" ]]; then
                    spectra_helper_error "bundle-mode window-bounds override must remain inside $helpers_dir"
                    return 1
                fi
            fi

            SPECTRA_RESOLVED_APP_BUNDLE_PATH="$bundle_path"
            SPECTRA_RESOLVED_HELPERS_DIR="$helpers_dir"
            SPECTRA_RESOLVED_DAEMON_CORE="$helpers_dir/spectra-daemon-core"
            SPECTRA_RESOLVED_DAEMON_LAUNCHER="$helpers_dir/spectra-daemon-launcher"
            SPECTRA_RESOLVED_NATIVE_HELPER="$native_default"
            SPECTRA_RESOLVED_CURSOR_SAMPLER="$cursor_default"
            SPECTRA_RESOLVED_WINDOW_BOUNDS="$window_default"
            ;;
        development)
            local dev_bin="$HOME/.spectra/bin"
            SPECTRA_RESOLVED_APP_BUNDLE_PATH=""
            SPECTRA_RESOLVED_HELPERS_DIR=""
            SPECTRA_RESOLVED_DAEMON_CORE="${SPECTRA_DAEMON_CORE_PATH:-$dev_bin/spectra-daemon-core}"
            SPECTRA_RESOLVED_DAEMON_LAUNCHER="${SPECTRA_DAEMON_LAUNCHER_PATH:-$dev_bin/spectra-daemon-launcher}"
            SPECTRA_RESOLVED_NATIVE_HELPER="${SPECTRA_NATIVE_HELPER_PATH:-$dev_bin/spectra-native}"
            SPECTRA_RESOLVED_CURSOR_SAMPLER="${SPECTRA_CURSOR_SAMPLER_PATH:-$dev_bin/spectra-cursor-sampler}"
            SPECTRA_RESOLVED_WINDOW_BOUNDS="${SPECTRA_WINDOW_BOUNDS_BIN:-$dev_bin/spectra-window-bounds}"
            ;;
        *)
            spectra_helper_error "SPECTRA_HELPER_MODE must be bundle or development, not $mode"
            return 1
            ;;
    esac

    SPECTRA_RESOLVED_HELPER_MODE="$mode"
    export SPECTRA_RESOLVED_HELPER_MODE SPECTRA_RESOLVED_APP_BUNDLE_PATH
    export SPECTRA_RESOLVED_HELPERS_DIR SPECTRA_RESOLVED_DAEMON_CORE
    export SPECTRA_RESOLVED_DAEMON_LAUNCHER SPECTRA_RESOLVED_NATIVE_HELPER
    export SPECTRA_RESOLVED_CURSOR_SAMPLER SPECTRA_RESOLVED_WINDOW_BOUNDS
}

spectra_require_executable() {
    local path="$1"
    local label="$2"
    if [[ -L "$path" || ! -f "$path" || ! -x "$path" ]]; then
        spectra_helper_error "$label must be a regular, non-symlink executable at $path"
        return 1
    fi
}

spectra_require_bundle_inventory() {
    if [[ "$SPECTRA_RESOLVED_HELPER_MODE" != "bundle" ]]; then
        return 0
    fi
    local helper
    for helper in \
        spectra-daemon-core \
        spectra-daemon-launcher \
        spectra-native \
        spectra-composite-capture \
        spectra-screen-recording-preflight \
        spectra-cursor-sampler \
        spectra-window-bounds \
        spectra-text-render; do
        if ! spectra_require_executable "$SPECTRA_RESOLVED_HELPERS_DIR/$helper" "bundled $helper"; then
            return 1
        fi
    done
}

# Rollback intentionally bypasses daemon-core. It still requires the bundle
# launcher and every helper the restored TypeScript daemon may spawn.
spectra_require_bundle_rollback_inventory() {
    if [[ "$SPECTRA_RESOLVED_HELPER_MODE" != "bundle" ]]; then
        return 0
    fi
    local helper
    for helper in \
        spectra-daemon-launcher \
        spectra-native \
        spectra-composite-capture \
        spectra-screen-recording-preflight \
        spectra-cursor-sampler \
        spectra-window-bounds \
        spectra-text-render; do
        if ! spectra_require_executable "$SPECTRA_RESOLVED_HELPERS_DIR/$helper" "rollback bundled $helper"; then
            return 1
        fi
    done
}

spectra_program_arguments_xml() {
    local indent="$1"
    shift
    local argument escaped
    for argument in "$@"; do
        escaped="$(spectra_xml_escape "$argument")"
        printf '%s<string>%s</string>\n' "$indent" "$escaped"
    done
}

spectra_environment_entry_xml() {
    local indent="$1"
    local key value
    key="$(spectra_xml_escape "$2")"
    value="$(spectra_xml_escape "$3")"
    printf '%s<key>%s</key>\n%s<string>%s</string>\n' \
        "$indent" "$key" "$indent" "$value"
}

spectra_helper_environment_xml() {
    local indent="${1:-        }"
    local mode native cursor window
    mode="$(spectra_xml_escape "$SPECTRA_RESOLVED_HELPER_MODE")"
    native="$(spectra_xml_escape "$SPECTRA_RESOLVED_NATIVE_HELPER")"
    cursor="$(spectra_xml_escape "$SPECTRA_RESOLVED_CURSOR_SAMPLER")"
    window="$(spectra_xml_escape "$SPECTRA_RESOLVED_WINDOW_BOUNDS")"

    printf '%s<key>SPECTRA_HELPER_MODE</key>\n%s<string>%s</string>\n' "$indent" "$indent" "$mode"
    if [[ "$SPECTRA_RESOLVED_HELPER_MODE" == "bundle" ]]; then
        local bundle helpers
        bundle="$(spectra_xml_escape "$SPECTRA_RESOLVED_APP_BUNDLE_PATH")"
        helpers="$(spectra_xml_escape "$SPECTRA_RESOLVED_HELPERS_DIR")"
        printf '%s<key>SPECTRA_APP_BUNDLE_PATH</key>\n%s<string>%s</string>\n' "$indent" "$indent" "$bundle"
        printf '%s<key>SPECTRA_APP_BUNDLE_HELPERS_DIR</key>\n%s<string>%s</string>\n' "$indent" "$indent" "$helpers"
    fi
    printf '%s<key>SPECTRA_NATIVE_HELPER_PATH</key>\n%s<string>%s</string>\n' "$indent" "$indent" "$native"
    printf '%s<key>SPECTRA_CURSOR_SAMPLER_PATH</key>\n%s<string>%s</string>\n' "$indent" "$indent" "$cursor"
    printf '%s<key>SPECTRA_WINDOW_BOUNDS_BIN</key>\n%s<string>%s</string>\n' "$indent" "$indent" "$window"
}

spectra_associated_bundle_identifiers_xml() {
    local indent="${1:-    }"
    printf '%s<key>AssociatedBundleIdentifiers</key>\n' "$indent"
    printf '%s<array>\n' "$indent"
    printf '%s    <string>%s</string>\n' "$indent" "$SPECTRA_APP_BUNDLE_ID"
    printf '%s</array>\n' "$indent"
}
