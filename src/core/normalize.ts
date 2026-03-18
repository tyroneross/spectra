import type { Platform } from './types.js'

const WEB_ROLES: Record<string, string> = {
  button: 'button', textbox: 'textfield', TextField: 'textfield',
  link: 'link', checkbox: 'checkbox', switch: 'switch', slider: 'slider',
  tab: 'tab', combobox: 'select', listbox: 'select',
  heading: 'heading', img: 'image', image: 'image', StaticText: 'text',
  group: 'group', generic: 'group', navigation: 'group', main: 'group',
  contentinfo: 'group', banner: 'group', form: 'group', search: 'group',
  region: 'group', article: 'group', section: 'group', complementary: 'group',
}

const MACOS_ROLES: Record<string, string> = {
  AXButton: 'button', AXTextField: 'textfield', AXTextArea: 'textfield',
  AXLink: 'link', AXCheckBox: 'checkbox', AXSwitch: 'switch', AXSlider: 'slider',
  AXTab: 'tab', AXRadioButton: 'tab', AXPopUpButton: 'select', AXComboBox: 'select',
  AXStaticText: 'text', AXImage: 'image', AXGroup: 'group', AXWindow: 'group',
  AXScrollArea: 'group', AXToolbar: 'group', AXSplitGroup: 'group',
  AXList: 'group', AXOutline: 'group', AXTable: 'group',
  AXRow: 'group', AXColumn: 'group', AXCell: 'group',
}

export function normalizeRole(rawRole: string, platform: Platform): string {
  if (platform === 'web') return WEB_ROLES[rawRole] ?? 'group'
  // iOS and watchOS share macOS AX role naming conventions
  return MACOS_ROLES[rawRole] ?? 'group'
}
