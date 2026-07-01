import { NativeBridge } from '../native/bridge.js';
import { type AxBridgePort, type RawAxSnapshot, type RawActRequest, type RawActResult, type RawClickAtRequest, type RawKeyRequest, type RawTypeTextRequest, type RawVisionAvailability, type RawVisionGrounding } from './port.js';
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
    clickAt(req: RawClickAtRequest): Promise<{
        success: boolean;
        error?: string;
    }>;
    typeText(req: RawTypeTextRequest): Promise<{
        success: boolean;
        error?: string;
    }>;
    visionAvailable(target?: AxTarget): Promise<RawVisionAvailability>;
    visionGround(target?: AxTarget): Promise<RawVisionGrounding[]>;
    preflight(): Promise<{
        trusted: boolean;
    }>;
}
//# sourceMappingURL=native-port.d.ts.map