export class DomDomain {
    conn;
    sessionId;
    constructor(conn, sessionId) {
        this.conn = conn;
        this.sessionId = sessionId;
    }
    async getElementCenter(backendNodeId) {
        const result = await this.conn.send('DOM.getBoxModel', { backendNodeId }, this.sessionId);
        // content quad: [x1,y1, x2,y2, x3,y3, x4,y4] — four corners
        const q = result.model.content;
        const x = Math.round((q[0] + q[2] + q[4] + q[6]) / 4);
        const y = Math.round((q[1] + q[3] + q[5] + q[7]) / 4);
        return { x, y };
    }
    async getDocument() {
        return this.conn.send('DOM.getDocument', {}, this.sessionId);
    }
}
//# sourceMappingURL=dom.js.map