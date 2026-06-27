// RepoPicker.swift
//
// Project-folder selector: a "Choose a folder…" button + a Recent list.
// Selection updates the view-model's selectedRepoPath.
//
// Calm Precision: single border around grouped Recents (Gestalt); three-line
// hierarchy within each row (name / path / metadata); content > chrome.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import SwiftUI

struct RepoPicker: View {
    @Bindable var vm: SpectraViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: SpectraSpacing.sm) {

            // ─── Section header ──────────────────────────────
            HStack {
                Text(SpectraCopy.repoSectionTitle)
                    .font(SpectraText.metadata)
                    .foregroundStyle(.secondary)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button(SpectraCopy.repoBrowseButton) {
                    vm.showBrowseDialog()
                }
                .spectraStandard(size: .small)
                .accessibilityLabel(SpectraCopy.repoBrowseButton)
                .accessibilityHint("Opens a folder picker to choose a project for Spectra to capture.")
            }

            // ─── Selected repo / empty state ─────────────────
            if let display = vm.selectedRepoDisplayName, let path = vm.selectedRepoPath {
                selectedRepoRow(display: display, path: path)
            } else {
                emptyRow
            }

            // ─── Recents ─────────────────────────────────────
            if !vm.recents.isEmpty {
                Text(SpectraCopy.repoRecentsTitle)
                    .font(SpectraText.metadata)
                    .foregroundStyle(.secondary)
                    .padding(.top, SpectraSpacing.xs)
                    .accessibilityAddTraits(.isHeader)

                recentsList
            }
        }
    }

    // MARK: - Subviews

    private func selectedRepoRow(display: String, path: String) -> some View {
        HStack {
            Image(systemName: "folder.fill")
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(display)
                    .font(SpectraText.bodyEmphasized)
                Text(path)
                    .font(SpectraText.metadata)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
        }
        .padding(SpectraSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: SpectraRadius.card)
                .fill(SpectraSurface.subtle)
        )
        .overlay(
            RoundedRectangle(cornerRadius: SpectraRadius.card)
                .strokeBorder(SpectraStroke.hairline, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Selected folder: \(display)")
        .accessibilityValue(path)
    }

    private var emptyRow: some View {
        HStack(spacing: SpectraSpacing.md) {
            Image(systemName: "folder")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(SpectraCopy.repoEmptyMessage)
                .font(SpectraText.description)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(SpectraSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: SpectraRadius.card)
                .fill(SpectraSurface.subtle.opacity(0.5))
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SpectraCopy.repoEmptyMessage)
    }

    // Single border around the whole Recents group, dividers between rows.
    private var recentsList: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(vm.recents) { recent in
                Button {
                    vm.pickRepo(path: recent.path)
                } label: {
                    HStack {
                        Text(recent.displayName)
                            .font(SpectraText.body)
                        Spacer()
                        Text(recent.path)
                            .font(SpectraText.metadata)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .frame(maxWidth: 180, alignment: .trailing)
                    }
                    .contentShape(Rectangle())
                    .padding(.vertical, SpectraSpacing.xs)
                    .padding(.horizontal, SpectraSpacing.md)
                    .frame(minHeight: 24) // WCAG 2.5.8 desktop floor
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open recent folder \(recent.displayName)")
                .accessibilityHint("Located at \(recent.path)")

                if recent.id != vm.recents.last?.id {
                    Divider()
                }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: SpectraRadius.card)
                .fill(SpectraSurface.subtle)
        )
        // Gestalt: a single hairline around the whole Recents group (dividers,
        // already present, separate the rows within it).
        .overlay(
            RoundedRectangle(cornerRadius: SpectraRadius.card)
                .strokeBorder(SpectraStroke.hairline, lineWidth: 1)
        )
    }
}
