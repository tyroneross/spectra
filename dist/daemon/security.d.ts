import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { type ApiErrorBody, type Capability, type ClientSurface, type CoreApiOperation, type LoopbackHttpTransportPolicy, type VerifiedCaller } from '../contract/wire.js';
export type UnixPeerCredentials = {
    uid?: number;
    gid?: number;
    pid?: number;
};
export type UnixPeerCredentialResolver = (socket: Socket) => UnixPeerCredentials | Promise<UnixPeerCredentials>;
export declare const allCapabilities: Capability[];
export declare function normalizeHostHeader(hostHeader: string | null | undefined): string | null;
export declare function isLoopbackHost(hostHeader: string | null | undefined, allowedHosts?: readonly string[]): boolean;
export declare function isAllowedOrigin(originHeader: string | null | undefined, policy?: LoopbackHttpTransportPolicy): boolean;
export declare function authorizeBearerHeader(authorizationHeader: string | null | undefined, token: string): boolean;
export declare function requiredCapabilitiesForOperation<T extends CoreApiOperation>(operation: T): readonly Capability[];
export declare function missingCapabilitiesForOperation(caller: Pick<VerifiedCaller, 'capabilities'>, operation: CoreApiOperation): Capability[];
export declare function callerCanInvoke(caller: Pick<VerifiedCaller, 'capabilities'>, operation: CoreApiOperation): boolean;
export declare class CapabilityDeniedError extends Error {
    readonly operation: CoreApiOperation;
    readonly missingCapabilities: Capability[];
    constructor(operation: CoreApiOperation, missingCapabilities: Capability[]);
}
export declare function assertCallerCanInvoke(caller: Pick<VerifiedCaller, 'capabilities'>, operation: CoreApiOperation): void;
export declare function isCoreApiOperation(value: string): value is CoreApiOperation;
export declare function assertCapabilities(caller: Pick<VerifiedCaller, 'capabilities'>, required: readonly Capability[]): void;
export declare function assertOperationAllowed(operation: CoreApiOperation, caller: Pick<VerifiedCaller, 'capabilities'>): void;
export declare function expandHomePath(path: string): string;
export declare function prepareUnixSocketPath(socketPath: string): Promise<void>;
export interface BearerTokenInfo {
    token: string;
    tokenId: string;
    path: string;
    created: boolean;
}
export declare function getOrCreateBearerToken(tokenPath: string, tokenOverride?: string): Promise<BearerTokenInfo>;
export declare function assertLoopbackTcpRequest(req: IncomingMessage, allowedOrigins?: string[]): void;
export declare function verifyBearerCaller(options: {
    req: IncomingMessage;
    token: string;
    tokenId?: string;
    surface: ClientSurface;
    capabilities: readonly Capability[];
}): VerifiedCaller;
export declare function verifyUnixCaller(options: {
    socket: Socket;
    socketPath: string;
    surface: ClientSurface;
    capabilities: readonly Capability[];
    peerCredentials?: UnixPeerCredentialResolver;
    enforceSocketMode?: boolean;
}): Promise<VerifiedCaller>;
export interface LoopbackRequestHeaders {
    host?: string | null;
    origin?: string | null;
    authorization?: string | null;
}
export type LoopbackRequestVerification = {
    ok: true;
    caller: VerifiedCaller;
} | {
    ok: false;
    status: 401 | 403;
    error: ApiErrorBody;
};
export declare function verifyLoopbackRequest(headers: LoopbackRequestHeaders, token: string, options?: {
    capabilities?: readonly Capability[];
    policy?: LoopbackHttpTransportPolicy;
    surface?: ClientSurface;
    tokenId?: string;
}): LoopbackRequestVerification;
//# sourceMappingURL=security.d.ts.map