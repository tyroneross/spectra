import type { Element } from '../core/types.js';
import type { ImportanceScore, RegionOfInterest, Viewport } from './types.js';
export declare function scoreElements(elements: Element[], viewport: Viewport): ImportanceScore[];
export declare function findRegions(scores: ImportanceScore[], elements: Element[]): RegionOfInterest[];
//# sourceMappingURL=importance.d.ts.map