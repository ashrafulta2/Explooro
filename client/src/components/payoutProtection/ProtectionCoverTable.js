/**
 * ProtectionCoverTable — the orders covered by return protection, and what became of each cover.
 *
 * One table for both audiences because the rows are the same facts; `perspective` only decides whether the
 * premium column (a supplier's cost) is shown.
 *
 * Invariants:
 *  - Status is always words (Covered / Paid / Not paid), never colour alone, and a refused claim says why.
 *  - Amounts are the ones the server snapshotted on the cover. Nothing is recomputed here.
 *
 * Styles: styles/components/incentive.css (table/status) + payout-protection.css, loaded by the routes
 * that render this (main.js).
 */
import { t } from '../../services/i18n.js';
import { formatCurrency, formatDate } from '../../services/format.js';

const TONE = { ACTIVE: 'info', CLAIMED: 'success', DENIED: 'danger' };
const DENIED_REASONS = ['CLAIM_LIMIT', 'NOT_CLAWED_BACK', 'NOTHING_TO_PAY'];

function cell(tag, text, className) {
  const c = document.createElement(tag);
  if (className) c.className = className;
  c.textContent = text;
  return c;
}

/** The i18n key for why a claim was not paid. Unknown codes fall back to a generic line. */
export function deniedKey(code) {
  return DENIED_REASONS.includes(code) ? `rprot.denied.${code}` : 'rprot.denied.OTHER';
}

/**
 * @param {Array<object>} covers from the API (`covers`)
 * @param {{ perspective?: 'supplier'|'saler' }} [options]
 */
export function ProtectionCoverTable(covers, { perspective = 'supplier' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'incentive-table-wrap';

  const table = document.createElement('table');
  table.className = 'incentive-table fastpay-table';

  const columns = [
    ['col_order', ''],
    ['col_insured', 'incentive-table__num'],
    ...(perspective === 'supplier' ? [['col_premium', 'incentive-table__num']] : []),
    ['col_status', ''],
    ['col_claim', 'incentive-table__num'],
  ];
  const head = document.createElement('tr');
  for (const [key, cls] of columns) {
    const th = cell('th', t(`rprot.${key}`), cls);
    th.scope = 'col';
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const c of covers) {
    const tr = document.createElement('tr');

    const status = cell('td', '');
    const box = cell('div', '', 'fastpay-info');
    box.append(cell('span', t(`rprot.status.${c.status}`), `incentive-status incentive-status--${TONE[c.status] || 'info'}`));
    if (c.status === 'DENIED') box.append(cell('div', t(deniedKey(c.denied_reason)), 'fastpay-sub'));
    status.append(box);

    const cells = [
      cell('td', c.sub_order_ref || '', 'fastpay-ref'),
      cell('td', formatCurrency(c.insured_amount), 'incentive-table__num'),
    ];
    if (perspective === 'supplier') {
      cells.push(cell('td', c.premium_charged_at ? formatCurrency(c.premium_amount) : '—', 'incentive-table__num'));
    }
    cells.push(
      status,
      cell('td', c.status === 'CLAIMED' ? `${formatCurrency(c.claim_amount)} · ${formatDate(c.claimed_at)}` : '—', 'incentive-table__num')
    );
    tr.append(...cells);
    // WHY data-label: see FastPayoutTable.
    [...tr.children].forEach((td, i) => { td.dataset.label = t(`rprot.${columns[i][0]}`); });
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}
