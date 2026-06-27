import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Capability, type ClientSurface, type DaemonEvent } from '../contract/wire.js';
import type { CoreApi } from '../contract/core-api.js';
import { type UnixPeerCredentialResolver } from './security.js';
type TransportKind = 'unix' | 'tcp';
export interface DaemonTcpOptions {
    enabled?: boolean;
    host?: string;
    port?: number;
    allowedOrigins: string[];
    tokenPath?: string;
    token?: string;
    capabilities?: Capability[];
    surface?: ClientSurface;
}
export interface DaemonUnixOptions {
    enabled?: boolean;
    capabilities?: Capability[];
    surface?: ClientSurface;
    peerCredentials?: UnixPeerCredentialResolver;
    enforceSocketMode?: boolean;
}
export interface DaemonServerOptions {
    api?: CoreApi;
    socketPath?: string;
    unix?: DaemonUnixOptions;
    tcp?: DaemonTcpOptions;
}
export interface RunningDaemonServer {
    api: CoreApi;
    socketPath?: string;
    tcpPort?: number;
    tcpToken?: string;
    emit(event: DaemonEvent): void;
    close(): Promise<void>;
}
export type DaemonRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export declare function startDaemonServer(options?: DaemonServerOptions): Promise<RunningDaemonServer>;
export declare function createDaemonRequestHandler(options: {
    api: CoreApi;
    transport: TransportKind;
    socketPath?: string;
    unix?: DaemonUnixOptions;
    tcp?: DaemonTcpOptions;
}): DaemonRequestHandler;
export {};
//# sourceMappingURL=server.d.ts.map