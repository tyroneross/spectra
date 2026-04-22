export class RuntimeDomain {
    conn;
    sessionId;
    constructor(conn, sessionId) {
        this.conn = conn;
        this.sessionId = sessionId;
    }
    async evaluate(expression) {
        const result = await this.conn.send('Runtime.evaluate', { expression, returnByValue: true }, this.sessionId);
        return result.result.value;
    }
}
//# sourceMappingURL=runtime.js.map