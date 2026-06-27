// src/mcp/resources.ts
//
// Coreless MCP resources. These read-only URIs forward to the GUI-session
// daemon via DaemonClient — no in-process core. Resources expose session data
// without a tool round-trip.
//
//   spectra://sessions                       — session list (listSessions)
//   spectra://sessions/{sessionId}/snapshot  — current AX tree (snapshot)
//   spectra://sessions/{sessionId}/state     — UI state analysis (analyze)
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { DaemonClient } from '../client/daemon-client.js'
import type {
  AnalyzeResult,
  ListSessionsResult,
  SnapshotResult,
} from '../contract/core-api.js'

function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as Error).message)
  return String(err)
}

export function registerResources(server: McpServer, client: DaemonClient): void {
  // ── 1. Session list ──────────────────────────────────────────
  server.resource(
    'sessions',
    'spectra://sessions',
    { mimeType: 'application/json', description: 'List of active Spectra sessions' },
    async (uri) => {
      let text: string
      try {
        const res = await client.call<ListSessionsResult>('listSessions', {})
        text = JSON.stringify({ sessions: res.sessions }, null, 2)
      } catch (err) {
        text = JSON.stringify({ error: errorText(err) }, null, 2)
      }
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] }
    },
  )

  // ── 2. Session snapshot (templated) ──────────────────────────
  server.resource(
    'session-snapshot',
    new ResourceTemplate('spectra://sessions/{sessionId}/snapshot', { list: undefined }),
    { mimeType: 'text/plain', description: 'Current AX tree snapshot for a session' },
    async (uri, { sessionId }) => {
      const id = Array.isArray(sessionId) ? sessionId[0] : sessionId
      let text: string
      try {
        const res = await client.call<SnapshotResult>('snapshot', { sessionId: id })
        text = res.snapshot
      } catch (err) {
        text = `Error: ${errorText(err)}`
      }
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] }
    },
  )

  // ── 3. Session state (templated) ─────────────────────────────
  server.resource(
    'session-state',
    new ResourceTemplate('spectra://sessions/{sessionId}/state', { list: undefined }),
    { mimeType: 'application/json', description: 'Current UI state analysis for a session' },
    async (uri, { sessionId }) => {
      const id = Array.isArray(sessionId) ? sessionId[0] : sessionId
      let text: string
      try {
        const res = await client.call<AnalyzeResult>('analyze', { sessionId: id })
        text = JSON.stringify(
          {
            sessionId: id,
            state: res.state,
            confidence: Math.round(res.stateConfidence * 1000) / 1000,
            totalElements: res.totalElements,
          },
          null,
          2,
        )
      } catch (err) {
        text = JSON.stringify({ error: errorText(err) }, null, 2)
      }
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] }
    },
  )
}
