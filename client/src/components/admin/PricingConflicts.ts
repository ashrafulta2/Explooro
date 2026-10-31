/**
 * PricingConflicts.ts — the list of price and discount settings that work against each other
 * (rules in services/pricingConflicts.ts). Shown on /admin/finance/splits, /admin/growth/group-buy and
 * the flash sale and coupon forms, refreshed while the admin types, so a conflict is seen before it is
 * saved.
 *
 * `update(conflicts)` redraws in place: the pages call it on every keystroke, and rebuilding the form
 * around it would throw away the input's focus. An empty list renders a short all-clear line, never
 * nothing, so the admin knows the check ran.
 *
 * Also exports `confirmNewConflicts`, the dialog a page shows before saving a change that would cause
 * a conflict that is not there today.
 */

import { confirmDialog } from '../ui/ConfirmDialog.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { escapeHtml } from '../../services/html.ts';
import type { PricingConflict } from '../../services/pricingConflicts.ts';

const MAX_NAMED_CATEGORIES = 3;

function scopeText(c: PricingConflict): string {
  // A single deal or coupon has no markup group to name.
  if (!c.categories) return '';
  const isBn = getLanguage() === 'bn';
  const names = c.categories.map((cat) => (isBn ? cat.name_bn : cat.name_en));
  const shown = names.slice(0, MAX_NAMED_CATEGORIES).join(', ');
  const more = names.length > MAX_NAMED_CATEGORIES ? ` ${t('pricing_conflicts.more_categories', { count: names.length - MAX_NAMED_CATEGORIES })}` : '';
  if (c.is_default) {
    return names.length
      ? t('pricing_conflicts.scope_default_with', { markup: c.markup_pct, categories: shown + more })
      : t('pricing_conflicts.scope_default', { markup: c.markup_pct });
  }
  return t('pricing_conflicts.scope_category', { markup: c.markup_pct, categories: shown + more });
}

/** One line of plain text per conflict: what is wrong, then how to fix it. */
export function conflictText(c: PricingConflict): { problem: string; fix: string } {
  const code = c.code.toLowerCase();
  return {
    problem: t(`pricing_conflicts.${code}`, c.params),
    fix: t(`pricing_conflicts.${c.fix || `${code}_fix`}`, c.params),
  };
}

function itemHtml(c: PricingConflict, navigable: boolean): string {
  const { problem, fix } = conflictText(c);
  const links = navigable
    ? c.links.map((href) => `<a class="pricing-conflicts__link" href="${href}" data-link>${escapeHtml(t(`pricing_conflicts.link.${href.split('/').pop()}`))}</a>`).join('')
    : '';
  return `
    <li class="pricing-conflicts__item pricing-conflicts__item--${c.severity}">
      <span class="badge badge--sm ${c.severity === 'error' ? 'badge--danger' : 'badge--warning'}">${escapeHtml(t(`pricing_conflicts.severity_${c.severity}`))}</span>
      <div class="pricing-conflicts__body">
        ${c.categories ? `<p class="pricing-conflicts__scope">${escapeHtml(scopeText(c))}</p>` : ''}
        <p class="pricing-conflicts__problem">${escapeHtml(problem)}</p>
        <p class="pricing-conflicts__fix">${escapeHtml(fix)}</p>
        ${links ? `<div class="pricing-conflicts__links">${links}</div>` : ''}
      </div>
    </li>`;
}

/**
 * @param opts.conflicts  what findPricingConflicts returned
 * @param opts.navigate   the router's navigate; when given, each conflict links to the page that fixes it
 * @param opts.currentPath the page this renders on, whose own link is left out
 * @param opts.subject  'settings' (default) for platform settings, 'price' for one deal or coupon
 */
export function PricingConflicts({
  conflicts = [],
  navigate = null,
  currentPath = '',
  subject = 'settings',
}: {
  conflicts?: PricingConflict[];
  navigate?: ((path: string) => void) | null;
  currentPath?: string;
  subject?: 'settings' | 'price';
} = {}) {
  const el = document.createElement('section');
  el.className = 'pricing-conflicts';
  el.setAttribute('aria-live', 'polite');

  function update(next: PricingConflict[]) {
    const list = next.map((c) => ({ ...c, links: c.links.filter((href) => href !== currentPath) }));
    const errors = list.filter((c) => c.severity === 'error').length;
    if (!list.length) {
      el.dataset.state = 'clear';
      el.innerHTML = `<p class="pricing-conflicts__clear">✓ ${escapeHtml(t(subject === 'price' ? 'pricing_conflicts.price_none' : 'pricing_conflicts.none'))}</p>`;
      return;
    }
    el.dataset.state = errors ? 'error' : 'warning';
    el.innerHTML = `
      <h3 class="pricing-conflicts__title">⚠ ${escapeHtml(t(subject === 'price' ? 'pricing_conflicts.price_title' : 'pricing_conflicts.title', { count: list.length }))}</h3>
      <p class="pricing-conflicts__intro">${escapeHtml(t(subject === 'price' ? 'pricing_conflicts.price_intro' : 'pricing_conflicts.intro'))}</p>
      <ul class="pricing-conflicts__list">${list.map((c) => itemHtml(c, Boolean(navigate))).join('')}</ul>`;
  }

  el.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-link]');
    if (!link || !navigate) return;
    e.preventDefault();
    navigate(link.getAttribute('href'));
  });

  update(conflicts);
  return Object.assign(el, { update });
}

/**
 * Before a save: asks the admin to confirm when the change would cause conflicts that are not there
 * today. Resolves true straight away when it causes none. WHY ask instead of refuse: each conflict can
 * be a deliberate choice (the owner kept a 10% platform minimum under a 15% markup on purpose); the
 * point is that it is never made by accident.
 */
export async function confirmNewConflicts(added: PricingConflict[]): Promise<boolean> {
  if (!added.length) return true;
  // WHY one line: the dialog's description is plain text, where a newline would collapse anyway.
  const lines = added.map((c) => `• ${[scopeText(c), conflictText(c).problem].filter(Boolean).join(' ')}`).join(' ');
  return confirmDialog({
    title: t('pricing_conflicts.confirm_title', { count: added.length }),
    description: `${t('pricing_conflicts.confirm_desc')} ${lines}`,
    confirmLabel: t('pricing_conflicts.confirm_save'),
    cancelLabel: t('pricing_conflicts.confirm_back'),
    variant: added.some((c) => c.severity === 'error') ? 'danger' : 'warning',
  });
}
