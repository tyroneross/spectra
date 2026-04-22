import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context.js';
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
export declare function registerResources(server: McpServer, ctx: ToolContext): void;
//# sourceMappingURL=resources.d.ts.map