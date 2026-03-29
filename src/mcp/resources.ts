import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from './context.js'
import { serializeSnapshot } from '../core/serialize.js'
import { detectState } from '../intelligence/states.js'

/**
 * Register all Spectra MCP resources onto the given server.
 *
 * Resources expose session data as read-only URIs that Claude Code can
 * access without tool calls — reducing round-trips for inspection tasks.
 *
 * Resources registered:
 *   spectra://sessions                          — session list
 *   spectra://sessions/{sessionId}/snapshot     — current AX tree (text/plain)
 *   spectra://sessions/{sessionId}/state        — UI state analysis (application/json)
 */
export function registerResources(server: McpServer, ctx: ToolContext): void {
  // ── 1. Session list ──────────────────────────────────────────────────────────
  server.resource(
    'sessions',
    'spectra://sessions',
    { mimeType: 'application/json', description: 'List of active Spectra sessions' },
    async (uri) => {
      const sessions = ctx.sessions.list().map((s) => ({
        id: s.id,
        name: s.name,
        platform: s.platform,
        steps: s.steps.length,
        createdAt: new Date(s.createdAt).toISOString(),
      }))

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ sessions }, null, 2),
          },
        ],
      }
    },
  )

  // ── 2. Session snapshot (templated) ─────────────────────────────────────────
  server.resource(
    'session-snapshot',
    new ResourceTemplate('spectra://sessions/{sessionId}/snapshot', { list: undefined }),
    { mimeType: 'text/plain', description: 'Current AX tree snapshot for a session' },
    async (uri, { sessionId }) => {
      const id = Array.isArray(sessionId) ? sessionId[0] : sessionId
      const driver = ctx.drivers.get(id)
      if (!driver) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error: Session "${id}" not found`,
            },
          ],
        }
      }

      const snap = await driver.snapshot()
      const text = serializeSnapshot(snap)

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/plain',
            text,
          },
        ],
      }
    },
  )

  // ── 3. Session state (templated) ─────────────────────────────────────────────
  server.resource(
    'session-state',
    new ResourceTemplate('spectra://sessions/{sessionId}/state', { list: undefined }),
    { mimeType: 'application/json', description: 'Current UI state analysis for a session' },
    async (uri, { sessionId }) => {
      const id = Array.isArray(sessionId) ? sessionId[0] : sessionId
      const driver = ctx.drivers.get(id)
      if (!driver) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ error: `Session "${id}" not found` }),
            },
          ],
        }
      }

      const snap = await driver.snapshot()
      const detection = detectState(snap)

      const result = {
        sessionId: id,
        state: detection.state,
        confidence: Math.round(detection.confidence * 1000) / 1000,
        indicators: detection.indicators,
        elementCount: snap.elements.length,
        timestamp: snap.timestamp,
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    },
  )
}
