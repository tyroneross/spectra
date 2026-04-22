import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const CHROME_PATHS = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Linux / WSL
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
];
export function findChrome() {
    for (const p of CHROME_PATHS) {
        if (existsSync(p))
            return p;
    }
    return null;
}
function randomPort() {
    return 49152 + Math.floor(Math.random() * (65535 - 49152));
}
export class BrowserManager {
    process = null;
    port = 0;
    async launch(options = {}) {
        const headless = options.headless ?? true;
        this.port = options.port ?? randomPort();
        const userDataDir = options.userDataDir ?? join(homedir(), '.spectra', 'chromium-profile');
        const chromePath = findChrome();
        if (!chromePath) {
            throw new Error('Chrome not found. Install Google Chrome or set a custom path.\n'
                + `Checked: ${CHROME_PATHS.join(', ')}`);
        }
        await mkdir(userDataDir, { recursive: true });
        const args = [
            `--remote-debugging-port=${this.port}`,
            `--user-data-dir=${userDataDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-networking',
            '--disable-sync',
        ];
        if (headless) {
            args.push('--headless=new');
        }
        this.process = spawn(chromePath, args, { stdio: 'pipe' });
        this.process.on('error', (err) => {
            console.error(`Chrome process error: ${err.message}`);
        });
        return this.waitForDebugger();
    }
    async waitForDebugger() {
        const maxAttempts = 50; // 5 seconds at 100ms intervals
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const res = await fetch(`http://127.0.0.1:${this.port}/json/version`);
                const data = (await res.json());
                return data.webSocketDebuggerUrl;
            }
            catch {
                await new Promise((r) => setTimeout(r, 100));
            }
        }
        throw new Error(`Chrome debugger did not respond within 5s on port ${this.port}. `
            + 'Is another Chrome instance using this port?');
    }
    async close() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
    get running() {
        return this.process !== null && !this.process.killed;
    }
}
//# sourceMappingURL=browser.js.map