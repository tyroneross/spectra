import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { DaemonClient } from '../client/daemon-client.js';
/**
 * Build a coreless Spectra MCP server bound to the given daemon client. The
 * client is injectable so tests can point it at a mock daemon.
 */
export declare function createSpectraServer(client: DaemonClient): McpServer;
/** Get the default McpServer instance (for HTTP transport mounting). */
export declare function getMcpServer(): McpServer;
/** Connect the default McpServer to the given transport. */
export declare function connectTransport(transport: Transport): Promise<void>;
/** Default stdio entry — the path Claude Code spawns (coreless daemon proxy). */
export declare function startStdio(): Promise<void>;
//# sourceMappingURL=server.d.ts.map