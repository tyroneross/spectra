// src/launcher/types.ts
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

export type LaunchKind = 'web-next' | 'web-vite' | 'web-static' | 'macos'

export interface LaunchHandle {
  kind: LaunchKind
  pid?: number              // not set for static (file://) targets
  url?: string              // present for web kinds
  appName?: string          // present for macos
  appPath?: string          // present for macos (built .app path)
  killOnDisconnect: boolean // true → close-session calls kill()
  kill: () => Promise<void>
}

export interface DetectionResult {
  kind: LaunchKind
  startCommand?: string[]   // e.g. ['npm', 'run', 'dev']
  /** For static, the path to index.html or the dir to serve. */
  staticEntry?: string
  /** For macos, the resolved xcodeproj / xcworkspace path. */
  xcodeTarget?: string
}

export class LauncherError extends Error {
  constructor(public reason: string, public hint?: string) {
    super(reason)
    this.name = 'LauncherError'
  }
}
