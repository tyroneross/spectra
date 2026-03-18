import { describe, it, expect } from 'vitest'
import { normalizeRole } from '../../src/core/normalize.js'

describe('normalizeRole', () => {
  describe('web platform', () => {
    const cases: [string, string][] = [
      ['button', 'button'], ['textbox', 'textfield'], ['TextField', 'textfield'],
      ['link', 'link'], ['checkbox', 'checkbox'], ['switch', 'switch'],
      ['slider', 'slider'], ['tab', 'tab'], ['combobox', 'select'],
      ['listbox', 'select'], ['heading', 'heading'], ['img', 'image'],
      ['image', 'image'], ['StaticText', 'text'], ['generic', 'group'],
      ['navigation', 'group'],
    ]
    for (const [input, expected] of cases) {
      it(`maps "${input}" → "${expected}"`, () => {
        expect(normalizeRole(input, 'web')).toBe(expected)
      })
    }
    it('maps unknown roles to "group"', () => {
      expect(normalizeRole('xyzUnknown', 'web')).toBe('group')
    })
  })
  describe('macos platform', () => {
    const cases: [string, string][] = [
      ['AXButton', 'button'], ['AXTextField', 'textfield'], ['AXTextArea', 'textfield'],
      ['AXLink', 'link'], ['AXCheckBox', 'checkbox'], ['AXSwitch', 'switch'],
      ['AXSlider', 'slider'], ['AXRadioButton', 'tab'], ['AXPopUpButton', 'select'],
      ['AXComboBox', 'select'], ['AXStaticText', 'text'], ['AXImage', 'image'],
      ['AXGroup', 'group'],
    ]
    for (const [input, expected] of cases) {
      it(`maps "${input}" → "${expected}"`, () => {
        expect(normalizeRole(input, 'macos')).toBe(expected)
      })
    }
  })
})
