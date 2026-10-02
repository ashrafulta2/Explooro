/**
 * pageInfo.js — folds the descriptive line under a page/section title into an (i) InfoTip.
 *
 * Instruction text ("what this page is for") under every title made screens read as clutter. The
 * sentence is kept — it moves into an InfoTip beside the title. Pages keep writing the same
 * subtitle markup; this module collapses it, so a new page gets the behaviour for free.
 *
 * Opt in/out:
 *  - any element matching INFO_SELECTOR is folded (the known page + section subtitle classes);
 *  - `data-page-info` opts any other element in, `data-info-keep` opts an element out. Use the
 *    latter for text a user must read before acting (warnings, irreversible-action notices).
 *
 * Invariants:
 *  - Safe fallback: if no heading sits directly before the subtitle, or the subtitle holds links
 *    or controls, it is left visible. Nothing is ever hidden without a tip to carry it.
 *  - The original element stays in the DOM (hidden) so pages that later rewrite its text keep
 *    working; the tip follows those rewrites, and is re-attached if a page re-renders its heading.
 */

import { InfoTip } from '../components/ui/InfoTip.js';

// Page-level and section-level subtitles. KPI-card captions (`*-kpi-card__sub`), auth forms, hero
// copy, modal/drawer/empty-state descriptions are deliberately NOT here: they are data or
// content, not instructions.
const INFO_CLASSES = [
  'admin-page-subtitle', 'account-page__subtitle', 'supplier-header__subtitle',
  'saler-header-row__subtitle', 'editor-header__subtitle', 'admin-dashboard__subtitle',
  'admin-dashboard__intro', 'admin-users__subtitle', 'admin-staff__subtitle',
  'audit-explorer__subtitle', 'module-control__subtitle', 'system-health__subtitle',
  'theme-studio__subtitle', 'store-builder__subtitle', 'referral-hub__subtitle',
  'creative-studio-page__subtitle', 'catalog-page__subtitle', 'checkout-page__subtitle',
  'customer-dashboard__subtitle', 'customer-dashboard__actions-subtitle', 'studio-subtitle',
  'page-subtitle', 'stream-discovery__subtitle', 'sourcing-hero__subtitle',
  'admin-panel__subtitle', 'admin-chart-panel__subtitle', 'saler-card__subtitle',
  'editor-card__subtitle', 'system-panel__sub', 'cod-recon-panel__subtitle',
  'warranties-guide__subtitle', 'profit-calc__subtitle', 'become-saler-calculator__subtitle',
  'ad-wizard__subtitle', 'settings-section-desc', 'team-detail-slots-card__subtitle', 'card__subtitle',
];

export const INFO_SELECTOR =
  `:is(${INFO_CLASSES.map((c) => `.${c}`).join(',')},[data-page-info]):not([data-info-keep])`;

const HEADING = 'h1,h2,h3,h4';
const tips = new WeakMap(); // subtitle element -> its InfoTip

/** The heading this subtitle describes: the one right before it, or the last one inside the
 *  wrapper right before it (a title row holding an icon + <h2>). */
function findHeading(sub) {
  const prev = sub.previousElementSibling;
  if (!prev) return null;
  if (prev.matches(HEADING)) return prev;
  const inner = prev.querySelectorAll(HEADING);
  return inner.length ? inner[inner.length - 1] : null;
}

function fold(sub) {
  const text = (sub.textContent || '').replace(/\s+/g, ' ').trim();
  const existing = tips.get(sub);

  if (!text) {
    if (existing) existing.remove();
    return;
  }
  if (existing) {
    // Re-attach after a heading rewrite, and follow text changes — never rebuild needlessly.
    if (existing.isConnected && existing.dataset.info === text) return;
    existing.setContent(text);
    existing.dataset.info = text;
    if (!existing.isConnected) findHeading(sub)?.append(existing);
    return;
  }

  if (sub.querySelector('a,button,input,select,textarea')) return;
  const heading = findHeading(sub);
  if (!heading) return;

  const tip = InfoTip({ content: text });
  tip.dataset.info = text;
  tips.set(sub, tip);
  heading.append(tip);
  sub.setAttribute('data-info-folded', '');
}

function scan(root) {
  root.querySelectorAll(INFO_SELECTOR).forEach(fold);
}

/** Starts folding inside `root` (the router outlet) and keeps doing so as pages mount/update. */
export function installPageInfo(root) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  scan(root);
  // WHY: a MutationObserver callback is a microtask, so it runs before the browser paints the
  // freshly mounted page — the user never sees the subtitle flash before it collapses.
  const observer = new MutationObserver(() => scan(root));
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}
