import { NativeBridge } from '../native/bridge.js';
import { type AxBridgePort, type RawAxSnapshot, type RawActRequest, type RawActResult, type RawKeyRequest } from './port.js';
import type { AxTarget } from './types.js';
export declare class NativeAxBridgePort implements AxBridgePort {
    private readonly bridge;
    constructor(bridge?: NativeBridge);
    snapshotFocused(target?: AxTarget): Promise<RawAxSnapshot>;
    act(req: RawActRequest): Promise<RawActResult>;
    key(req: RawKeyRequest): Promise<{
        success: boolean;
        error?: string;
    }>;
    preflight(): Promise<{
        trusted: boolean;
    }>;
}
//# sourceMappingURL=native-port.d.ts.map