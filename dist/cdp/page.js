export class PageDomain {
    conn;
    sessionId;
    constructor(conn, sessionId) {
        this.conn = conn;
        this.sessionId = sessionId;
    }
    async navigate(url) {
        const result = await this.conn.send('Page.navigate', { url }, this.sessionId);
        return result.frameId;
    }
    async screenshot(options) {
        const params = {
            format: options?.format ?? 'png',
        };
        if (options?.quality && options.format === 'jpeg') {
            params.quality = options.quality;
        }
        if (options?.clip) {
            params.clip = { ...options.clip, scale: options.clip.scale ?? 1 };
        }
        const result = await this.conn.send('Page.captureScreenshot', params, this.sessionId);
        return Buffer.from(result.data, 'base64');
    }
    async enableLifecycleEvents() {
        await this.conn.send('Page.setLifecycleEventsEnabled', { enabled: true }, this.sessionId);
        await this.conn.send('Page.enable', {}, this.sessionId);
    }
}
//# sourceMappingURL=page.js.map