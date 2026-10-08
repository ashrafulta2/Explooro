/**
 * SupplierScorecardPage.js — How salers see this supplier, and exactly what they are judged on.
 *
 * Route: /supplier/scorecard  (module: sourcing, permission: supplier.analytics.view)
 *
 * WHY the rules are shown: a grade a supplier cannot explain is one they cannot improve, and the
 * numbers (weights, cutoffs, the dispatch SLA) are admin settings that can change.
 */
import { supplierApi } from '../../services/supplier.api.js';
import { SupplierScorecardBadge } from '../../components/saler/SupplierScorecardBadge.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';

export default function SupplierScorecardPage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-page-container';

  const header = document.createElement('header');
  header.className = 'supplier-header';
  const h1 = document.createElement('h1');
  h1.textContent = t('scorecard.title', 'Supplier Scorecard');
  const sub = document.createElement('p');
  sub.className = 'supplier-header__sub';
  sub.textContent = t('scorecard.subtitle');
  header.append(h1, sub);

  const body = document.createElement('div');
  body.setAttribute('aria-live', 'polite');
  body.append(Skeleton({ height: '220px' }));
  container.append(header, body);
  // WHY mounted here: the router calls `page(root)` and does not append a returned node. A page that
  // only returns its element renders blank (core/router.js "Page module contract").
  root.append(container);

  function rulesCard(rules) {
    const card = document.createElement('section');
    card.className = 'scorecard-rules';
    const h = document.createElement('h2');
    h.textContent = t('scorecard.how_title');
    const p = document.createElement('p');
    p.textContent = t('scorecard.how_body', {
      sla: rules.dispatch_sla_hours,
      days: rules.window_days,
      min: rules.min_sample_orders,
    });
    const cut = document.createElement('p');
    cut.className = 'scorecard-rules__cutoffs';
    const c = rules.grade_cutoffs;
    cut.textContent = t('scorecard.cutoffs', { a: c.A, b: c.B, c: c.C });
    card.append(h, p, cut);
    return card;
  }

  (async () => {
    try {
      const res = await supplierApi.getScorecard();
      const data = res?.data ?? res;
      body.replaceChildren(SupplierScorecardBadge(data.scorecard, { variant: 'full', rules: data.rules }), rulesCard(data.rules));
    } catch (err) {
      console.error('Failed to load scorecard:', err);
      toast.error(t('scorecard.load_failed'));
      body.replaceChildren(EmptyState({ title: t('scorecard.load_failed') }));
    }
  })();

  return () => container.remove();
}
