import type { CdpConnection } from './connection.js'

export class InputDomain {
  constructor(
    private conn: CdpConnection,
    private sessionId?: string,
  ) {}

  async click(x: number, y: number): Promise<void> {
    await this.conn.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    }, this.sessionId)
    await this.conn.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    }, this.sessionId)
  }

  async type(text: string): Promise<void> {
    for (const char of text) {
      const code = charToCode(char)
      await this.conn.send('Input.dispatchKeyEvent', {
        type: 'keyDown', text: char, key: char, code,
      }, this.sessionId)
      await this.conn.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: char, code,
      }, this.sessionId)
    }
  }

  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.conn.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y, deltaX, deltaY,
    }, this.sessionId)
  }
}

const SPECIAL_CODES: Record<string, string> = {
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
}

function charToCode(char: string): string {
  if (SPECIAL_CODES[char]) return SPECIAL_CODES[char]
  const upper = char.toUpperCase()
  if (upper >= 'A' && upper <= 'Z') return `Key${upper}`
  return ''
}
