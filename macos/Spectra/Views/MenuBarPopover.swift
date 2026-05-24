// MenuBarPopover.swift
//
// The popover content shown when the user clicks the menu-bar icon.
// Thin render layer: all state lives in SpectraViewModel.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import SwiftUI

struct MenuBarPopover: View {
    @Bindable var vm: SpectraViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // ─── Header ──────────────────────────────────────
            HStack {
                Text("Spectra")
                    .font(.headline)
                Spacer()
                statusPill
            }

            Divider()

            // ─── Accessibility panel (conditional) ───────────
            if vm.showAccessibilityPanel {
                AccessibilityPanel(vm: vm)
            }

            // ─── Daemon-not-running CTA ──────────────────────
            if case .unreachable = vm.daemonStatus {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "bolt.slash.fill")
                        .foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Daemon not running")
                            .font(.system(size: 12, weight: .medium))
                        Text("Install the LaunchAgent to keep it running across reboots.")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                        Button("Install daemon") {
                            Task { await vm.installDaemon() }
                        }
                        .controlSize(.small)
                    }
                    Spacer()
                }
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.orange.opacity(0.08))
                )
            }

            // ─── Repo picker ─────────────────────────────────
            RepoPicker(vm: vm)

            // ─── Instructions field ──────────────────────────
            VStack(alignment: .leading, spacing: 4) {
                Text("Walkthrough instructions")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextEditor(text: $vm.instructionText)
                    .font(.system(size: 12))
                    .frame(minHeight: 60, maxHeight: 80)
                    .padding(4)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.gray.opacity(0.25), lineWidth: 1)
                    )
            }

            // ─── Action buttons ──────────────────────────────
            HStack(spacing: 8) {
                Button {
                    Task { await vm.startSession() }
                } label: {
                    Label("Start", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!vm.canStart)

                Button {
                    Task { await vm.stopSession() }
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                        .frame(maxWidth: .infinity)
                }
                .disabled(!vm.canStop)

                Button {
                    vm.revealSession()
                } label: {
                    Label("Save", systemImage: "folder")
                        .frame(maxWidth: .infinity)
                }
                .disabled(!vm.canSave)
            }
            .controlSize(.regular)

            HStack(spacing: 8) {
                Button {
                    Task { await vm.runWalkthrough() }
                } label: {
                    if vm.walkthroughRunning {
                        HStack(spacing: 4) {
                            ProgressView().controlSize(.mini)
                            Text("Running…")
                        }
                    } else {
                        Label("Run walkthrough", systemImage: "wand.and.stars")
                    }
                }
                .controlSize(.small)
                .disabled(!vm.canRunWalkthrough)

                Spacer()

                Button {
                    vm.showSettings = true
                } label: {
                    Image(systemName: "gearshape")
                }
                .buttonStyle(.plain)
                .controlSize(.small)
                .help("Settings")
            }

            if !vm.apiKeyPresent {
                Text("Add an Anthropic API key in Settings to enable walkthroughs.")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }

            if let outcome = vm.lastWalkthroughOutcomeText {
                Text(outcome)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // ─── Sessions list ───────────────────────────────
            if !vm.sessions.isEmpty {
                Divider()
                Text("Sessions")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(vm.sessions.prefix(3)) { s in
                        HStack {
                            Image(systemName: "circle.fill")
                                .font(.system(size: 6))
                                .foregroundStyle(s.id == vm.activeSessionId ? Color.red : Color.secondary)
                            Text(s.name)
                                .font(.system(size: 11))
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer()
                            Text("\(s.steps) steps")
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            // ─── Error toast ─────────────────────────────────
            if let err = vm.lastErrorMessage {
                HStack(alignment: .top) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.yellow)
                    Text(err)
                        .font(.system(size: 11))
                        .foregroundStyle(.primary)
                    Spacer()
                    Button {
                        vm.clearError()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.yellow.opacity(0.10))
                )
            }

            Divider()

            // ─── Footer ──────────────────────────────────────
            HStack {
                Text(vm.headerStatus)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Quit") {
                    NSApp.terminate(nil)
                }
                .controlSize(.small)
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .frame(width: 380)
        .onAppear {
            vm.onPopoverShow()
        }
        .onDisappear {
            vm.onPopoverHide()
        }
        .sheet(isPresented: $vm.showSettings) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Settings")
                        .font(.headline)
                    Spacer()
                    Button("Done") { vm.showSettings = false }
                }
                .padding(.top, 8)
                .padding(.horizontal, 14)
                Divider()
                SettingsView(vm: vm)
            }
            .frame(minWidth: 380)
        }
    }

    @ViewBuilder
    private var statusPill: some View {
        switch vm.daemonStatus {
        case .ready:
            Text(vm.isRecording ? "REC" : "Ready")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(vm.isRecording ? Color.red : Color.green)
        case .unreachable:
            Text("Offline")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color.secondary)
        case .versionSkew:
            Text("Update")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color.orange)
        case .unknown:
            Text("…")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }
}
