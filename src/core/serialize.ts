import type { Element, Snapshot } from './types.js'

export function serializeSnapshot(snapshot: Snapshot): string {
  const target = snapshot.url ?? snapshot.appName ?? 'unknown'
  const lines: string[] = [
    `# Page: ${target}`,
    `# Platform: ${snapshot.platform} | Elements: ${snapshot.elements.length} | Timestamp: ${snapshot.timestamp}`,
    '',
  ]
  for (const el of snapshot.elements) {
    lines.push(serializeElement(el))
  }
  return lines.join('\n')
}

export function serializeElement(el: Element): string {
  let line = `[${el.id}] ${el.role} "${el.label}"`
  const props: string[] = []

  if (el.role === 'textfield') {
    if (el.value !== null && el.value !== '') {
      props.push(`value="${el.value}"`)
    } else {
      props.push('empty')
    }
  } else if (el.value !== null && el.value !== '') {
    props.push(`value="${el.value}"`)
  }

  if (el.focused) props.push('focused')

  if (el.role === 'button') {
    props.push(el.enabled ? 'enabled' : 'disabled')
  }

  if (el.actions.length > 0) props.push(`actions:[${el.actions.join(',')}]`)

  const [x, y, w, h] = el.bounds
  props.push(`bounds:[${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}]`)

  if (el.parent !== null) props.push(`parent:${el.parent}`)

  if (props.length > 0) line += ' ' + props.join(', ')
  return line
}
