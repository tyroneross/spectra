export class ResolutionCache {
    cache = new Map();
    maxEntries;
    ttl;
    minConfidence;
    constructor(options = {}) {
        this.maxEntries = options.maxEntries ?? 100;
        this.ttl = options.ttl ?? 5 * 60 * 1000;
        this.minConfidence = options.minConfidence ?? 0.7;
    }
    get(intent) {
        const key = this.normalizeKey(intent);
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        if (Date.now() - entry.createdAt > this.ttl) {
            this.cache.delete(key);
            return null;
        }
        entry.hits++;
        entry.lastHit = Date.now();
        return entry;
    }
    set(intent, elementId, metadata) {
        if (metadata.confidence < this.minConfidence)
            return;
        const key = this.normalizeKey(intent);
        if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
            this.evictOldest();
        }
        this.cache.set(key, {
            intent,
            elementId,
            role: metadata.role,
            label: metadata.label,
            confidence: metadata.confidence,
            createdAt: Date.now(),
            hits: 0,
            lastHit: 0,
        });
    }
    invalidate(intent) {
        this.cache.delete(this.normalizeKey(intent));
    }
    clear() {
        this.cache.clear();
    }
    stats() {
        let totalHits = 0;
        let totalConfidence = 0;
        for (const entry of this.cache.values()) {
            totalHits += entry.hits;
            totalConfidence += entry.confidence;
        }
        return {
            entries: this.cache.size,
            totalHits,
            avgConfidence: this.cache.size > 0 ? totalConfidence / this.cache.size : 0,
        };
    }
    normalizeKey(intent) {
        return intent.toLowerCase().trim();
    }
    evictOldest() {
        let oldest = null;
        let oldestTime = Infinity;
        for (const [key, entry] of this.cache) {
            const lastUsed = entry.lastHit || entry.createdAt;
            if (lastUsed < oldestTime) {
                oldestTime = lastUsed;
                oldest = key;
            }
        }
        if (oldest)
            this.cache.delete(oldest);
    }
}
//# sourceMappingURL=cache.js.map