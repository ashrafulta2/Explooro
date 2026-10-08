/**
 * FastPayoutTable — escrowed earnings a person could take early, with what it would cost.
 *
 * What a row can DO is decided by the server (`eligible`, `reason`); this file only shows it. Nothing is
 * recomputed here: the fee, the net and the days saved are the server's quote.
 *
 * Invariants:
 *  - An entry that cannot be taken says WHY in words (the server's reason code), never just a greyed button.
 *  - Amounts go through formatCurrency; the fee is shown as a percentage and as money.
 *
 * Styles: styles/components/incentive.css (table shell) + payout-protection.css, loaded by the routes
 * that render this (main.js).
 */
import { t } from '../../services/i18n.js';
import { formatCurrency, formatDate, formatNumber } from '../../services/format.js';
import { Button } from '../ui/Button.js';

function cell(tag, text, className) {
  const c = document.createElement(tag);
  if (className) c.className = className;
  c.textContent = text;
  return c;
}

/** The i18n key for why an entry cannot be taken early. Unknown codes fall back to a generic line. */
export function reasonKey(code) {
  const known = ['NOT_LOCKED', 'NOT_DELIVERED', 'COD_UNRECONCILED', 'OPEN_CLAIM', 'GRADE_BLOCKED', 'TOO_SMALL', 'TOO_LARGE', 'TOO_SOON', 'EXPOSURE_LIMIT'];
  return known.includes(code) ? `fastpay.reason.${code}` : 'fastpay.reason.OTHER';
}

/**
 * @param {Array<object>} entries from the API (`entries`)
 * @param {{ onTake?: (entry: object, button: HTMLElement) => void, busyId?: number|string|null }} [options]
 */
export function FastPayoutTable(entries, { onTake = () => {}, busyId = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'incentive-table-wrap';

  const table = document.createElement('table');
  table.className = 'incentive-table fastpay-table';

  const columns = [
    ['col_order', ''],
    ['col_amount', 'incentive-table__num'],
    ['col_due', ''],
    ['col_fee', 'incentive-table__num'],
    ['col_receive', 'incentive-table__num'],
    ['col_action', ''],
  ];
  const head = document.createElement('tr');
  for (const [key, cls] of columns) {
    const th = cell('th', t(`fastpay.${key}`), cls);
    th.scope = 'col';
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const e of entries) {
    const tr = document.createElement('tr');

    const order = cell('td', '');
    const info = cell('div', '', 'fastpay-info');
    info.append(cell('div', e.sub_order_ref || `#${e.sub_order_id}`, 'fastpay-ref'));
    info.append(cell('div', t(e.role === 'SALER' ? 'fastpay.role_saler' : 'fastpay.role_supplier'), 'fastpay-sub'));
    order.append(info);

    const action = cell('td', '');
    const box = cell('div', '', 'fastpay-action');
    if (e.eligible) {
      const btn = Button({
        label: t('fastpay.take'),
        size: 'sm',
        onClick: () => onTake(e, btn),
      });
      if (String(busyId) === String(e.entry_id)) btn.setLoading?.(true);
      box.append(btn);
      box.append(cell('div', t('fastpay.saves', { days: formatNumber(e.days_saved) }), 'fastpay-sub'));
    } else {
      box.append(cell('span', t(reasonKey(e.reason)), 'incentive-status incentive-status--info fastpay-reason'));
    }
    action.append(box);

    tr.append(
      order,
      cell('td', formatCurrency(e.amount), 'incentive-table__num'),
      cell('td', formatDate(e.hold_until)),
      cell('td', e.eligible ? `${formatCurrency(e.fee)} (${formatNumber(e.fee_pct)}%)` : '—', 'incentive-table__num'),
      cell('td', e.eligible ? formatCurrency(e.net) : '—', 'incentive-table__num'),
      action
    );
    // WHY data-label: on a phone each row becomes a stacked card and the header row is gone, so every
    // cell carries its own column name.
    [...tr.children].forEach((td, i) => { td.dataset.label = t(`fastpay.${columns[i][0]}`); });
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}
