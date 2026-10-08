/**
 * SalerReturnProtectionPage.js — Which suppliers protect a saler's commission against returns, and what
 * the saler has been paid under that promise.
 *
 * Route: /saler/return-protection  (module: sourcing, read: saler.sourcing.view)
 *
 * WHY the limits are shown: a saler should know what the promise covers (only the commission a return
 * actually took back, up to a cap per order) and that repeated claims are limited, before relying on it.
 */
import { returnProtectionApi } from '../../services/payoutProtection.api.js';
import { ProtectionCoverTable } from '../../components/payoutProtection/ProtectionCoverTable.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export default function SalerReturnProtectionPage(root) {
  const container = el('div', 'supplier-page-container');
  const header = el('header', 'supplier-header');
  header.append(el('h1', '', t('rprot.saler_title')), el('p', 'supplier-header__sub', t('rprot.saler_subtitle')));

  const body = el('div', 'incentive-stack');
  body.setAttribute('aria-live', 'polite');
  body.append(Skeleton({ height: '260px' }));
  container.append(header, body);
  // WHY mounted here: the router calls `page(root)` and does not append a returned node.
  root.append(container);

  function render(view) {
    const how = el('section', 'incentive-card');
    how.append(
      el('h2', 'incentive-card__title', t('rprot.how_title')),
      el('p', 'incentive-card__text', t('rprot.how_body_saler', { cap: formatCurrency(view.rules.max_claim_amount), max: formatNumber(view.rules.max_claims_per_saler_30d) }))
    );

    const suppliers = el('section', 'incentive-card');
    suppliers.append(el('h2', 'incentive-card__title', t('rprot.suppliers_title')));
    if (view.suppliers.length) {
      const ul = el('ul', 'pp-list');
      view.suppliers.forEach((s) => ul.append(el('li', '', s.supplier_name || `#${s.supplier_id}`)));
      suppliers.append(ul);
    } else {
      suppliers.append(el('p', 'incentive-card__text', t('rprot.suppliers_empty')));
    }

    const claims = el('section', 'incentive-card');
    claims.append(el('h2', 'incentive-card__title', t('rprot.claims_title')));
    claims.append(
      view.covers.length
        ? ProtectionCoverTable(view.covers, { perspective: 'saler' })
        : el('p', 'incentive-card__text', t('rprot.covers_empty_saler'))
    );
    body.replaceChildren(how, suppliers, claims);
  }

  (async () => {
    try {
      const res = await returnProtectionApi.getSalerView();
      render(res?.data ?? res);
    } catch (err) {
      console.error('Failed to load return protection:', err);
      toast.error(t('rprot.load_failed'));
      body.replaceChildren(EmptyState({ title: t('rprot.load_failed') }));
    }
  })();

  return () => container.remove();
}
