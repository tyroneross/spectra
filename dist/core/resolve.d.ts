import type { ResolveOptions, ResolveResult } from './types.js';
export declare function resolve(options: ResolveOptions): ResolveResult;
export interface SpatialHints {
    position?: 'first' | 'last' | 'top' | 'bottom';
    near?: string;
    direction?: 'above' | 'below' | 'left' | 'right' | 'near';
    reference?: string;
    ordinal?: number;
}
export declare function parseSpatialHints(intent: string): SpatialHints;
export declare function jaroWinkler(s1: string, s2: string, prefixScale?: number): number;
//# sourceMappingURL=resolve.d.ts.map