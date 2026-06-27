// ScreenshotHarness.swift
//
// DEBUG-only off-screen renderer for deterministic UI verification. When the
// app launches with the `SPECTRA_SCREENSHOT=<dir>` environment variable set,
// `applicationDidFinishLaunching` calls `ScreenshotHarness.runIfRequested()`,
// which renders the popover / settings / first-run states via SwiftUI's
// `ImageRenderer` to PNGs in <dir>, then exits the process.
//
// Why this exists: a MenuBarExtra popover is awkward to drive and capture
// live, and "built ≠ working" — compile-green proves nothing about pixels.
// This harness renders the EXACT shipped views against representative popover
// material backings (light + dark) so before/after comparisons are
// reproducible. It is excluded from Release builds and never wired into the
// shipped menu-bar surface.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

#if DEBUG
import SwiftUI
import AppKit

@MainActor
enum ScreenshotHarness {

    /// Approximate the macOS menu-bar popover vibrancy material so token
    /// contrast is judged against the real backing, not a clear canvas.
    /// Light "menu" material ≈ near-white; dark ≈ deep gray.
    private static let lightBacking = Color(nsColor: NSColor(calibratedWhite: 0.96, alpha: 1.0))
    private static let darkBacking = Color(nsColor: NSColor(calibratedWhite: 0.13, alpha: 1.0))

    static func runIfRequested() {
        guard let dirPath = ProcessInfo.processInfo.environment["SPECTRA_SCREENSHOT"],
              !dirPath.isEmpty else { return }

        let outDir = URL(fileURLWithPath: dirPath)
        try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

        let populated = SpectraViewModel.previewPopulated()
        let firstRun = SpectraViewModel.previewFirstRun()
        let settingsVM = SpectraViewModel.previewPopulated()

        // Popover — the primary surface — in both schemes.
        render(MenuBarPopover(vm: populated), name: "popover-light", dir: outDir, dark: false)
        render(MenuBarPopover(vm: populated), name: "popover-dark", dir: outDir, dark: true)

        // First-run popover (offline service + accessibility panel) light.
        render(MenuBarPopover(vm: firstRun), name: "firstrun-light", dir: outDir, dark: false)

        // Settings sheet content, both schemes.
        render(SettingsView(vm: settingsVM).frame(width: 380), name: "settings-light", dir: outDir, dark: false)
        render(SettingsView(vm: settingsVM).frame(width: 380), name: "settings-dark", dir: outDir, dark: true)

        // Isolated accessibility panel (intent card) light.
        render(
            AccessibilityPanel(vm: firstRun).frame(width: 352).padding(14),
            name: "accessibility-light", dir: outDir, dark: false
        )

        FileHandle.standardError.write(Data("[ScreenshotHarness] wrote PNGs to \(outDir.path)\n".utf8))
        exit(0)
    }

    private static func render<V: View>(_ view: V, name: String, dir: URL, dark: Bool) {
        let scheme: ColorScheme = dark ? .dark : .light
        let backing = dark ? darkBacking : lightBacking

        let composed = view
            .padding(0)
            .background(backing)
            .environment(\.colorScheme, scheme)

        let renderer = ImageRenderer(content: composed)
        renderer.scale = 2.0
        renderer.isOpaque = true

        guard let image = renderer.nsImage,
              let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            FileHandle.standardError.write(Data("[ScreenshotHarness] FAILED to render \(name)\n".utf8))
            return
        }
        try? png.write(to: dir.appendingPathComponent("\(name).png"))
    }
}
#endif
