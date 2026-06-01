import type { ActionType, Element } from './types.js';
export type ActionPurpose = 'step' | 'navigation';
export interface ActionSelectionOptions {
    intent?: string;
    purpose?: ActionPurpose;
    allowFormSubmit?: boolean;
}
export interface ActionSelection {
    action: ActionType;
    value?: string;
    reason: string;
}
export declare function extractActionValue(intent: string): string | undefined;
export declare function inferActionFromIntent(intent: string): ActionType;
export declare function isPotentiallyUnsafeForNavigation(element: Element): boolean;
export declare function isElementVisible(element: Element): boolean;
export declare function isElementActionable(element: Element): boolean;
export declare function selectActionForElement(element: Element, options?: ActionSelectionOptions): ActionSelection | null;
//# sourceMappingURL=actions.d.ts.map