import type { Element } from '../core/types.js';
import type { ImportanceScore, FrameOptions, FrameResult } from './types.js';
export declare function frame(screenshot: Buffer, scores: ImportanceScore[], elements: Element[], options?: FrameOptions): FrameResult;
export declare function autoFrame(screenshot: Buffer, scores: ImportanceScore[], elements: Element[]): FrameResult[];
//# sourceMappingURL=framing.d.ts.map