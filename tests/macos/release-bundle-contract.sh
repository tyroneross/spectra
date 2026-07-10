#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="${1:-${SPECTRA_RELEASE_APP_PATH:-$ROOT/macos/build/derived/Build/Products/Release/Spectra.app}}"
EXPECTED_SIGNING_MODE="${2:-${SPECTRA_EXPECTED_SIGNING_MODE:-adhoc}}"
HELPERS="$APP/Contents/Helpers"
APP_EXECUTABLE="$APP/Contents/MacOS/Spectra"

if [[ ! -x "$APP_EXECUTABLE" ]]; then
    echo "release bundle contract: app executable missing at $APP_EXECUTABLE" >&2
    exit 66
fi

EXPECTED_HELPERS=(
    spectra-composite-capture
    spectra-cursor-sampler
    spectra-daemon-core
    spectra-daemon-launcher
    spectra-native
    spectra-screen-recording-preflight
    spectra-text-render
    spectra-window-bounds
)

ACTUAL_HELPERS="$(
    find "$HELPERS" -mindepth 1 -maxdepth 1 -print \
        | sed 's#.*/##' \
        | sort \
        | tr '\n' ' ' \
        | sed 's/ $//'
)"
if [[ "$ACTUAL_HELPERS" != "${EXPECTED_HELPERS[*]}" ]]; then
    echo "release bundle contract: helper inventory mismatch" >&2
    printf 'expected: %s\nactual:   %s\n' "${EXPECTED_HELPERS[*]}" "$ACTUAL_HELPERS" >&2
    exit 1
fi

normalize_archs() {
    lipo -archs "$1" | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//'
}

signature_details() {
    codesign -dv --verbose=4 "$1" 2>&1
}

team_identifier() {
    signature_details "$1" | awk -F= '/^TeamIdentifier=/{print $2; exit}'
}

signing_authority() {
    signature_details "$1" | awk -F= '/^Authority=/{print $2; exit}'
}

assert_runtime_signature() {
    local path="$1"
    local details
    details="$(signature_details "$path")"
    grep -Eq 'flags=.*runtime' <<<"$details" || {
        echo "release bundle contract: hardened runtime is missing for $path" >&2
        exit 1
    }
    case "$EXPECTED_SIGNING_MODE" in
        adhoc)
            grep -q '^Signature=adhoc$' <<<"$details" || {
                echo "release bundle contract: expected ad-hoc signature for $path" >&2
                exit 1
            }
            [[ "$(team_identifier "$path")" == "not set" ]] || {
                echo "release bundle contract: ad-hoc code unexpectedly has a TeamIdentifier at $path" >&2
                exit 1
            }
            ;;
        signed)
            ! grep -q '^Signature=adhoc$' <<<"$details" || {
                echo "release bundle contract: expected Apple signing, found ad-hoc at $path" >&2
                exit 1
            }
            [[ -n "$(team_identifier "$path")" && "$(team_identifier "$path")" != "not set" ]] || {
                echo "release bundle contract: signed code has no TeamIdentifier at $path" >&2
                exit 1
            }
            [[ -n "$(signing_authority "$path")" ]] || {
                echo "release bundle contract: signed code has no signing authority at $path" >&2
                exit 1
            }
            ;;
        *)
            echo "release bundle contract: expected signing mode must be adhoc or signed, not $EXPECTED_SIGNING_MODE" >&2
            exit 64
            ;;
    esac
}

APP_ARCHS="$(normalize_archs "$APP_EXECUTABLE")"
[[ "$APP_ARCHS" == "arm64 x86_64" ]] || {
    echo "release bundle contract: app must contain arm64 and x86_64, found $APP_ARCHS" >&2
    exit 1
}
assert_runtime_signature "$APP"
APP_TEAM="$(team_identifier "$APP")"
APP_AUTHORITY="$(signing_authority "$APP")"
for helper_name in "${EXPECTED_HELPERS[@]}"; do
    helper="$HELPERS/$helper_name"
    [[ -f "$helper" && -x "$helper" && ! -L "$helper" ]]
    [[ "$(normalize_archs "$helper")" == "$APP_ARCHS" ]] || {
        echo "release bundle contract: $helper_name architectures do not match app ($APP_ARCHS)" >&2
        exit 1
    }
    codesign --verify --strict "$helper"
    assert_runtime_signature "$helper"
    [[ "$(team_identifier "$helper")" == "$APP_TEAM" ]] || {
        echo "release bundle contract: $helper_name TeamIdentifier differs from the app" >&2
        exit 1
    }
    [[ "$(signing_authority "$helper")" == "$APP_AUTHORITY" ]] || {
        echo "release bundle contract: $helper_name signing authority differs from the app" >&2
        exit 1
    }
done

codesign --verify --deep --strict "$APP"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" == "dev.spectra.app" ]]
[[ -n "$(/usr/libexec/PlistBuddy -c 'Print :NSAudioCaptureUsageDescription' "$APP/Contents/Info.plist")" ]]
[[ ! -e "$APP/Contents/Resources/PORT-NOTES.md" ]]

echo "release bundle contract: universal inventory, $EXPECTED_SIGNING_MODE runtime signatures, privacy metadata, and resource scope passed"
