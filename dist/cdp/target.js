export class TargetDomain {
    conn;
    constructor(conn) {
        this.conn = conn;
    }
    async createPage(url) {
        const result = await this.conn.send('Target.createTarget', { url });
        return result.targetId;
    }
    async attach(targetId) {
        const result = await this.conn.send('Target.attachToTarget', { targetId, flatten: true });
        return result.sessionId;
    }
    async close(targetId) {
        await this.conn.send('Target.closeTarget', { targetId });
    }
    async list() {
        const result = await this.conn.send('Target.getTargets');
        return result.targetInfos;
    }
}
//# sourceMappingURL=target.js.map