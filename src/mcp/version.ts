// src/mcp/version.ts
//
// Daemon + API version metadata. Read from package.json at startup so
// version drift between package.json and plugin.json is impossible to ship.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// API version. Bump when wire format changes in a way clients must react to.
export const API_VERSION = 1

let cachedDaemonVersion: string | null = null

function readDaemonVersion(): string {
  if (cachedDaemonVersion) return cachedDaemonVersion
  // src/mcp/version.ts → dist/mcp/version.js → ../../package.json
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '..', '..', 'package.json'),
    join(here, '..', '..', '..', 'package.json'),
  ]
  for (const c of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(c, 'utf8'))
      if (typeof pkg.version === 'string') {
        cachedDaemonVersion = pkg.version
        return pkg.version
      }
    } catch { /* try next */ }
  }
  cachedDaemonVersion = '0.0.0-unknown'
  return cachedDaemonVersion
}

export function getVersionInfo(): { apiVersion: number; daemonVersion: string } {
  return { apiVersion: API_VERSION, daemonVersion: readDaemonVersion() }
}
