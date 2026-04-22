import type { CdpConnection } from './connection.js';
import type { Element } from '../core/types.js';
export interface CdpAXNode {
    nodeId: string;
    role: {
        value: string;
    };
    name?: {
        value: string;
    };
    value?: {
        value: string;
    };
    properties?: Array<{
        name: string;
        value: {
            value: unknown;
        };
    }>;
    childIds?: string[];
    backendDOMNodeId?: number;
}
export declare class AccessibilityDomain {
    private conn;
    private sessionId?;
    private nodeMap;
    private loadCompleteHandlers;
    private nodesUpdatedHandlers;
    private loadCompleteListener;
    private nodesUpdatedListener;
    constructor(conn: CdpConnection, sessionId?: string | undefined);
    enable(): Promise<void>;
    disable(): Promise<void>;
    onLoadComplete(handler: () => void): void;
    onNodesUpdated(handler: (nodes: CdpAXNode[]) => void): void;
    offLoadComplete(handler: () => void): void;
    offNodesUpdated(handler: (nodes: CdpAXNode[]) => void): void;
    getSnapshot(): Promise<Element[]>;
    getBackendNodeId(elementId: string): number | undefined;
    /**
     * queryAXTree — CDP-native search by accessible name and/or role.
     * Faster than getFullAXTree + filter for targeted element finding.
     */
    queryAXTree(options: {
        accessibleName?: string;
        role?: string;
    }): Promise<Element[]>;
    private convertToElements;
    private getProperty;
    private inferActions;
}
//# sourceMappingURL=accessibility.d.ts.map