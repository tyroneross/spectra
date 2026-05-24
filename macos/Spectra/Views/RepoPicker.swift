// RepoPicker.swift
//
// Repo selector: shows a Recents list + a Browse… button. Selection updates
// the view-model's selectedRepoPath.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import SwiftUI

struct RepoPicker: View {
    @Bindable var vm: SpectraViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Repository")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Browse…") {
                    vm.showBrowseDialog()
                }
                .controlSize(.small)
            }

            if let display = vm.selectedRepoDisplayName, let path = vm.selectedRepoPath {
                HStack {
                    Image(systemName: "folder.fill")
                        .foregroundStyle(.tint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(display)
                            .font(.system(size: 13, weight: .medium))
                        Text(path)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer()
                }
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.gray.opacity(0.08))
                )
            } else {
                Text("No repository selected")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(Color.gray.opacity(0.05))
                    )
            }

            if !vm.recents.isEmpty {
                Text("Recents")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)

                VStack(alignment: .leading, spacing: 0) {
                    ForEach(vm.recents) { recent in
                        Button {
                            vm.pickRepo(path: recent.path)
                        } label: {
                            HStack {
                                Text(recent.displayName)
                                    .font(.system(size: 12))
                                Spacer()
                                Text(recent.path)
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .frame(maxWidth: 180, alignment: .trailing)
                            }
                            .contentShape(Rectangle())
                            .padding(.vertical, 4)
                            .padding(.horizontal, 8)
                        }
                        .buttonStyle(.plain)

                        if recent.id != vm.recents.last?.id {
                            Divider()
                        }
                    }
                }
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.gray.opacity(0.04))
                )
            }
        }
    }
}
