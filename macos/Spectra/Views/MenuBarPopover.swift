// MenuBarPopover.swift
//
// The popover content shown when the user clicks the menu-bar icon.
// Thin render layer: all state lives in SpectraViewModel. Calm Precision
// rules applied throughout — single borders, three-line hierarchy, content
// over chrome, plain language.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import SwiftUI

struct MenuBarPopover: View {
    @Bindable var vm: SpectraViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: SpectraSpacing.lg) {

            // ─── Header ──────────────────────────────────────
            HStack {
                Text("Spectra")
                    .font(SpectraText.title)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                statusPill
            }

            Divider()

            // ─── Accessibility-permission panel (conditional) ───
            if vm.showAccessibilityPanel {
                AccessibilityPanel(vm: vm)
            }

            // ─── Helper-offline CTA (conditional) ────────────
            if case .unreachable = vm.daemonStatus {
                helperOfflineCard
            }

            // ─── Repo picker ─────────────────────────────────
            RepoPicker(vm: vm)

            // ─── Walkthrough instruction field ───────────────
            walkthroughField

            // ─── Primary action row ──────────────────────────
            primaryActions

            // ─── Walkthrough + Settings row ──────────────────
            walkthroughAndSettings

            // ─── Setup hints ─────────────────────────────────
            if !vm.apiKeyPresent {
                hintLine(SpectraCopy.keyMissingHint)
            }

            if let outcome = vm.lastWalkthroughOutcomeText {
                Text(outcome)
                    .font(SpectraText.metadata)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Latest walkthrough outcome: \(outcome)")
            }

            // ─── Sessions list (loadable) ────────────────────
            sessionsSection

            // ─── Error toast (recovery-shaped) ───────────────
            if let err = vm.recoveryError {
                errorToast(err)
            }

            Divider()

            // ─── Footer ──────────────────────────────────────
            footer
        }
        .padding(SpectraSpacing.xl)
        .frame(width: 380)
        .onAppear { vm.onPopoverShow() }
        .onDisappear { vm.onPopoverHide() }
        .sheet(isPresented: $vm.showSettings) {
            settingsSheet
        }
    }

    // MARK: - Helper-offline card

    private var helperOfflineCard: some View {
        HStack(alignment: .top, spacing: SpectraSpacing.md) {
            Image(systemName: "bolt.slash.fill")
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: SpectraSpacing.xs) {
                Text(SpectraCopy.helperOfflineTitle)
                    .font(SpectraText.bodyEmphasized)
                Text(SpectraCopy.helperOfflineBody)
                    .font(SpectraText.description)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button(SpectraCopy.helperInstallButton) {
                    Task { await vm.installDaemon() }
                }
                .spectraProminent(size: .small)
                .padding(.top, SpectraSpacing.xs)
                .accessibilityLabel(SpectraCopy.helperInstallButton)
                .accessibilityHint("Installs and starts Spectra's background helper. Required for capture and walkthroughs.")
            }
            Spacer()
        }
        .padding(SpectraSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: SpectraRadius.card)
                .fill(SpectraSurface.warning)
        )
        .accessibilityElement(children: .contain)
    }

    // MARK: - Walkthrough field

    private var walkthroughField: some View {
        VStack(alignment: .leading, spacing: SpectraSpacing.xs) {
            Text(SpectraCopy.walkthroughFieldTitle)
                .font(SpectraText.metadata)
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)
            ZStack(alignment: .topLeading) {
                if vm.instructionText.isEmpty {
                    Text(SpectraCopy.walkthroughPlaceholder)
                        .font(SpectraText.description)
                        .foregroundStyle(.tertiary)
                        .padding(SpectraSpacing.sm)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                TextEditor(text: $vm.instructionText)
                    .font(SpectraText.body)
                    .frame(minHeight: 60, maxHeight: 80)
                    .padding(SpectraSpacing.xs)
                    .scrollContentBackground(.hidden)
                    .background(Color.clear)
                    .accessibilityLabel("Walkthrough instructions")
                    .accessibilityHint("Describe in plain language what Spectra should walk through.")
            }
            .background(
                RoundedRectangle(cornerRadius: SpectraRadius.card)
                    .stroke(SpectraStroke.input, lineWidth: 1)
            )
        }
    }

    // MARK: - Primary action row

    // Fitts: button size = intent weight. Start is the headline action, so it
    // gets the full-width prominent slot. Stop + Open in Finder are secondary,
    // sharing a row of equal compact buttons. Single-line labels (`lineLimit`)
    // keep the row from going ragged the way three wrapping buttons did.
    private var primaryActions: some View {
        VStack(spacing: SpectraSpacing.md) {
            Button {
                Task { await vm.startSession() }
            } label: {
                Label(SpectraCopy.startButton, systemImage: "play.fill")
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)
            }
            .spectraProminent()
            .disabled(!vm.canStart)
            .accessibilityLabel(SpectraCopy.startButton)
            .accessibilityHint(vm.canStart
                ? "Begins capturing the chosen project folder."
                : "Choose a project folder and make sure the background service is ready to enable Start."
            )
            .keyboardShortcut("s", modifiers: [.command])

            HStack(spacing: SpectraSpacing.md) {
                Button {
                    Task { await vm.stopSession() }
                } label: {
                    Label(SpectraCopy.stopButton, systemImage: "stop.fill")
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                }
                .spectraStandard()
                .disabled(!vm.canStop)
                .accessibilityLabel(SpectraCopy.stopButton)
                .accessibilityHint(vm.canStop
                    ? "Stops the active capture session."
                    : "No active session to stop."
                )

                Button {
                    vm.revealSession()
                } label: {
                    Label(SpectraCopy.revealButton, systemImage: "folder")
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                }
                .spectraStandard()
                .disabled(!vm.canSave)
                .accessibilityLabel(SpectraCopy.revealButton)
                .accessibilityHint(vm.canSave
                    ? "Opens the captured session in Finder."
                    : "Start a session first to enable Open in Finder."
                )
            }
        }
    }

    // MARK: - Walkthrough + Settings row

    private var walkthroughAndSettings: some View {
        HStack(spacing: SpectraSpacing.md) {
            Button {
                Task { await vm.runWalkthrough() }
            } label: {
                if vm.walkthroughRunning {
                    HStack(spacing: SpectraSpacing.xs) {
                        ProgressView().controlSize(.mini)
                        Text(SpectraCopy.walkthroughRunningLabel)
                    }
                } else {
                    Label(SpectraCopy.walkthroughRunButton, systemImage: "wand.and.stars")
                }
            }
            .spectraProminent(size: .small)
            .disabled(!vm.canRunWalkthrough)
            .accessibilityLabel(SpectraCopy.walkthroughRunButton)
            .accessibilityHint(walkthroughHint)
            .accessibilityValue(vm.walkthroughRunning ? "Running" : "Idle")

            Spacer()

            Button {
                vm.showSettings = true
            } label: {
                Image(systemName: "gearshape")
                    .imageScale(.medium)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SpectraCopy.settingsLabel)
            .accessibilityHint(SpectraCopy.settingsHint)
            .help(SpectraCopy.settingsLabel)
            .keyboardShortcut(",", modifiers: [.command])
        }
    }

    private var walkthroughHint: String {
        if vm.walkthroughRunning { return "A walkthrough is in progress." }
        if !vm.apiKeyPresent { return "Add an Anthropic API key in Settings to enable walkthroughs." }
        if vm.activeSessionId == nil { return "Start a capture session first." }
        if vm.instructionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Type what Spectra should walk through, then press Run."
        }
        return "Runs the AI walkthrough using your instructions."
    }

    // MARK: - Sessions

    @ViewBuilder
    private var sessionsSection: some View {
        if case .ready = vm.daemonStatus {
            Divider()
            Text(SpectraCopy.sessionsHeader)
                .font(SpectraText.metadata)
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)

            if vm.sessions.isEmpty {
                Text(SpectraCopy.sessionsEmptyHint)
                    .font(SpectraText.metadata)
                    .foregroundStyle(.tertiary)
                    .accessibilityLabel(SpectraCopy.sessionsEmptyHint)
            } else {
                VStack(alignment: .leading, spacing: SpectraSpacing.xs) {
                    ForEach(vm.sessions.prefix(3)) { s in
                        sessionRow(s)
                    }
                }
            }
        }
    }

    private func sessionRow(_ s: SessionListItem) -> some View {
        let isActive = s.id == vm.activeSessionId
        return HStack {
            Image(systemName: "circle.fill")
                .font(.system(size: 6))
                .foregroundStyle(isActive ? Color.red : Color.secondary)
                .accessibilityHidden(true)
            Text(s.name)
                .font(SpectraText.metadata)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
            Text("\(s.steps) steps")
                .font(SpectraText.micro)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(isActive ? "Active session" : "Session") \(s.name), \(s.steps) steps")
    }

    // MARK: - Error toast

    private func errorToast(_ err: RecoveryError) -> some View {
        HStack(alignment: .top, spacing: SpectraSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: SpectraSpacing.xs) {
                Text(err.title)
                    .font(SpectraText.bodyEmphasized)
                Text(err.suggestion)
                    .font(SpectraText.metadata)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button {
                vm.clearError()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SpectraCopy.dismissLabel)
            .accessibilityHint("Hides this error message.")
        }
        .padding(SpectraSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: SpectraRadius.card)
                .fill(SpectraSurface.warning)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(err.title). \(err.suggestion)")
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            Text(SpectraCopy.helperStatusLine(vm.daemonStatus, isRecording: vm.isRecording, hasActiveSession: vm.activeSessionId != nil))
                .font(SpectraText.micro)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Status: \(SpectraCopy.helperStatusLine(vm.daemonStatus, isRecording: vm.isRecording, hasActiveSession: vm.activeSessionId != nil))")
            Spacer()
            Button(SpectraCopy.quitLabel) {
                NSApp.terminate(nil)
            }
            .buttonStyle(.plain)
            .font(SpectraText.metadata)
            .foregroundStyle(.secondary)
            .accessibilityLabel(SpectraCopy.quitLabel)
            .accessibilityHint(SpectraCopy.quitHint)
            .keyboardShortcut("q", modifiers: [.command])
        }
    }

    // MARK: - Hint line

    private func hintLine(_ text: String) -> some View {
        HStack(spacing: SpectraSpacing.xs) {
            Image(systemName: "info.circle")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(text)
                .font(SpectraText.micro)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
    }

    // MARK: - Status pill

    @ViewBuilder
    private var statusPill: some View {
        switch vm.daemonStatus {
        case .ready:
            statusPillContent(
                text: vm.isRecording ? "Recording" : SpectraCopy.helperReadyShort,
                color: vm.isRecording ? .red : .green,
                a11y: vm.isRecording ? "Recording in progress" : "Background service ready"
            )
        case .unreachable:
            statusPillContent(
                text: SpectraCopy.helperOfflineShort,
                color: .secondary,
                a11y: "Background service offline"
            )
        case .versionSkew:
            statusPillContent(
                text: SpectraCopy.helperUpdateShort,
                color: .orange,
                a11y: "Background service needs an update"
            )
        case .unknown:
            statusPillContent(
                text: SpectraCopy.helperCheckingShort,
                color: .secondary,
                a11y: "Checking background service"
            )
        }
    }

    private func statusPillContent(text: String, color: Color, a11y: String) -> some View {
        Text(text)
            .font(SpectraText.metadata.weight(.medium))
            .foregroundStyle(color)
            .accessibilityLabel(a11y)
    }

    // MARK: - Settings sheet

    private var settingsSheet: some View {
        VStack(alignment: .leading, spacing: SpectraSpacing.lg) {
            HStack {
                Text(SpectraCopy.settingsSheetTitle)
                    .font(SpectraText.title)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button(SpectraCopy.settingsDoneButton) {
                    vm.showSettings = false
                }
                .spectraStandard(size: .small)
                .accessibilityLabel(SpectraCopy.settingsDoneButton)
                .accessibilityHint("Closes the settings panel.")
                .keyboardShortcut(.cancelAction)
            }
            .padding(.top, SpectraSpacing.md)
            .padding(.horizontal, SpectraSpacing.xl)
            Divider()
            SettingsView(vm: vm)
        }
        .frame(minWidth: 400)
    }
}
