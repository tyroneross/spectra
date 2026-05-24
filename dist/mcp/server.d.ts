import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
/** Get the configured McpServer instance (for HTTP transport mounting). */
export declare function getMcpServer(): McpServer;
/** Connect the McpServer to the given transport. Returns when transport is ready. */
export declare function connectTransport(transport: Transport): Promise<void>;
/** Default stdio entry — preserves the existing Claude Code MCP path. */
export declare function startStdio(): Promise<void>;
//# sourceMappingURL=server.d.ts.map