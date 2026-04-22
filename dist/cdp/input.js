export class InputDomain {
    conn;
    sessionId;
    constructor(conn, sessionId) {
        this.conn = conn;
        this.sessionId = sessionId;
    }
    async click(x, y) {
        await this.conn.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x, y, button: 'left', clickCount: 1,
        }, this.sessionId);
        await this.conn.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
        }, this.sessionId);
    }
    async type(text) {
        for (const char of text) {
            const code = charToCode(char);
            await this.conn.send('Input.dispatchKeyEvent', {
                type: 'keyDown', text: char, key: char, code,
            }, this.sessionId);
            await this.conn.send('Input.dispatchKeyEvent', {
                type: 'keyUp', key: char, code,
            }, this.sessionId);
        }
    }
    async scroll(x, y, deltaX, deltaY) {
        await this.conn.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel', x, y, deltaX, deltaY,
        }, this.sessionId);
    }
}
const SPECIAL_CODES = {
    ' ': 'Space', '0': 'Digit0', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3',
    '4': 'Digit4', '5': 'Digit5', '6': 'Digit6', '7': 'Digit7', '8': 'Digit8',
    '9': 'Digit9', '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft',
    ']': 'BracketRight', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote',
    ',': 'Comma', '.': 'Period', '/': 'Slash', '~': 'Backquote', '!': 'Digit1',
    '@': 'Digit2', '#': 'Digit3', '$': 'Digit4', '%': 'Digit5', '^': 'Digit6',
    '&': 'Digit7', '*': 'Digit8', '(': 'Digit9', ')': 'Digit0', '_': 'Minus',
    '+': 'Equal', '{': 'BracketLeft', '}': 'BracketRight', '|': 'Backslash',
    ':': 'Semicolon', '"': 'Quote', '<': 'Comma', '>': 'Period', '?': 'Slash',
    '\t': 'Tab', '\n': 'Enter',
};
function charToCode(char) {
    if (SPECIAL_CODES[char])
        return SPECIAL_CODES[char];
    const upper = char.toUpperCase();
    if (upper >= 'A' && upper <= 'Z')
        return `Key${upper}`;
    return '';
}
//# sourceMappingURL=input.js.map