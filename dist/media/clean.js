// Default command runner using child_process
async function defaultCommandRunner(cmd, args) {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    await promisify(execFile)(cmd, args);
}
export async function prepareForCapture(conn, sessionId, platform, options) {
    const state = {
        platform,
        applied: [],
        restoreActions: [],
    };
    if (platform === 'web') {
        if (!conn || !sessionId)
            return state;
        const hideScrollbars = options?.hideScrollbars ?? true;
        const hideCursor = options?.hideCursor ?? true;
        // 1. Hide scrollbars
        if (hideScrollbars) {
            await conn.send('Emulation.setScrollbarsHidden', { hidden: true }, sessionId);
            state.applied.push('hideScrollbars');
            state.restoreActions.push(async () => {
                await conn.send('Emulation.setScrollbarsHidden', { hidden: false }, sessionId);
            });
        }
        // 2. Hide cursor via CSS injection
        if (hideCursor) {
            await conn.send('Runtime.evaluate', {
                expression: `document.head.insertAdjacentHTML('beforeend', '<style id="__spectra_clean">* { cursor: none !important; }</style>')`,
            }, sessionId);
            state.applied.push('hideCursor');
            state.restoreActions.push(async () => {
                await conn.send('Runtime.evaluate', {
                    expression: `(function(){ var el = document.getElementById('__spectra_clean'); if(el) el.remove(); })()`,
                }, sessionId);
            });
        }
        // 3. Viewport override
        if (options?.viewport) {
            const { width, height } = options.viewport;
            await conn.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }, sessionId);
            state.applied.push('viewportOverride');
            state.restoreActions.push(async () => {
                await conn.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
            });
        }
        return state;
    }
    if (platform === 'ios' || platform === 'watchos') {
        const cleanStatusBar = options?.cleanStatusBar ?? true;
        const runner = options?.commandRunner ?? defaultCommandRunner;
        if (cleanStatusBar) {
            await runner('xcrun', [
                'simctl', 'status_bar', 'booted', 'override',
                '--time', '9:41',
                '--batteryState', 'charged',
                '--batteryLevel', '100',
                '--cellularMode', 'active',
                '--cellularBars', '4',
                '--wifiBars', '3',
            ]);
            state.applied.push('cleanStatusBar');
            state.restoreActions.push(async () => {
                await runner('xcrun', ['simctl', 'status_bar', 'booted', 'clear']);
            });
        }
        return state;
    }
    // macOS: no cleanup actions
    return state;
}
export async function restoreAfterCapture(state) {
    for (let i = state.restoreActions.length - 1; i >= 0; i--) {
        try {
            await state.restoreActions[i]();
        }
        catch {
            // Best-effort restore — log but continue
            console.warn(`[spectra/clean] restore action ${i} failed, continuing`);
        }
    }
}
//# sourceMappingURL=clean.js.map