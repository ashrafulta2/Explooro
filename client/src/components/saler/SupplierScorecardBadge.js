/**
 * SupplierScorecardBadge — a supplier's measured reputation, as salers and the supplier see it.
 *
 * Two shapes of one component:
 *   compact  a one-line chip for a catalog card: grade + typical dispatch time.
 *   full     the four metrics with plain-language labels, for the supplier's own Scorecard page.
 *
 * Invariants:
 *  - A supplier without enough orders is shown as "New supplier", never as a grade and never as
 *    zeroes. Absence of data is not a bad score.
 *  - A grade is never conveyed by colour alone: the letter is always printed (WCAG 1.4.1).
 *  - Every figure is formatted here; a null metric renders "—", not "0%".
 */
import { t } from '../../services/i18n.js';
// Styles: styles/components/supplier-scorecard.css, loaded by the routes that render this (main.js).

const GRADE_TONE = { A: 'success', B: 'info', C: 'warning', D: 'danger' };

function pct(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(1).replace(/\.0$/, '')}%`;
}

function hours(value) {
  return value === null || value === undefined ? '—' : `${Math.round(Number(value))}h`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** `scorecard` is the public view from the API (`supplier_scorecard` on a catalog item). */
export function SupplierScorecardBadge(scorecard, { variant = 'compact', rules = null } = {}) {
  const sc = scorecard || { grade: null, is_new: true };
  return variant === 'full' ? buildFull(sc, rules) : buildCompact(sc);
}

function buildCompact(sc) {
  const chip = el('span', 'scorecard-chip');
  if (sc.is_new || !sc.grade) {
    chip.classList.add('scorecard-chip--new');
    chip.textContent = t('scorecard.new_supplier', 'New supplier');
    chip.title = t('scorecard.new_hint', { min: sc.min_sample_orders ?? 10 });
    return chip;
  }
  chip.classList.add(`scorecard-chip--${GRADE_TONE[sc.grade] || 'info'}`);
  chip.append(el('span', 'scorecard-chip__grade', sc.grade));
  if (sc.median_dispatch_hours !== null && sc.median_dispatch_hours !== undefined) {
    chip.append(el('span', 'scorecard-chip__meta', t('scorecard.dispatch_hours', { hours: Math.round(sc.median_dispatch_hours) })));
  }
  chip.title = t('scorecard.based_on', { count: sc.sample_orders, days: sc.window_days });
  chip.setAttribute('aria-label', `${t('scorecard.grade_label', { grade: sc.grade })}. ${chip.title}`);
  return chip;
}

const METRICS = [
  { key: 'on_time_dispatch_pct', label: 'scorecard.metric.on_time_dispatch', hint: 'scorecard.hint.on_time_dispatch', weight: 'on_time_dispatch', fmt: pct },
  { key: 'delivery_success_pct', label: 'scorecard.metric.delivery_success', hint: 'scorecard.hint.delivery_success', weight: 'delivery_success', fmt: pct },
  { key: 'return_rate_pct', label: 'scorecard.metric.return_rate', hint: 'scorecard.hint.return_rate', weight: 'return_rate', fmt: pct },
  { key: 'dispute_rate_pct', label: 'scorecard.metric.dispute_rate', hint: 'scorecard.hint.dispute_rate', weight: 'dispute_rate', fmt: pct },
  { key: 'median_dispatch_hours', label: 'scorecard.metric.median_dispatch', hint: 'scorecard.hint.median_dispatch', weight: null, fmt: hours },
];

function buildFull(sc, rules) {
  const root = el('section', 'scorecard');
  root.setAttribute('aria-label', t('scorecard.title', 'Supplier Scorecard'));

  const head = el('div', 'scorecard__head');
  const graded = !sc.is_new && sc.grade;
  const grade = el('div', `scorecard__grade scorecard__grade--${graded ? GRADE_TONE[sc.grade] : 'new'}`);
  grade.append(el('span', 'scorecard__grade-letter', graded ? sc.grade : '—'));
  if (graded && sc.score !== null && sc.score !== undefined) {
    grade.append(el('span', 'scorecard__grade-score', t('scorecard.score', { score: sc.score })));
  }
  const summary = el('div', 'scorecard__summary');
  summary.append(
    el('h2', 'scorecard__headline', graded ? t('scorecard.grade_label', { grade: sc.grade }) : t('scorecard.new_supplier', 'New supplier')),
    el(
      'p',
      'scorecard__sub',
      graded
        ? t('scorecard.based_on', { count: sc.sample_orders, days: sc.window_days })
        : t('scorecard.new_hint', { min: rules?.min_sample_orders ?? sc.min_sample_orders ?? 10 })
    )
  );
  head.append(grade, summary);
  root.append(head);

  const grid = el('ul', 'scorecard__metrics');
  for (const m of METRICS) {
    const item = el('li', 'scorecard__metric');
    item.append(el('span', 'scorecard__metric-value', m.fmt(sc[m.key])), el('span', 'scorecard__metric-label', t(m.label)));
    item.append(el('span', 'scorecard__metric-hint', t(m.hint, { sla: rules?.dispatch_sla_hours ?? 48 })));
    if (rules?.weights && m.weight) {
      item.append(el('span', 'scorecard__metric-weight', t('scorecard.weight', { pct: rules.weights[m.weight] })));
    }
    grid.append(item);
  }
  root.append(grid);
  return root;
}
