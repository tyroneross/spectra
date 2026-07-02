// macos/Spectra/DaemonCore/PermissionOps.swift
// M3.G1 — permission/window control-plane ops (STUB to be implemented by the
// permissions group): getPermissions, requestPermissions, listWindows.
// These use native macOS APIs (TCC status, CGWindowListCopyWindowInfo) — EASIER
// in Swift than the TS shell-out. getPermissions/requestPermissions read status
// only (no capture); listWindows enumerates on-screen windows.
// SPDX-License-Identifier: Apache-2.0
import Foundation

func registerPermissionOps(_ registry: HandlerRegistry) {
    // TODO(permissions-group): register the 3 ops, mirroring core-api.ts
    // GetPermissionsResult (PermissionStatus[]) + ListWindowsResult (WindowRecord[]).
}
