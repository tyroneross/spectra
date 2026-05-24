import { type Server } from 'node:http';
export interface HttpServerOptions {
    port?: number;
    host?: string;
    overrideHome?: string;
}
export interface RunningHttpServer {
    server: Server;
    port: number;
    token: string;
    close: () => Promise<void>;
}
export declare const DEFAULT_PORT = 47823;
export declare const DEFAULT_HOST = "127.0.0.1";
/**
 * Start an HTTP server that mounts the MCP StreamableHTTPServerTransport.
 * One transport instance per server (stateful mode — sessionIdGenerator is set).
 */
export declare function startHttpServer(opts?: HttpServerOptions): Promise<RunningHttpServer>;
//# sourceMappingURL=http.d.ts.map