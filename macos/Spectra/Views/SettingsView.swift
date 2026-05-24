// SettingsView.swift
//
// Anthropic API key panel reached from the popover footer ("Settings").
// One field: paste your API key. Save → Keychain. Display confirms presence
// with a single line ("Stored — Touch ID / Mac passcode / Standard"), never
// echoes the key. Tested keys can be deleted with "Remove key".
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import SwiftUI

struct SettingsView: View {
    @Bindable var vm: SpectraViewModel
    @State private var keyDraft: String = ""
    @State private var status: String
    @State private var recoveryError: RecoveryError?

    init(vm: SpectraViewModel) {
        self._vm = Bindable(vm)
        self._status = State(initialValue: SettingsView.currentStatus())
    }

    /// Save is the consequential action — prominent style.
    /// Disabled visual is intentional: muted outline until the user has typed
    /// something to save (user's standing rule on action button states).
    private var canSave: Bool {
        !keyDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var canRemove: Bool {
        KeychainStore.shared.hasApiKey()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: SpectraSpacing.md) {
            Text(SpectraCopy.settingsKeyTitle)
                .font(SpectraText.title)

            Text(SpectraCopy.settingsKeyHelp)
                .font(SpectraText.description)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            SecureField(SpectraCopy.settingsKeyPlaceholder, text: $keyDraft)
                .textFieldStyle(.roundedBorder)
                .font(SpectraText.body)
                .accessibilityLabel(SpectraCopy.settingsKeyTitle)
                .accessibilityHint("Paste your Anthropic API key. It is stored in your Mac's Keychain.")
                .submitLabel(.done)
                .onSubmit { if canSave { save() } }

            // Action row — two distinct emphasis levels.
            HStack(spacing: SpectraSpacing.md) {
                Button {
                    save()
                } label: {
                    Label(SpectraCopy.settingsSaveButton, systemImage: "lock.shield")
                }
                .spectraProminent()
                .disabled(!canSave)
                .accessibilityLabel(SpectraCopy.settingsSaveButton)
                .accessibilityHint(canSave
                    ? "Saves the key into your Mac's Keychain."
                    : "Paste a key first to enable Save."
                )
                .keyboardShortcut(.return, modifiers: [.command])

                Button {
                    remove()
                } label: {
                    Label(SpectraCopy.settingsRemoveButton, systemImage: "trash")
                }
                .spectraStandard()
                .disabled(!canRemove)
                .accessibilityLabel(SpectraCopy.settingsRemoveButton)
                .accessibilityHint(canRemove
                    ? "Deletes the stored key from your Keychain."
                    : "No key is currently stored."
                )

                Spacer()

                Text(status)
                    .font(SpectraText.metadata)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Key status: \(status)")
            }

            if let err = recoveryError {
                errorBanner(err)
            }
        }
        .padding(SpectraSpacing.xl)
        .frame(minWidth: 380)
    }

    // MARK: - Error banner

    @ViewBuilder
    private func errorBanner(_ err: RecoveryError) -> some View {
        HStack(alignment: .top, spacing: SpectraSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: SpectraSpacing.xs) {
                Text(err.title)
                    .font(SpectraText.bodyEmphasized)
                Text(err.suggestion)
                    .font(SpectraText.description)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(SpectraSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: SpectraRadius.card)
                .fill(SpectraSurface.warning)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(err.title). \(err.suggestion)")
    }

    // MARK: - Actions

    private func save() {
        recoveryError = nil
        let trimmed = keyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let level = try KeychainStore.shared.saveApiKey(trimmed)
            keyDraft = ""
            status = SpectraCopy.keyStoredLine(level: level)
            vm.apiKeyPresent = true
        } catch {
            recoveryError = RecoveryError.from(error, defaultTitle: SpectraCopy.errorKeySaveTitle)
        }
    }

    private func remove() {
        recoveryError = nil
        do {
            try KeychainStore.shared.deleteApiKey()
            status = SpectraCopy.keyNotStoredLine
            vm.apiKeyPresent = false
        } catch {
            recoveryError = RecoveryError.from(error, defaultTitle: SpectraCopy.errorKeyRemoveTitle)
        }
    }

    private static func currentStatus() -> String {
        if KeychainStore.shared.hasApiKey() {
            return SpectraCopy.keyStoredLine(level: KeychainStore.shared.lastSecurityLevel)
        }
        return SpectraCopy.keyNotStoredLine
    }
}
