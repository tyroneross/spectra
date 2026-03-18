import type { CdpConnection } from './connection.js'
import type { Element } from '../core/types.js'
import { normalizeRole } from '../core/normalize.js'

export interface CdpAXNode {
  nodeId: string
  role: { value: string }
  name?: { value: string }
  value?: { value: string }
  properties?: Array<{ name: string; value: { value: unknown } }>
  childIds?: string[]
  backendDOMNodeId?: number
}

const SKIP_ROLES = new Set(['WebArea', 'RootWebArea', 'GenericContainer', 'none', 'IgnoredRole'])

export class AccessibilityDomain {
  private nodeMap = new Map<string, number>() // elementId → backendDOMNodeId

  constructor(
    private conn: CdpConnection,
    private sessionId?: string,
  ) {}

  async enable(): Promise<void> {
    await this.conn.send('Accessibility.enable', {}, this.sessionId)
  }

  async getSnapshot(): Promise<Element[]> {
    const result = await this.conn.send<{ nodes: CdpAXNode[] }>(
      'Accessibility.getFullAXTree',
      {},
      this.sessionId,
    )
    return this.convertToElements(result.nodes)
  }

  getBackendNodeId(elementId: string): number | undefined {
    return this.nodeMap.get(elementId)
  }

  private convertToElements(nodes: CdpAXNode[]): Element[] {
    const elements: Element[] = []
    this.nodeMap.clear()
    let idCounter = 0

    for (const node of nodes) {
      // Skip infrastructure roles
      if (SKIP_ROLES.has(node.role.value)) continue

      const role = normalizeRole(node.role.value, 'web')
      const label = node.name?.value ?? ''

      // Skip unlabeled containers (groups with no useful info for Claude)
      if (role === 'group' && !label) continue

      const el: Element = {
        id: `e${++idCounter}`,
        role,
        label,
        value: node.value?.value ?? null,
        enabled: this.getProperty(node, 'disabled') !== true,
        focused: this.getProperty(node, 'focused') === true,
        actions: this.inferActions(role),
        bounds: [0, 0, 0, 0], // Filled on-demand via DOM.getBoxModel for click targeting
        parent: null,
      }

      if (node.backendDOMNodeId) {
        this.nodeMap.set(el.id, node.backendDOMNodeId)
      }

      elements.push(el)
    }

    return elements
  }

  private getProperty(node: CdpAXNode, name: string): unknown {
    return node.properties?.find((p) => p.name === name)?.value?.value
  }

  private inferActions(role: string): string[] {
    switch (role) {
      case 'button':
      case 'link':
      case 'checkbox':
      case 'tab':
      case 'switch':
        return ['press']
      case 'textfield':
        return ['setValue']
      case 'slider':
        return ['increment', 'decrement', 'setValue']
      case 'select':
        return ['press', 'showMenu']
      default:
        return []
    }
  }
}
