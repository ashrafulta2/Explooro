/**
 * dom.ts — the one tiny element builder the community components share.
 *
 * WHY textContent and never innerHTML: every string on a post (title, steps, a review) is typed by
 * another member, so it is data, never markup.
 */
import { ICONS } from '../ui/icons.ts';

/** What `el` appends: text (strings and numbers) or a node; null, undefined and false are skipped. */
export type ElChild = string | number | Node | false | null | undefined;

/** `true` sets the attribute with no value; null, undefined and false leave it off. */
export type ElAttrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  children: ElChild | ElChild[] = null,
  attrs: ElAttrs | null = null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return node;
}

/** A decorative icon from the shared set. The markup is the icon module's own constant, never user text. */
export function icon(name: string, className = 'cm-icon'): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name] ?? '';
  return span;
}

/** The product title in the reader's language, with the other language as a fallback. */
export function productTitle(product: { title_en?: string; title_bn?: string } | null | undefined, lang: string): string {
  if (!product) return '';
  return (lang === 'bn' ? product.title_bn || product.title_en : product.title_en || product.title_bn) || '';
}
