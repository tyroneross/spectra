// AccessibilityPanel.swift
//
// One-time first-run panel prompting the user to grant Accessibility access
// in System Settings. Without it, the daemon's macOS native driver can't
// read the AX tree of other apps.
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
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "lock.shield")
                    .font(.title2)
                    .foregroundStyle(.tint)
                Text("Accessibility Access Required")
                    .font(.headline)
            }

            Text(
                "Spectra reads the accessibility tree of other apps to capture and walk through their UI. macOS requires you to grant Accessibility access in System Settings before this works."
            )
            .font(.system(size: 12))
            .foregroundStyle(.primary)

            HStack(spacing: 8) {
                Button("Open System Settings") {
                    openAccessibilitySettings()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)

                Button("Check Again") {
                    lastChecked = AXIsProcessTrusted()
                    if lastChecked {
                        dismiss()
                    }
                }
                .controlSize(.small)

                Spacer()

                Button("Skip for now") {
                    dismiss()
                }
                .controlSize(.small)
            }

            if lastChecked {
                Text("Granted. You can capture macOS apps now.")
                    .font(.system(size: 11))
                    .foregroundStyle(.green)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.accentColor.opacity(0.08))
        )
    }

    private func openAccessibilitySettings() {
        // The X-Apple URL scheme jumps straight to the Accessibility privacy pane.
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
