import type { Snapshot } from '../core/types.js';
import type { ChangeResult } from '../intelligence/types.js';
export declare function perceptualHash(pngBuffer: Buffer): bigint;
export declare function hashDistance(a: bigint, b: bigint): number;
export declare function diffSnapshots(before: Snapshot, after: Snapshot): ChangeResult;
export declare function detectChange(beforeBuffer: Buffer, afterBuffer: Buffer, beforeSnap: Snapshot, afterSnap: Snapshot, threshold?: number): ChangeResult;
//# sourceMappingURL=change.d.ts.map