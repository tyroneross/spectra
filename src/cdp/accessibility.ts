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
  private loadCompleteHandlers = new Set<() => void>()
  private nodesUpdatedHandlers = new Set<(nodes: CdpAXNode[]) => void>()
  private loadCompleteListener: (() => void) | null = null
  private nodesUpdatedListener: ((params: unknown) => void) | null = null

  constructor(
    private conn: CdpConnection,
    private sessionId?: string,
  ) {}

  async enable(): Promise<void> {
    await this.conn.send('Accessibility.enable', {}, this.sessionId)

    this.loadCompleteListener = () => {
      for (const handler of this.loadCompleteHandlers) handler()
    }
    this.nodesUpdatedListener = (params: unknown) => {
      const { nodes } = params as { nodes: CdpAXNode[] }
      for (const handler of this.nodesUpdatedHandlers) handler(nodes)
    }
    this.conn.on('Accessibility.loadComplete', this.loadCompleteListener)
    this.conn.on('Accessibility.nodesUpdated', this.nodesUpdatedListener)
  }

  async disable(): Promise<void> {
    if (this.loadCompleteListener) {
      this.conn.off('Accessibility.loadComplete', this.loadCompleteListener)
      this.loadCompleteListener = null
    }
    if (this.nodesUpdatedListener) {
      this.conn.off('Accessibility.nodesUpdated', this.nodesUpdatedListener)
      this.nodesUpdatedListener = null
    }
  }

  onLoadComplete(handler: () => void): void { this.loadCompleteHandlers.add(handler) }
  onNodesUpdated(handler: (nodes: CdpAXNode[]) => void): void { this.nodesUpdatedHandlers.add(handler) }
  offLoadComplete(handler: () => void): void { this.loadCompleteHandlers.delete(handler) }
  offNodesUpdated(handler: (nodes: CdpAXNode[]) => void): void { this.nodesUpdatedHandlers.delete(handler) }

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

  /**
   * queryAXTree — CDP-native search by accessible name and/or role.
   * Faster than getFullAXTree + filter for targeted element finding.
   */
  async queryAXTree(options: {
    accessibleName?: string
    role?: string
  }): Promise<Element[]> {
    const params: Record<string, unknown> = {}
    if (options.accessibleName) params.accessibleName = options.accessibleName
    if (options.role) params.role = options.role

    // queryAXTree requires a node anchor — use document root
    const doc = await this.conn.send<{ root: { nodeId: number } }>(
      'DOM.getDocument', {}, this.sessionId,
    )
    params.nodeId = doc.root.nodeId

    try {
      const result = await this.conn.send<{ nodes: CdpAXNode[] }>(
        'Accessibility.queryAXTree',
        params,
        this.sessionId,
      )
      return this.convertToElements(result.nodes, false) // false = don't clear nodeMap
    } catch {
      return [] // queryAXTree may fail on some pages
    }
  }

  private convertToElements(nodes: CdpAXNode[], clearMap = true): Element[] {
    const elements: Element[] = []
    if (clearMap) {
      this.nodeMap.clear()
    }

    for (const node of nodes) {
      // Skip infrastructure roles
      if (SKIP_ROLES.has(node.role.value)) continue

      const role = normalizeRole(node.role.value, 'web')
      const label = node.name?.value ?? ''

      // Skip unlabeled containers (groups with no useful info for Claude)
      if (role === 'group' && !label) continue

      const id = node.backendDOMNodeId ? `e${node.backendDOMNodeId}` : `ex${Math.random().toString(36).slice(2, 8)}`

      const el: Element = {
        id,
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
