/** Axis-aligned edge-to-edge distance between two bounding boxes. */
export function edgeDistance(a, b) {
    const [ax, ay, aw, ah] = a.bounds;
    const [bx, by, bw, bh] = b.bounds;
    const dx = Math.max(0, Math.max(ax, bx) - Math.min(ax + aw, bx + bw));
    const dy = Math.max(0, Math.max(ay, by) - Math.min(ay + ah, by + bh));
    return Math.sqrt(dx * dx + dy * dy);
}
/** Infer a human-readable label from the roles present in a group of elements. */
export function regionLabel(members) {
    const roles = new Set(members.map(e => e.role));
    if (roles.has('link') || roles.has('menuitem'))
        return 'Navigation';
    if (roles.has('textbox'))
        return 'Form';
    if (roles.has('image'))
        return 'Media';
    if (roles.has('button'))
        return 'Actions';
    if (roles.has('heading') || roles.has('text'))
        return 'Content';
    return 'Section';
}
/** Bounding box union for a list of elements. Returns [x, y, w, h]. */
export function boundingBox(els) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of els) {
        const [x, y, w, h] = el.bounds;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    }
    return [minX, minY, maxX - minX, maxY - minY];
}
/**
 * Spatial clustering: group elements within `threshold` edge-to-edge distance.
 * Uses union-find for efficiency.
 */
export function clusterElements(elements, threshold) {
    if (elements.length === 0)
        return [];
    const parent = new Map();
    for (const el of elements)
        parent.set(el.id, el.id);
    function find(id) {
        let root = id;
        while (parent.get(root) !== root)
            root = parent.get(root);
        let cur = id;
        while (cur !== root) {
            const next = parent.get(cur);
            parent.set(cur, root);
            cur = next;
        }
        return root;
    }
    function union(a, b) {
        parent.set(find(a), find(b));
    }
    for (let i = 0; i < elements.length; i++) {
        for (let j = i + 1; j < elements.length; j++) {
            if (edgeDistance(elements[i], elements[j]) <= threshold) {
                union(elements[i].id, elements[j].id);
            }
        }
    }
    const groups = new Map();
    for (const el of elements) {
        const root = find(el.id);
        if (!groups.has(root))
            groups.set(root, []);
        groups.get(root).push(el);
    }
    return [...groups.values()].map(members => ({
        members,
        bounds: boundingBox(members),
    }));
}
//# sourceMappingURL=spatial.js.map