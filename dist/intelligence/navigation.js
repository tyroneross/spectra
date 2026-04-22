import { detectChange } from './change.js';
import { scoreElements } from './importance.js';
// ─── Debug ───────────────────────────────────────────────────
const DEBUG = process.env.SPECTRA_DEBUG === '1';
// ─── Constants ───────────────────────────────────────────────
const SENSITIVE_PATTERNS = /password|secret|token|api.?key|credit.?card|ssn|social.?security/i;
const NAVIGABLE_ROLES = new Set(['link', 'button', 'tab', 'menuitem']);
const DEFAULT_CRAWL_OPTIONS = {
    maxDepth: 3,
    maxScreens: 50,
    scrollDiscover: true,
    captureEach: true,
    changeThreshold: 0.15,
    allowExternal: false,
    allowFormSubmit: false,
};
const DEFAULT_VIEWPORT = { width: 1280, height: 800, devicePixelRatio: 1 };
// ─── FNV-1a Hash ─────────────────────────────────────────────
function simpleHash(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(36);
}
// ─── Screen Fingerprint ──────────────────────────────────────
export function fingerprint(snapshot) {
    // Use role:label pairs (stable, DOM-position independent)
    const pairs = snapshot.elements
        .map(el => `${el.role}:${el.label}`)
        .sort();
    return simpleHash(pairs.join('|'));
}
// ─── Screen ID ───────────────────────────────────────────────
function screenId(snapshot) {
    const fp = fingerprint(snapshot);
    if (snapshot.url)
        return `${snapshot.url}:${fp}`;
    if (snapshot.appName)
        return `${snapshot.appName}:${fp}`;
    return fp;
}
// ─── Sensitive Content Check ─────────────────────────────────
function hasSensitiveContent(snapshot) {
    return snapshot.elements.some(el => (el.role === 'textbox' || el.role === 'input') &&
        SENSITIVE_PATTERNS.test(el.label));
}
// ─── External URL Check ──────────────────────────────────────
function isExternalUrl(label, currentUrl) {
    // If the label looks like a URL starting with http/https
    if (!label.startsWith('http://') && !label.startsWith('https://'))
        return false;
    if (!currentUrl)
        return true;
    try {
        const current = new URL(currentUrl);
        const target = new URL(label);
        return current.hostname !== target.hostname;
    }
    catch {
        return false;
    }
}
// ─── Average Importance ──────────────────────────────────────
function averageImportance(snapshot) {
    if (snapshot.elements.length === 0)
        return 0;
    const scores = scoreElements(snapshot.elements, DEFAULT_VIEWPORT);
    if (scores.length === 0)
        return 0;
    return scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
}
// ─── Crawl ───────────────────────────────────────────────────
export async function crawl(driver, options) {
    const opts = { ...DEFAULT_CRAWL_OPTIONS, ...options };
    // 1. Take initial snapshot + screenshot
    const rootSnapshot = await driver.snapshot();
    const rootScreenshot = await driver.screenshot();
    const rootId = screenId(rootSnapshot);
    const rootSensitive = hasSensitiveContent(rootSnapshot);
    const rootNode = {
        id: rootId,
        url: rootSnapshot.url,
        appName: rootSnapshot.appName,
        screenshot: rootSensitive ? Buffer.alloc(0) : rootScreenshot,
        importance: averageImportance(rootSnapshot),
        visited: false,
        sensitiveContent: rootSensitive || undefined,
    };
    // 2. Build initial graph
    const nodes = new Map();
    const edges = [];
    nodes.set(rootId, rootNode);
    // Map fingerprint -> nodeId (for dedup when URL differs but content is same)
    const fingerprintToNode = new Map();
    fingerprintToNode.set(fingerprint(rootSnapshot), rootId);
    // Snapshot cache keyed by nodeId
    const snapshotCache = new Map();
    snapshotCache.set(rootId, { snapshot: rootSnapshot, screenshot: rootScreenshot });
    // 3. BFS queue
    const queue = [{ nodeId: rootId, depth: 0 }];
    while (queue.length > 0 && nodes.size < opts.maxScreens) {
        const item = queue.shift();
        const { nodeId, depth } = item;
        const node = nodes.get(nodeId);
        if (node.visited)
            continue;
        node.visited = true;
        const cached = snapshotCache.get(nodeId);
        if (!cached)
            continue;
        const { snapshot: currentSnapshot, screenshot: currentScreenshot } = cached;
        const currentUrl = currentSnapshot.url;
        // Navigate to this node's URL before processing (ensures driver is on the right screen)
        if (driver.navigate && currentUrl) {
            await driver.navigate(currentUrl);
        }
        // 4. Scroll discovery
        let scrollSnapshot = currentSnapshot;
        if (opts.scrollDiscover) {
            await discoverByScroll(driver);
            // Re-fetch snapshot after scroll to capture newly loaded elements
            scrollSnapshot = await driver.snapshot();
        }
        // 5. Find navigable elements from post-scroll snapshot
        const navigableElements = scrollSnapshot.elements.filter(el => {
            if (!NAVIGABLE_ROLES.has(el.role))
                return false;
            if (el.actions.length === 0)
                return false;
            // Filter external links
            if (el.role === 'link' && !opts.allowExternal) {
                if (isExternalUrl(el.label, currentUrl))
                    return false;
            }
            // Filter sensitive element labels
            if (SENSITIVE_PATTERNS.test(el.label))
                return false;
            return true;
        });
        // Cap at 20 per screen
        const candidates = navigableElements.slice(0, 20);
        if (DEBUG) {
            console.log(`[navigation] screen ${nodeId} — ${candidates.length} candidates at depth ${depth}`);
        }
        // 6. Interact with each candidate
        for (const el of candidates) {
            if (nodes.size >= opts.maxScreens)
                break;
            // Act: click the element
            let actResult;
            try {
                actResult = await driver.act(el.id, 'click');
            }
            catch (err) {
                console.warn(`[navigation] act failed for element ${el.id}:`, err);
                continue;
            }
            if (!actResult.success)
                continue;
            const newSnapshot = actResult.snapshot ?? await driver.snapshot();
            const newScreenshot = await driver.screenshot();
            const newFp = fingerprint(newSnapshot);
            const newId = screenId(newSnapshot);
            // Dedup by fingerprint
            if (fingerprintToNode.has(newFp)) {
                const existingId = fingerprintToNode.get(newFp);
                // Add edge if not duplicate
                const edgeExists = edges.some(e => e.from === nodeId && e.to === existingId && e.action.elementId === el.id);
                if (!edgeExists) {
                    edges.push({ from: nodeId, to: existingId, action: { elementId: el.id, type: 'click', label: el.label } });
                }
                // Backtrack
                await backtrack(driver, currentUrl);
                continue;
            }
            // Check change significance
            const change = detectChange(currentScreenshot, newScreenshot, currentSnapshot, newSnapshot);
            if (change.score < opts.changeThreshold) {
                // Insignificant change — skip
                await backtrack(driver, currentUrl);
                continue;
            }
            // Sensitive content check
            const newSensitive = hasSensitiveContent(newSnapshot);
            const newNode = {
                id: newId,
                url: newSnapshot.url,
                appName: newSnapshot.appName,
                screenshot: newSensitive ? Buffer.alloc(0) : newScreenshot,
                importance: averageImportance(newSnapshot),
                visited: false,
                sensitiveContent: newSensitive || undefined,
            };
            nodes.set(newId, newNode);
            fingerprintToNode.set(newFp, newId);
            snapshotCache.set(newId, { snapshot: newSnapshot, screenshot: newScreenshot });
            edges.push({ from: nodeId, to: newId, action: { elementId: el.id, type: 'click', label: el.label } });
            if (depth + 1 < opts.maxDepth) {
                queue.push({ nodeId: newId, depth: depth + 1 });
            }
            // Backtrack to previous screen
            await backtrack(driver, currentUrl);
        }
    }
    const result = { nodes, edges, root: rootId };
    result._snapshotCache = snapshotCache;
    return result;
}
// ─── Backtrack ───────────────────────────────────────────────
async function backtrack(driver, previousUrl) {
    if (driver.navigate && previousUrl) {
        await driver.navigate(previousUrl);
    }
    else if (!driver.navigate) {
        console.warn('[navigation] backtracking not available — driver does not support navigate()');
    }
}
// ─── Discover by Scroll ──────────────────────────────────────
export async function discoverByScroll(driver, maxScrolls = 20) {
    const discovered = [];
    const initialSnapshot = await driver.snapshot();
    let prevElementCount = initialSnapshot.elements.length;
    let prevFp = fingerprint(initialSnapshot);
    let noNewCount = 0;
    for (let i = 0; i < maxScrolls; i++) {
        // Find a scrollable element to act on, or fall back to first interactive element
        const scrollTarget = initialSnapshot.elements.find(el => el.actions.includes('scroll')) ?? initialSnapshot.elements.find(el => el.actions.length > 0);
        if (!scrollTarget)
            break;
        try {
            await driver.act(scrollTarget.id, 'scroll', '500');
        }
        catch {
            break;
        }
        const newSnapshot = await driver.snapshot();
        const newFp = fingerprint(newSnapshot);
        // Bottom of page — fingerprint unchanged
        if (newFp === prevFp)
            break;
        const newCount = newSnapshot.elements.length;
        if (newCount <= prevElementCount) {
            noNewCount++;
            if (noNewCount >= 3)
                break;
        }
        else {
            noNewCount = 0;
            // Capture screenshot of newly revealed content
            const screenshot = await driver.screenshot();
            const sensitive = hasSensitiveContent(newSnapshot);
            discovered.push({
                id: screenId(newSnapshot),
                url: newSnapshot.url,
                appName: newSnapshot.appName,
                screenshot: sensitive ? Buffer.alloc(0) : screenshot,
                importance: averageImportance(newSnapshot),
                visited: false,
                sensitiveContent: sensitive || undefined,
            });
        }
        prevElementCount = newCount;
        prevFp = newFp;
    }
    return discovered;
}
//# sourceMappingURL=navigation.js.map