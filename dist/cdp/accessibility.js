import { normalizeRole } from '../core/normalize.js';
const SKIP_ROLES = new Set(['WebArea', 'RootWebArea', 'GenericContainer', 'none', 'IgnoredRole']);
export class AccessibilityDomain {
    conn;
    sessionId;
    nodeMap = new Map(); // elementId → backendDOMNodeId
    loadCompleteHandlers = new Set();
    nodesUpdatedHandlers = new Set();
    loadCompleteListener = null;
    nodesUpdatedListener = null;
    constructor(conn, sessionId) {
        this.conn = conn;
        this.sessionId = sessionId;
    }
    async enable() {
        await this.conn.send('Accessibility.enable', {}, this.sessionId);
        this.loadCompleteListener = () => {
            for (const handler of this.loadCompleteHandlers)
                handler();
        };
        this.nodesUpdatedListener = (params) => {
            const { nodes } = params;
            for (const handler of this.nodesUpdatedHandlers)
                handler(nodes);
        };
        this.conn.on('Accessibility.loadComplete', this.loadCompleteListener);
        this.conn.on('Accessibility.nodesUpdated', this.nodesUpdatedListener);
    }
    async disable() {
        if (this.loadCompleteListener) {
            this.conn.off('Accessibility.loadComplete', this.loadCompleteListener);
            this.loadCompleteListener = null;
        }
        if (this.nodesUpdatedListener) {
            this.conn.off('Accessibility.nodesUpdated', this.nodesUpdatedListener);
            this.nodesUpdatedListener = null;
        }
    }
    onLoadComplete(handler) { this.loadCompleteHandlers.add(handler); }
    onNodesUpdated(handler) { this.nodesUpdatedHandlers.add(handler); }
    offLoadComplete(handler) { this.loadCompleteHandlers.delete(handler); }
    offNodesUpdated(handler) { this.nodesUpdatedHandlers.delete(handler); }
    async getSnapshot() {
        const result = await this.conn.send('Accessibility.getFullAXTree', {}, this.sessionId);
        return this.convertToElements(result.nodes);
    }
    getBackendNodeId(elementId) {
        return this.nodeMap.get(elementId);
    }
    /**
     * queryAXTree — CDP-native search by accessible name and/or role.
     * Faster than getFullAXTree + filter for targeted element finding.
     */
    async queryAXTree(options) {
        const params = {};
        if (options.accessibleName)
            params.accessibleName = options.accessibleName;
        if (options.role)
            params.role = options.role;
        // queryAXTree requires a node anchor — use document root
        const doc = await this.conn.send('DOM.getDocument', {}, this.sessionId);
        params.nodeId = doc.root.nodeId;
        try {
            const result = await this.conn.send('Accessibility.queryAXTree', params, this.sessionId);
            return this.convertToElements(result.nodes, false); // false = don't clear nodeMap
        }
        catch {
            return []; // queryAXTree may fail on some pages
        }
    }
    convertToElements(nodes, clearMap = true) {
        const elements = [];
        if (clearMap) {
            this.nodeMap.clear();
        }
        for (const node of nodes) {
            // Skip infrastructure roles
            if (SKIP_ROLES.has(node.role.value))
                continue;
            const role = normalizeRole(node.role.value, 'web');
            const label = node.name?.value ?? '';
            // Skip unlabeled containers (groups with no useful info for Claude)
            if (role === 'group' && !label)
                continue;
            const id = node.backendDOMNodeId ? `e${node.backendDOMNodeId}` : `ex${Math.random().toString(36).slice(2, 8)}`;
            const el = {
                id,
                role,
                label,
                value: node.value?.value ?? null,
                enabled: this.getProperty(node, 'disabled') !== true,
                focused: this.getProperty(node, 'focused') === true,
                actions: this.inferActions(role),
                bounds: [0, 0, 0, 0], // Filled on-demand via DOM.getBoxModel for click targeting
                parent: null,
            };
            if (node.backendDOMNodeId) {
                this.nodeMap.set(el.id, node.backendDOMNodeId);
            }
            elements.push(el);
        }
        return elements;
    }
    getProperty(node, name) {
        return node.properties?.find((p) => p.name === name)?.value?.value;
    }
    inferActions(role) {
        switch (role) {
            case 'button':
            case 'link':
            case 'checkbox':
            case 'tab':
            case 'switch':
                return ['press'];
            case 'textfield':
                return ['setValue'];
            case 'slider':
                return ['increment', 'decrement', 'setValue'];
            case 'select':
                return ['press', 'showMenu'];
            default:
                return [];
        }
    }
}
//# sourceMappingURL=accessibility.js.map