import type { CoreApiOperation } from '../contract/wire.js';
import type { DaemonClient } from '../client/daemon-client.js';
export interface MappedCall {
    operation: CoreApiOperation;
    params: Record<string, unknown> | undefined;
}
/** Thrown when a tool's dispatch field (type/action) is unrecognized. */
export declare class ToolMappingError extends Error {
    constructor(message: string);
}
type Args = Record<string, unknown>;
/**
 * Map an MCP tool name + raw arguments to a single CoreApi operation call.
 * Dispatched tools (spectra_capture, spectra_session, spectra_demo) resolve the
 * operation from their `type` / `action` field.
 */
export declare function mapToolCall(toolName: string, args?: Args): MappedCall;
/**
 * Map + forward a tool call to the daemon. Returns the raw operation result.
 * DaemonError (actionable) propagates to the caller's error formatter.
 */
export declare function forwardTool(client: DaemonClient, toolName: string, args?: Args): Promise<unknown>;
export {};
//# sourceMappingURL=forward.d.ts.map