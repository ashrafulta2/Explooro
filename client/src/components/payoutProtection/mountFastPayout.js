/**
 * mountFastPayout — the Fast Payout page body, shared by the supplier's page and the saler's page.
 *
 * Both audiences take their own escrowed earnings early; only the endpoints differ, so the two route pages
 * pass in `load` and `take` and this builds the same screen for each.
 *
 * WHY the confirmation states the fee and the catch: taking money early costs a fee, and a later return is
 * still recovered from the balance that results. A person must see both before they press the button, not
 * discover them afterwards.
 */
import { FastPayoutTable } from './FastPayoutTable.js';
import { confirmDialog } from '../ui/ConfirmDialog.js';
import { Skeleton } from '../ui/Skeleton.js';
import { EmptyState } from '../ui/EmptyState.js';
import { toast } from '../../services/toast.js';
import { pickMessage } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { formatCurrency, formatDate, formatNumber } from '../../services/format.js';

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

function historyTable(rows) {
  const wrap = el('div', 'incentive-table-wrap');
  const table = el('table', 'incentive-table');
  const head = document.createElement('tr');
  for (const key of ['col_date', 'col_order', 'col_amount', 'col_fee', 'col_receive']) {
    const th = el('th', key === 'col_date' || key === 'col_order' ? '' : 'incentive-table__num', t(`fastpay.${key}`));
    th.scope = 'col';
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.append(
      el('td', '', formatDate(r.created_at)),
      el('td', '', r.sub_order_ref || `#${r.sub_order_id}`),
      el('td', 'incentive-table__num', formatCurrency(r.gross_amount)),
      el('td', 'incentive-table__num', `${formatCurrency(r.fee_amount)} (${formatNumber(r.fee_pct)}%)`),
      el('td', 'incentive-table__num', formatCurrency(r.net_amount))
    );
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

/**
 * @param {HTMLElement} root
 * @param {{ load: () => Promise<any>, take: (entryId: number|string) => Promise<any> }} api
 * @returns {() => void} cleanup
 */
export function mountFastPayout(root, { load, take }) {
  const container = el('div', 'supplier-page-container');
  const header = el('header', 'supplier-header');
  header.append(el('h1', '', t('fastpay.title')), el('p', 'supplier-header__sub', t('fastpay.subtitle')));

  const body = el('div', 'incentive-stack');
  body.setAttribute('aria-live', 'polite');
  body.append(Skeleton({ height: '260px' }));
  container.append(header, body);
  // WHY mounted here: the router calls `page(root)` and does not append a returned node.
  root.append(container);

  let view = null;
  let busyId = null;

  async function refresh() {
    const res = await load();
    view = res?.data ?? res;
    render();
  }

  async function onTake(entry, trigger) {
    if (busyId) return;
    const ok = await confirmDialog({
      title: t('fastpay.confirm_title', { amount: formatCurrency(entry.amount) }),
      description: t('fastpay.confirm_body', {
        fee: formatCurrency(entry.fee), pct: formatNumber(entry.fee_pct), net: formatCurrency(entry.net), days: formatNumber(entry.days_saved),
      }),
      confirmLabel: t('fastpay.confirm_take', { net: formatCurrency(entry.net) }),
      cancelLabel: t('fastpay.confirm_cancel'),
      trigger,
    });
    if (!ok) return;
    busyId = entry.entry_id;
    render();
    try {
      await take(entry.entry_id);
      toast.success(t('fastpay.done', { net: formatCurrency(entry.net) }));
    } catch (err) {
      toast.error(pickMessage(err) || t('fastpay.failed'));
    } finally {
      busyId = null;
      // WHY reload on failure too: the reason it failed (already taken, a return opened) is now on screen.
      try { await refresh(); } catch { render(); }
    }
  }

  function render() {
    const how = el('section', 'incentive-card');
    how.append(
      el('h2', 'incentive-card__title', t('fastpay.how_title')),
      el('p', 'incentive-card__text', t('fastpay.how_body', { min: formatNumber(view.rules.min_days_saved) })),
      el('p', 'incentive-card__note', t('fastpay.catch_note'))
    );
    const stats = el('div', 'pp-stats');
    stats.append(
      stat(formatCurrency(view.outstanding), t('fastpay.stat_outstanding')),
      stat(formatCurrency(view.headroom), t('fastpay.stat_headroom'))
    );
    how.append(stats);

    const list = el('section', 'incentive-card');
    list.append(el('h2', 'incentive-card__title', t('fastpay.entries_title')));
    list.append(
      view.entries.length
        ? FastPayoutTable(view.entries, { onTake, busyId })
        : el('p', 'incentive-card__text', t('fastpay.entries_empty'))
    );

    const past = el('section', 'incentive-card');
    past.append(el('h2', 'incentive-card__title', t('fastpay.history_title')));
    past.append(view.history.length ? historyTable(view.history) : el('p', 'incentive-card__text', t('fastpay.history_empty')));

    body.replaceChildren(how, list, past);
  }

  (async () => {
    try {
      await refresh();
    } catch (err) {
      console.error('Failed to load fast payout:', err);
      toast.error(t('fastpay.load_failed'));
      body.replaceChildren(EmptyState({ title: t('fastpay.load_failed') }));
    }
  })();

  return () => container.remove();
}
