#!/usr/bin/env bash
# Foundation-only executable contract for BundleHelperPaths.swift.
# R3 wires the XCTest source into the generated project; this test remains
# independently runnable before that project wiring lands.
#
# SPDX-License-Identifier: Apache-2.0
# © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOLVER="$REPO_ROOT/macos/Spectra/DaemonCore/BundleHelperPaths.swift"

if ! command -v swiftc >/dev/null 2>&1; then
    echo "bundle-helper-paths-contract: swiftc not found" >&2
    exit 69
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/spectra-bundle-helper-paths.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

HARNESS="$TMP_DIR/BundleHelperPathsContractMain.swift"
BIN="$TMP_DIR/bundle-helper-paths-contract"

cat > "$HARNESS" <<'SWIFT'
import Foundation

enum ContractFailure: Error, CustomStringConvertible {
    case assertion(String)

    var description: String {
        switch self {
        case .assertion(let message): return message
        }
    }
}

@main
struct BundleHelperPathsContractMain {
    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        let home = root.appendingPathComponent("home", isDirectory: true)
        let homeNative = try makeExecutable(
            home.appendingPathComponent(".spectra/bin/spectra-native")
        )

        let override = try makeExecutable(root.appendingPathComponent("override-native"))
        try expectEqual(
            BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                overrideEnvironmentKey: "SPECTRA_NATIVE_HELPER_PATH",
                environment: ["SPECTRA_NATIVE_HELPER_PATH": override.path],
                defaultHome: home.path
            ),
            override.path,
            "specific override"
        )

        let bundleHelpers = root.appendingPathComponent("bundle-helpers", isDirectory: true)
        let bundleNative = try makeExecutable(bundleHelpers.appendingPathComponent("spectra-native"))
        try expectEqual(
            BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_HELPERS_DIR": bundleHelpers.path,
                    "HOME": home.path,
                ],
                defaultHome: home.path
            ),
            bundleNative.path,
            "bundle helpers directory"
        )

        let app = root.appendingPathComponent("Spectra.app", isDirectory: true)
        let appNative = try makeExecutable(
            app.appendingPathComponent("Contents/Helpers/spectra-native")
        )
        try expectEqual(
            BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_PATH": app.path,
                ],
                defaultHome: home.path
            ),
            appNative.path,
            "app bundle"
        )

        try expectEqual(
            BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "development",
                    "HOME": home.path,
                ],
                defaultHome: root.appendingPathComponent("wrong-home").path
            ),
            homeNative.path,
            "development HOME"
        )

        let missingOverride = root.appendingPathComponent("missing-override").path
        try expectHelperFailure(path: missingOverride, label: "invalid override") {
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                overrideEnvironmentKey: "SPECTRA_NATIVE_HELPER_PATH",
                environment: [
                    "SPECTRA_NATIVE_HELPER_PATH": missingOverride,
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_HELPERS_DIR": bundleHelpers.path,
                    "HOME": home.path,
                ],
                defaultHome: home.path
            )
        }

        let emptyBundle = root.appendingPathComponent("empty-bundle", isDirectory: true)
        try FileManager.default.createDirectory(at: emptyBundle, withIntermediateDirectories: true)
        try expectHelperFailure(
            path: emptyBundle.appendingPathComponent("spectra-native").path,
            label: "bundle missing helper does not fall through"
        ) {
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_HELPERS_DIR": emptyBundle.path,
                    "HOME": home.path,
                ],
                defaultHome: home.path
            )
        }

        let nonExecutableBundle = root.appendingPathComponent("non-executable-bundle", isDirectory: true)
        let nonExecutable = try makeFile(
            nonExecutableBundle.appendingPathComponent("spectra-native"),
            permissions: 0o644
        )
        try expectHelperFailure(path: nonExecutable.path, label: "bundle non-executable does not fall through") {
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_HELPERS_DIR": nonExecutableBundle.path,
                    "HOME": home.path,
                ],
                defaultHome: home.path
            )
        }

        let directoryHelpers = root.appendingPathComponent("directory-helper", isDirectory: true)
        let helperDirectory = directoryHelpers.appendingPathComponent("spectra-native", isDirectory: true)
        try FileManager.default.createDirectory(at: helperDirectory, withIntermediateDirectories: true)
        try expectHelperFailure(path: helperDirectory.path, label: "bundle helper must be a file") {
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_HELPERS_DIR": directoryHelpers.path,
                ],
                defaultHome: home.path
            )
        }

        let movedApp = root.appendingPathComponent("Moved-Spectra.app", isDirectory: true)
        try expectHelperFailure(
            path: movedApp.appendingPathComponent("Contents/Helpers/spectra-native").path,
            label: "moved bundle"
        ) {
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: [
                    "SPECTRA_HELPER_MODE": "bundle",
                    "SPECTRA_APP_BUNDLE_PATH": movedApp.path,
                    "HOME": home.path,
                ],
                defaultHome: home.path
            )
        }

        try expectError(BundleHelperPathError.self, label: "missing mode does not use HOME") {
            try BundleHelperPaths.resolveExecutable(
                helperName: "spectra-native",
                environment: ["HOME": home.path],
                defaultHome: home.path
            )
        }

        let cursorOverride = try makeExecutable(root.appendingPathComponent("override-cursor"))
        try expectEqual(
            BundleHelperPaths.resolveExecutable(
                helperName: "spectra-cursor-sampler",
                overrideEnvironmentKey: "SPECTRA_CURSOR_SAMPLER_PATH",
                environment: ["SPECTRA_CURSOR_SAMPLER_PATH": cursorOverride.path],
                defaultHome: home.path
            ),
            cursorOverride.path,
            "cursor override"
        )

        print("bundle-helper-paths-contract: PASS")
    }

    private static func makeExecutable(_ url: URL) throws -> URL {
        try makeFile(url, permissions: 0o755)
    }

    private static func makeFile(_ url: URL, permissions: Int) throws -> URL {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: url)
        try FileManager.default.setAttributes(
            [.posixPermissions: permissions],
            ofItemAtPath: url.path
        )
        return url
    }

    private static func expectEqual(_ actual: String, _ expected: String, _ label: String) throws {
        guard actual == expected else {
            throw ContractFailure.assertion("\(label): expected \(expected), got \(actual)")
        }
    }

    private static func expectHelperFailure(
        path expectedPath: String,
        label: String,
        _ body: () throws -> String
    ) throws {
        do {
            _ = try body()
            throw ContractFailure.assertion("\(label): expected resolution failure")
        } catch let error as BundleHelperPathError {
            guard case .helperNotExecutable(_, let path, _) = error else {
                throw ContractFailure.assertion("\(label): wrong resolver error \(error)")
            }
            guard path == expectedPath else {
                throw ContractFailure.assertion("\(label): expected path \(expectedPath), got \(path)")
            }
        }
    }

    private static func expectError<T: Error>(
        _ type: T.Type,
        label: String,
        _ body: () throws -> String
    ) throws {
        do {
            _ = try body()
            throw ContractFailure.assertion("\(label): expected resolution failure")
        } catch is T {
            return
        }
    }
}
SWIFT

swiftc "$RESOLVER" "$HARNESS" -o "$BIN"
"$BIN" "$TMP_DIR/cases"
