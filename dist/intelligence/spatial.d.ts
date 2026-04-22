import type { Element } from '../core/types.js';
/** Axis-aligned edge-to-edge distance between two bounding boxes. */
export declare function edgeDistance(a: Element, b: Element): number;
/** Infer a human-readable label from the roles present in a group of elements. */
export declare function regionLabel(members: Element[]): string;
/** Bounding box union for a list of elements. Returns [x, y, w, h]. */
export declare function boundingBox(els: Element[]): [number, number, number, number];
/**
 * Spatial clustering: group elements within `threshold` edge-to-edge distance.
 * Uses union-find for efficiency.
 */
export declare function clusterElements(elements: Element[], threshold: number): {
    members: Element[];
    bounds: [number, number, number, number];
}[];
//# sourceMappingURL=spatial.d.ts.map