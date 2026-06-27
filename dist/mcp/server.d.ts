import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DaemonClient } from '../client/daemon-client.js';
/**
 * Build a coreless Spectra MCP server bound to the given daemon client. The
 * client is injectable so tests can point it at a mock daemon.
 */
export declare function createSpectraServer(client: DaemonClient): McpServer;
/** Default stdio entry — the path Claude Code spawns (coreless daemon proxy). */
export declare function startStdio(): Promise<void>;
//# sourceMappingURL=server.d.ts.map