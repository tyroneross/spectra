export class ConsoleDomain {
    conn;
    sessionId;
    handlers = new Set();
    messages = [];
    enabled = false;
    constructor(conn, sessionId) {
        this.conn = conn;
        this.sessionId = sessionId;
    }
    async enable() {
        if (this.enabled)
            return;
        this.enabled = true;
        await this.conn.send('Runtime.enable', {}, this.sessionId);
        this.conn.on('Runtime.consoleAPICalled', (params) => {
            const data = params;
            const text = data.args
                .map(arg => arg.value !== undefined ? String(arg.value) : (arg.description ?? ''))
                .join(' ');
            const frame = data.stackTrace?.callFrames[0];
            const message = {
                type: data.type,
                text,
                url: frame?.url,
                lineNumber: frame?.lineNumber,
                timestamp: data.timestamp,
            };
            this.messages.push(message);
            for (const handler of this.handlers)
                handler(message);
        });
    }
    onMessage(handler) { this.handlers.add(handler); }
    offMessage(handler) { this.handlers.delete(handler); }
    getMessages() { return [...this.messages]; }
    getErrors() {
        return this.messages.filter(m => m.type === 'error' || m.type === 'warning');
    }
    clear() { this.messages = []; }
}
//# sourceMappingURL=console.js.map