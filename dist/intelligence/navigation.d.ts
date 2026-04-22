import type { Driver, Snapshot } from '../core/types.js';
import type { NavigationGraph, ScreenNode, CrawlOptions } from './types.js';
export declare function fingerprint(snapshot: Snapshot): string;
export declare function crawl(driver: Driver, options?: Partial<CrawlOptions>): Promise<NavigationGraph>;
export declare function discoverByScroll(driver: Driver, maxScrolls?: number): Promise<ScreenNode[]>;
//# sourceMappingURL=navigation.d.ts.map