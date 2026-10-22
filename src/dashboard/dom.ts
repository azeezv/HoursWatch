export type Child = Node | string | number | null | undefined | false
type Props = {
  class?: string
  style?: Partial<CSSStyleDeclaration>
  dataset?: Record<string, string>
  [attr: string]: unknown
}

/** Tiny hyperscript helper. Text is always inserted as text nodes (never HTML). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') el.className = String(value)
    else if (key === 'style') Object.assign(el.style, value)
    else if (key === 'dataset') Object.assign(el.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function')
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    else if (key in el && key !== 'list') (el as unknown as Record<string, unknown>)[key] = value
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  append(el, children)
  return el
}

export function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)))
  }
}

export function replace(el: Element, ...children: Child[]) {
  el.replaceChildren()
  append(el, children)
}

export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel)
  if (!el) throw new Error(`Missing element: ${sel}`)
  return el
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
