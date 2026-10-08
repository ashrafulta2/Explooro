/**
 * SupplierReturnProtectionPage.js — A supplier opts in to protect salers' commission against returns.
 *
 * Route: /supplier/return-protection  (module: sourcing, read: supplier.analytics.view, act: supplier.return_protection.manage)
 *
 * WHY the cost is stated before the button: enrolling means paying a premium on every protected order that
 * completes, so the screen says how it is charged and what the supplier gets for it (salers prefer protected
 * suppliers), and says plainly that leaving does not remove cover from orders already sold.
 */
import { returnProtectionApi } from '../../services/payoutProtection.api.js';
import { ProtectionCoverTable } from '../../components/payoutProtection/ProtectionCoverTable.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { toast } from '../../services/toast.js';
import { pickMessage } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stat(value, label) {
  const box = el('div', 'pp-stat');
  box.append(el('span', 'pp-stat__value', value), el('span', 'pp-stat__label', label));
  return box;
}

export default function SupplierReturnProtectionPage(root) {
  const container = el('div', 'supplier-page-container');
  const header = el('header', 'supplier-header');
  header.append(el('h1', '', t('rprot.supplier_title')), el('p', 'supplier-header__sub', t('rprot.supplier_subtitle')));

  const body = el('div', 'incentive-stack');
  body.setAttribute('aria-live', 'polite');
  body.append(Skeleton({ height: '260px' }));
  container.append(header, body);
  // WHY mounted here: the router calls `page(root)` and does not append a returned node.
  root.append(container);

  let view = null;

  async function load() {
    const res = await returnProtectionApi.getSupplierView();
    view = res?.data ?? res;
    render();
  }

  async function change(enrolled) {
    try {
      const res = await returnProtectionApi.setEnrollment(enrolled);
      view = res?.data ?? res;
      render();
      toast.success(t(enrolled ? 'rprot.enrolled_done' : 'rprot.withdrawn_done'));
    } catch (err) {
      toast.error(pickMessage(err) || t('rprot.change_failed'));
    }
  }

  function render() {
    const status = el('section', 'incentive-card');
    status.append(
      el('h2', 'incentive-card__title', t('rprot.how_title')),
      el('p', 'incentive-card__text', t('rprot.how_body_supplier', { pct: formatNumber(view.rules.premium_pct), cap: formatCurrency(view.rules.max_claim_amount) })),
      el('p', 'incentive-card__note', t('rprot.leave_note'))
    );
    if (view.blocked) status.append(el('p', 'incentive-card__note', t('rprot.blocked_note', { grade: view.grade })));

    const actions = el('div', 'pp-actions');
    actions.append(el('span', `incentive-status incentive-status--${view.enrolled ? 'success' : 'info'}`, t(view.enrolled ? 'rprot.state_on' : 'rprot.state_off')));
    // A blocked supplier can still leave; they cannot join.
    const btn = Button({
      label: t(view.enrolled ? 'rprot.withdraw' : 'rprot.enrol'),
      variant: view.enrolled ? 'secondary' : 'primary',
      disabled: !view.enrolled && (view.blocked || !view.rules.enabled),
      onClick: () => change(!view.enrolled),
    });
    actions.append(btn);
    status.append(actions);
    if (!view.rules.enabled && !view.enrolled) status.append(el('p', 'incentive-card__note', t('rprot.closed_note')));

    const stats = el('div', 'pp-stats');
    stats.append(
      stat(String(view.stats.covers), t('rprot.stat_covers')),
      stat(String(view.stats.claims), t('rprot.stat_claims')),
      stat(formatCurrency(view.stats.claimed_total), t('rprot.stat_claimed')),
      stat(formatCurrency(view.stats.premiums_paid), t('rprot.stat_premiums'))
    );
    status.append(stats);

    const list = el('section', 'incentive-card');
    list.append(el('h2', 'incentive-card__title', t('rprot.covers_title')));
    list.append(
      view.covers.length
        ? ProtectionCoverTable(view.covers, { perspective: 'supplier' })
        : el('p', 'incentive-card__text', t('rprot.covers_empty_supplier'))
    );
    body.replaceChildren(status, list);
  }

  (async () => {
    try {
      await load();
    } catch (err) {
      console.error('Failed to load return protection:', err);
      toast.error(t('rprot.load_failed'));
      body.replaceChildren(EmptyState({ title: t('rprot.load_failed') }));
    }
  })();

  return () => container.remove();
}
