import { CdpConnection } from './connection.js';
import { BrowserManager } from './browser.js';
import { AccessibilityDomain } from './accessibility.js';
import { ConsoleDomain } from './console.js';
import { InputDomain } from './input.js';
import { PageDomain } from './page.js';
import { DomDomain } from './dom.js';
import { TargetDomain } from './target.js';
import { RuntimeDomain } from './runtime.js';
import { waitForStableTree } from './wait.js';
import { ResolutionCache } from '../core/cache.js';
export class CdpDriver {
    conn = new CdpConnection();
    browser = new BrowserManager();
    target;
    ax;
    consoleDomain;
    input;
    page;
    dom;
    runtime;
    targetId = null;
    sessionId = null;
    currentUrl = null;
    options;
    /** Resolution cache — available for MCP tools to use. */
    cache = new ResolutionCache();
    constructor(options) {
        this.options = options ?? {};
    }
    async connect(driverTarget) {
        // 1. Launch Chrome
        const wsUrl = await this.browser.launch(this.options.browser);
        // 2. Connect WebSocket to browser
        await this.conn.connect(wsUrl);
        // 3. Create page target
        this.target = new TargetDomain(this.conn);
        const url = driverTarget.url ?? 'about:blank';
        this.targetId = await this.target.createPage(url);
        this.currentUrl = url;
        // 4. Attach to page (flattened sessions)
        this.sessionId = await this.target.attach(this.targetId);
        // 5. Create domain instances for this session
        this.ax = new AccessibilityDomain(this.conn, this.sessionId);
        this.consoleDomain = new ConsoleDomain(this.conn, this.sessionId);
        this.input = new InputDomain(this.conn, this.sessionId);
        this.page = new PageDomain(this.conn, this.sessionId);
        this.dom = new DomDomain(this.conn, this.sessionId);
        this.runtime = new RuntimeDomain(this.conn, this.sessionId);
        // 6. Enable required domains
        await this.ax.enable();
        await this.consoleDomain.enable();
        await this.page.enableLifecycleEvents();
        // 7. Wait for initial AX tree to stabilize
        await waitForStableTree(() => this.ax.getSnapshot());
    }
    async snapshot() {
        const { elements, timedOut } = await waitForStableTree(() => this.ax.getSnapshot());
        return {
            url: this.currentUrl ?? undefined,
            platform: 'web',
            elements,
            timestamp: Date.now(),
            metadata: {
                elementCount: elements.length,
                timedOut,
            },
        };
    }
    async act(elementId, action, value) {
        // Get DOM node ID for coordinate lookup
        const backendNodeId = this.ax.getBackendNodeId(elementId);
        if (!backendNodeId) {
            return {
                success: false,
                error: `Element ${elementId} not found in AX tree`,
                snapshot: await this.snapshot(),
            };
        }
        try {
            const { x, y } = await this.dom.getElementCenter(backendNodeId);
            switch (action) {
                case 'click':
                    await this.input.click(x, y);
                    break;
                case 'type':
                    await this.input.click(x, y);
                    if (value)
                        await this.input.type(value);
                    break;
                case 'clear':
                    await this.input.click(x, y);
                    await this.runtime.evaluate(`document.activeElement && (document.activeElement.value = '')`);
                    break;
                case 'scroll':
                    await this.input.scroll(x, y, 0, value ? parseInt(value, 10) : 100);
                    break;
                case 'hover':
                    await this.conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, this.sessionId);
                    break;
                case 'focus':
                    await this.input.click(x, y);
                    break;
                case 'select':
                    await this.input.click(x, y);
                    break;
            }
            const snapshot = await this.snapshot();
            return { success: true, snapshot };
        }
        catch (err) {
            const snapshot = await this.snapshot();
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
                snapshot,
            };
        }
    }
    async screenshot() {
        return this.page.screenshot();
    }
    get console() {
        return this.consoleDomain;
    }
    getConnection() {
        return { conn: this.conn, sessionId: this.sessionId };
    }
    async navigate(url) {
        this.cache.clear();
        await this.page.navigate(url);
        this.currentUrl = url;
        await waitForStableTree(() => this.ax.getSnapshot());
    }
    async close() {
        if (this.targetId) {
            await this.target.close(this.targetId).catch(() => { });
        }
        await this.conn.close();
        await this.browser.close();
        this.targetId = null;
        this.sessionId = null;
    }
    async disconnect() {
        // CDP driver always owns the browser it launched — full teardown is identical to close()
        await this.close();
    }
}
//# sourceMappingURL=driver.js.map