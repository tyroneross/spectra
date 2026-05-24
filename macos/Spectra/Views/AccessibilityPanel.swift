// AccessibilityPanel.swift
//
// One-time first-run panel asking the user to grant Spectra permission to
// read other apps' content (System Settings → Privacy & Security →
// Accessibility). Without this permission, Spectra can't capture or walk
// through other macOS apps.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import SwiftUI
import ApplicationServices

struct AccessibilityPanel: View {
    @Bindable var vm: SpectraViewModel
    @State private var lastChecked: Bool = false

    private static let dismissedKey = "accessibilityPanel.dismissed.v1"

    var body: some View {
        VStack(alignment: .leading, spacing: SpectraSpacing.lg) {
            // Title row
            HStack(spacing: SpectraSpacing.md) {
                Image(systemName: "lock.shield")
                    .font(.title2)
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
                Text(SpectraCopy.accessibilityPanelTitle)
                    .font(SpectraText.title)
            }

            // Body copy — plain language, no "AX tree"
            Text(SpectraCopy.accessibilityPanelBody)
                .font(SpectraText.description)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)

            // Action row — prominent primary, standard secondary
            HStack(spacing: SpectraSpacing.md) {
                Button(SpectraCopy.accessibilityOpenButton) {
                    openAccessibilitySettings()
                }
                .spectraProminent(size: .small)
                .accessibilityLabel(SpectraCopy.accessibilityOpenButton)
                .accessibilityHint("Opens System Settings to the Accessibility privacy pane.")

                Button(SpectraCopy.accessibilityCheckButton) {
                    lastChecked = AXIsProcessTrusted()
                    if lastChecked { dismiss() }
                }
                .spectraStandard(size: .small)
                .accessibilityLabel(SpectraCopy.accessibilityCheckButton)
                .accessibilityHint("Re-checks whether the permission has been granted.")

                Spacer()

                Button(SpectraCopy.accessibilitySkipButton) {
                    dismiss()
                }
                .spectraStandard(size: .small)
                .accessibilityLabel(SpectraCopy.accessibilitySkipButton)
                .accessibilityHint("Hides this prompt until next launch. You can grant the permission later.")
            }

            if lastChecked {
                HStack(spacing: SpectraSpacing.sm) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .accessibilityHidden(true)
                    Text(SpectraCopy.accessibilityGrantedLine)
                        .font(SpectraText.metadata)
                        .foregroundStyle(.green)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(SpectraCopy.accessibilityGrantedLine)
            }
        }
        .padding(SpectraSpacing.lg)
        .background(
            RoundedRectangle(cornerRadius: SpectraRadius.panel)
                .fill(SpectraSurface.info)
        )
    }

    private func openAccessibilitySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    private func dismiss() {
        UserDefaults.standard.set(true, forKey: Self.dismissedKey)
        vm.showAccessibilityPanel = false
    }

    /// Static check used at app launch to decide whether to surface the panel.
    static func shouldShow() -> Bool {
        let dismissed = UserDefaults.standard.bool(forKey: Self.dismissedKey)
        if dismissed { return false }
        return !AXIsProcessTrusted()
    }
}
