/**
 * SiteFooter.ts — the links every shopper-facing page ends with: the legal documents and the year.
 *
 * WHY on every shopper page: anyone deciding whether to trust a new shop, and every payment gateway
 * reviewing the site before it signs, looks for the terms, privacy and refund policy at the bottom.
 * WHY not in the portals: staff, supplier and partner workspaces and full-screen pages (chat, reels,
 * live) are tools, and a footer there only pushes the work down. The partner agreement is still
 * linked here, because people decide to become a partner from shopper pages.
 */

import { LEGAL_DOCS } from '../../config/legal.ts';
import { t } from '../../services/i18n.ts';

/** Route prefixes that are workspaces or full-screen surfaces. */
const NO_FOOTER_PREFIXES = Object.freeze([
  '/admin', '/moderator', '/editor', '/supplier', '/saler', '/dev',
  '/chat', '/reels', '/stories', '/live', '/discover',
]);

export function showSiteFooter(pathname: string): boolean {
  const path = String(pathname || '/');
  return !NO_FOOTER_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

export function SiteFooter({ navigate = null as ((path: string) => void) | null, year = new Date().getFullYear() } = {}) {
  const el = document.createElement('div');
  el.className = 'site-footer';

  const nav = document.createElement('nav');
  nav.className = 'site-footer__links';
  nav.setAttribute('aria-label', t('legal.footer_label'));
  for (const d of LEGAL_DOCS) {
    const a = document.createElement('a');
    a.className = 'site-footer__link';
    a.href = d.path;
    a.textContent = t(d.labelKey);
    a.addEventListener('click', (e) => {
      if (!navigate || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      navigate(d.path);
    });
    nav.append(a);
  }

  const copy = document.createElement('p');
  copy.className = 'site-footer__copy';
  copy.textContent = t('legal.footer_copyright', { year });

  el.append(nav, copy);
  return el;
}
