// SettingsView.swift
//
// Minimal settings panel exposed from the popover footer ("Settings…").
//
// One field: paste your Anthropic API key. Save → KeychainStore. Display
// confirms presence with a single line ("Stored — Biometric / Passcode /
// Standard") and never echoes the key. Tested keys can be deleted with
// Remove.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import SwiftUI

struct SettingsView: View {
    @Bindable var vm: SpectraViewModel
    @State private var keyDraft: String = ""
    @State private var status: String
    @State private var lastSaveError: String?

    init(vm: SpectraViewModel) {
        self._vm = Bindable(vm)
        self._status = State(initialValue: SettingsView.currentStatus())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Anthropic API key")
                .font(.system(size: 12, weight: .semibold))

            Text("Required for `Run walkthrough`. Stored locally in your Keychain. The daemon never sees it.")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            SecureField("sk-ant-…", text: $keyDraft)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12))

            HStack {
                Button {
                    save()
                } label: {
                    Label("Save", systemImage: "lock.shield")
                }
                .disabled(keyDraft.isEmpty)

                Button {
                    remove()
                } label: {
                    Label("Remove", systemImage: "trash")
                }
                .disabled(!KeychainStore.shared.hasApiKey())

                Spacer()

                Text(status)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }

            if let err = lastSaveError {
                Text(err)
                    .font(.system(size: 11))
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(minWidth: 360)
    }

    private func save() {
        lastSaveError = nil
        do {
            let level = try KeychainStore.shared.saveApiKey(keyDraft)
            keyDraft = ""
            status = Self.statusLine(level: level)
            vm.apiKeyPresent = true
        } catch {
            lastSaveError = error.localizedDescription
        }
    }

    private func remove() {
        lastSaveError = nil
        do {
            try KeychainStore.shared.deleteApiKey()
            status = "No key stored"
            vm.apiKeyPresent = false
        } catch {
            lastSaveError = error.localizedDescription
        }
    }

    private static func currentStatus() -> String {
        if KeychainStore.shared.hasApiKey() {
            return statusLine(level: KeychainStore.shared.lastSecurityLevel)
        }
        return "No key stored"
    }

    private static func statusLine(level: KeychainSecurityLevel) -> String {
        switch level {
        case .biometric: return "Stored — Biometric"
        case .passcode:  return "Stored — Passcode"
        case .standard:  return "Stored — Standard (unsigned build)"
        case .unknown:   return "Stored"
        }
    }
}
