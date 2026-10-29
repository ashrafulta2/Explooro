/**
 * pageRegistry.ts — the list of pages /admin/platform/pages can switch on and off.
 *
 * WHY registered at runtime instead of hand-listed here: the route table lives inside main.js's
 * async bootstrap (224 routes as of this writing, derived partly from navigation.ts), and a second
 * hand-maintained copy of it is a copy that goes stale the first time someone adds a page and
 * forgets. main.js calls registerPages() with the exact array it hands core/router.ts, so a new
 * route appears on the Page Availability screen with no extra step — the same reason main.js
 * derives its stub routes from navigation.ts rather than listing them.
 *
 * Labels come from navigation.ts where the page has a nav item (so the admin screen, the sidebar
 * and the browser tab all say the same translated thing) and from a humanized path otherwise.
 */

import { navItems } from './navigation.ts';
import { t } from '../services/i18n.ts';
import { normalizePath } from '../services/pageAccess.ts';

/** Portal buckets, in the order the admin screen lists them. */
/** One route the availability screen can switch, as `registerPages` records it. */
export interface RegisteredPage {
  path: string;
  portal: string;
  module: string;
  permission: string | null;
  requiresAuth: boolean;
  label_i18n_key: string | null;
  fallback_label: string;
  in_nav: boolean;
}

export const PAGE_PORTALS = Object.freeze([
  { key: 'admin', prefix: '/admin', label_en: 'Admin', label_bn: 'অ্যাডমিন' },
  { key: 'moderator', prefix: '/moderator', label_en: 'Moderator', label_bn: 'মডারেটর' },
  { key: 'editor', prefix: '/editor', label_en: 'Editor', label_bn: 'এডিটর' },
  { key: 'supplier', prefix: '/supplier', label_en: 'Supplier', label_bn: 'সাপ্লায়ার' },
  { key: 'saler', prefix: '/saler', label_en: 'Shop Partner', label_bn: 'শপ পার্টনার' },
  { key: 'account', prefix: '/account', label_en: 'My Account', label_bn: 'আমার অ্যাকাউন্ট' },
  { key: 'dev', prefix: '/dev', label_en: 'Developer', label_bn: 'ডেভেলপার' },
  { key: 'customer', prefix: '', label_en: 'Public & Customer', label_bn: 'পাবলিক ও কাস্টমার' },
]);

export function portalOf(path: string): string {
  const p = normalizePath(path);
  const match = PAGE_PORTALS.find((portal) => portal.prefix && (p === portal.prefix || p.startsWith(`${portal.prefix}/`)));
  return match?.key ?? 'customer';
}

const navLabelByPath = new Map(navItems.map((item) => [normalizePath(item.path), item.label_i18n_key]));

/** `/admin/catalog/warehouses` -> `Catalog Warehouses`; the fallback when there is no nav item. */
function humanizePath(path: string) {
  const segments = normalizePath(path).split('/').filter(Boolean);
  if (segments.length === 0) return 'Home';
  return segments
    .filter((seg) => !seg.startsWith(':'))
    .map((seg) => seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' ');
}

let pages: RegisteredPage[] = [];

/**
 * Called once from main.js with the router's own route array. Routes carrying a `:param` are
 * registered too — a page is a page whether or not its URL has an id in it, and hiding
 * /product/:id has to be expressible.
 */
export function registerPages(routes: { path?: string; module?: string; permission?: string | null; requiresAuth?: boolean }[] = []): RegisteredPage[] {
  const seen = new Set<string>();
  pages = [];
  for (const route of routes) {
    const path = normalizePath(route?.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    pages.push({
      path,
      portal: portalOf(path),
      module: route.module ?? 'core',
      permission: route.permission ?? null,
      requiresAuth: Boolean(route.requiresAuth),
      label_i18n_key: navLabelByPath.get(path) ?? null,
      fallback_label: humanizePath(path),
      in_nav: navLabelByPath.has(path),
    });
  }
  return pages;
}

export function listPages(): RegisteredPage[] {
  return pages;
}

export function findPage(path: string): RegisteredPage | null {
  const key = normalizePath(path);
  return pages.find((p) => p.path === key) ?? null;
}

/** The label to show for a page, translated when it has a nav entry. */
export function pageLabel(page: RegisteredPage | null | undefined): string {
  if (!page) return '';
  if (!page.label_i18n_key) return page.fallback_label;
  // t() humanizes an unknown key rather than failing (super-admin-audit §5), so the fallback here
  // is only reached when the key is genuinely absent from navigation.ts.
  return t(page.label_i18n_key, page.fallback_label);
}
