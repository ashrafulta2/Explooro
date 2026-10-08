/**
 * SalerIncentivesPage.js — A saler's progress towards each supplier's monthly volume rebate.
 *
 * Route: /saler/incentives  (module: sourcing, permission: saler.sourcing.view)
 *
 * WHY progress is shown against the NEXT tier: "you sold 30,000" says nothing about what to do next;
 * "20,000 more reaches 2%" does. The amount shown as "on course" is net of the platform's share, so
 * it is what actually lands in the saler's vault.
 */
import { api } from '../../core/api.js';
import { IncentivePayoutTable } from '../../components/incentive/IncentivePayoutTable.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';
import { formatCurrency, formatDate } from '../../services/format.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Share of the way to the next tier, 0..100. At the top tier the bar is full. */
export function progressPercent(program) {
  if (!program.next_tier) return 100;
  const floor = Number(program.current_tier?.min_volume ?? 0);
  const span = Number(program.next_tier.min_volume) - floor;
  if (span <= 0) return 100;
  return Math.max(0, Math.min(100, ((Number(program.volume) - floor) / span) * 100));
}

function programCard(program) {
  const card = el('article', 'incentive-card incentive-progress');
  card.append(el('h2', 'incentive-card__title', program.supplier_name));
  card.append(el('p', 'incentive-card__tiers', program.tiers.map((x) => `${formatCurrency(x.min_volume)} → ${Number(x.rebate_pct)}%`).join('  ·  ')));

  const bar = el('div', 'incentive-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const pct = Math.round(progressPercent(program));
  bar.setAttribute('aria-valuenow', String(pct));
  bar.setAttribute('aria-label', program.supplier_name);
  const fill = el('div', 'incentive-bar__fill');
  fill.style.width = `${pct}%`;
  bar.append(fill);
  card.append(bar);

  const lines = el('ul', 'incentive-lines');
  lines.append(
    el('li', '', t('incentive.sold', { volume: formatCurrency(program.volume) })),
    el('li', '', program.current_tier ? t('incentive.tier_now', { pct: Number(program.current_tier.rebate_pct) }) : t('incentive.tier_none')),
    el(
      'li',
      '',
      program.next_tier
        ? t('incentive.next_goal', { remaining: formatCurrency(program.remaining_to_next), pct: Number(program.next_tier.rebate_pct) })
        : t('incentive.top_tier')
    )
  );
  if (program.current_tier) {
    const strong = el('li', 'incentive-lines__strong', t('incentive.on_course', { amount: formatCurrency(program.on_course) }));
    lines.append(strong);
  }
  card.append(lines);
  return card;
}

export default function SalerIncentivesPage(root) {
  const container = el('div', 'supplier-page-container');

  const header = el('header', 'supplier-header');
  header.append(el('h1', '', t('incentive.saler_title', 'Volume Incentives')), el('p', 'supplier-header__sub', t('incentive.saler_subtitle')));

  const body = el('div', 'incentive-stack');
  body.setAttribute('aria-live', 'polite');
  body.append(Skeleton({ height: '220px' }));
  container.append(header, body);
  // WHY mounted here: the router calls `page(root)` and does not append a returned node.
  root.append(container);

  (async () => {
    try {
      const res = await api.get('/sourcing/incentives');
      const data = res?.data ?? res;
      const nodes = [];

      nodes.push(el('p', 'incentive-card__note', t('incentive.saler_month', { start: formatDate(data.period.start), end: formatDate(data.period.end) })));
      if (data.programs.length) nodes.push(...data.programs.map(programCard));
      else nodes.push(EmptyState({ title: t('incentive.saler_empty_title'), description: t('incentive.saler_empty_body'), compact: true }));

      const payouts = el('section', 'incentive-card');
      payouts.append(el('h2', 'incentive-card__title', t('incentive.saler_payouts_title')));
      payouts.append(
        data.payouts.length
          ? IncentivePayoutTable(data.payouts, { perspective: 'saler' })
          : el('p', 'incentive-card__text', t('incentive.saler_payouts_empty'))
      );
      nodes.push(payouts);

      body.replaceChildren(...nodes);
    } catch (err) {
      console.error('Failed to load incentives:', err);
      toast.error(t('incentive.load_saler_failed'));
      body.replaceChildren(EmptyState({ title: t('incentive.load_saler_failed') }));
    }
  })();

  return () => container.remove();
}
