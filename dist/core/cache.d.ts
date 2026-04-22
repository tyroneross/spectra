export interface CachedResolution {
    intent: string;
    elementId: string;
    role: string;
    label: string;
    confidence: number;
    createdAt: number;
    hits: number;
    lastHit: number;
}
export interface CacheOptions {
    maxEntries?: number;
    ttl?: number;
    minConfidence?: number;
}
export declare class ResolutionCache {
    private cache;
    private maxEntries;
    private ttl;
    private minConfidence;
    constructor(options?: CacheOptions);
    get(intent: string): CachedResolution | null;
    set(intent: string, elementId: string, metadata: {
        role: string;
        label: string;
        confidence: number;
    }): void;
    invalidate(intent: string): void;
    clear(): void;
    stats(): {
        entries: number;
        totalHits: number;
        avgConfidence: number;
    };
    private normalizeKey;
    private evictOldest;
}
//# sourceMappingURL=cache.d.ts.map