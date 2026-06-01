const TEXT_INPUT_ROLES = new Set(['textbox', 'textfield', 'textarea', 'searchbox']);
const SELECT_ROLES = new Set(['combobox', 'listbox', 'option', 'menuitem']);
const CLICK_ROLES = new Set([
    'button',
    'link',
    'tab',
    'menuitem',
    'checkbox',
    'radio',
    'switch',
    'option',
]);
const FORM_SUBMIT_PATTERN = /\b(submit|save|send|sign\s?in|log\s?in|login|register|sign\s?up|checkout|pay|purchase|confirm)\b/i;
const DESTRUCTIVE_PATTERN = /\b(delete|remove|destroy|archive|reset|clear|discard|sign\s?out|log\s?out|logout|deactivate)\b/i;
export function extractActionValue(intent) {
    const quoted = intent.match(/"([^"]+)"/);
    if (quoted)
        return quoted[1];
    const singleQuoted = intent.match(/'([^']+)'/);
    if (singleQuoted)
        return singleQuoted[1];
    const afterInto = intent.match(/\b(?:type|enter|fill|write)\s+(.+?)\s+\b(?:into|in|on)\b/i);
    return afterInto?.[1]?.trim();
}
export function inferActionFromIntent(intent) {
    const lower = intent.toLowerCase();
    if (/\b(clear|empty|erase)\b/.test(lower))
        return 'clear';
    if (/\b(type|enter|fill|write|input)\b/.test(lower))
        return 'type';
    if (/\b(scroll|swipe)\b/.test(lower))
        return 'scroll';
    if (/\b(hover|mouse over)\b/.test(lower))
        return 'hover';
    if (/\b(focus)\b/.test(lower))
        return 'focus';
    if (/\b(select|choose|pick)\b/.test(lower))
        return 'select';
    return 'click';
}
export function isPotentiallyUnsafeForNavigation(element) {
    const text = `${element.role} ${element.label} ${element.value ?? ''}`;
    return DESTRUCTIVE_PATTERN.test(text) || FORM_SUBMIT_PATTERN.test(text);
}
export function isElementVisible(element) {
    const [, , width, height] = element.bounds;
    return width > 0 && height > 0;
}
export function isElementActionable(element) {
    if (!element.enabled)
        return false;
    if (element.actions.length === 0 && !CLICK_ROLES.has(normalizeRole(element.role)))
        return false;
    return true;
}
export function selectActionForElement(element, options = {}) {
    if (!isElementActionable(element))
        return null;
    const purpose = options.purpose ?? 'step';
    if (purpose === 'navigation') {
        if (!options.allowFormSubmit && isPotentiallyUnsafeForNavigation(element)) {
            return null;
        }
        return selectNavigationAction(element);
    }
    const requested = options.intent ? inferActionFromIntent(options.intent) : undefined;
    const value = options.intent ? extractActionValue(options.intent) : undefined;
    if (requested && supportsAction(element, requested)) {
        return { action: requested, value, reason: `intent:${requested}` };
    }
    if (requested === 'select' && supportsAction(element, 'click')) {
        return { action: 'click', value, reason: 'select-fallback-click' };
    }
    if ((requested === 'type' || requested === 'clear') && supportsAction(element, 'focus')) {
        return { action: 'focus', reason: `${requested}-fallback-focus` };
    }
    return selectNavigationAction(element);
}
function selectNavigationAction(element) {
    const role = normalizeRole(element.role);
    if (SELECT_ROLES.has(role) && supportsAction(element, 'select')) {
        return { action: 'select', reason: 'role-select' };
    }
    if (supportsAction(element, 'click')) {
        return { action: 'click', reason: 'default-click' };
    }
    if (supportsAction(element, 'select')) {
        return { action: 'select', reason: 'fallback-select' };
    }
    return null;
}
function supportsAction(element, action) {
    const role = normalizeRole(element.role);
    const actions = new Set(element.actions.map(a => a.toLowerCase()));
    switch (action) {
        case 'click':
            return actions.has('click') || actions.has('press') || actions.has('showmenu') || CLICK_ROLES.has(role);
        case 'type':
        case 'clear':
            return actions.has('type') || actions.has('setvalue') || TEXT_INPUT_ROLES.has(role);
        case 'select':
            return actions.has('select') || actions.has('showmenu') || SELECT_ROLES.has(role);
        case 'scroll':
            return actions.has('scroll') || role === 'scrollbar';
        case 'hover':
        case 'focus':
            return actions.size > 0 || CLICK_ROLES.has(role) || TEXT_INPUT_ROLES.has(role);
    }
}
function normalizeRole(role) {
    return role.toLowerCase().replace(/^ax/, '');
}
//# sourceMappingURL=actions.js.map