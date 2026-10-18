/**
 * dom.js — the one tiny element builder the community components share.
 *
 * WHY textContent and never innerHTML: every string on a post (title, steps, a review) is typed by
 * another member, so it is data, never markup.
 */
import { ICONS } from '../ui/icons.js';

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string|Node|Array<string|Node>} [children]
 * @param {Record<string,string>} [attrs]
 */
export function el(tag, className = '', children = null, attrs = null) {
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
export function icon(name, className = 'cm-icon') {
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name] ?? '';
  return span;
}

/** The product title in the reader's language, with the other language as a fallback. */
export function productTitle(product, lang) {
  if (!product) return '';
  return (lang === 'bn' ? product.title_bn || product.title_en : product.title_en || product.title_bn) || '';
}
