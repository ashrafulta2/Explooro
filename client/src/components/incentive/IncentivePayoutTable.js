/**
 * IncentivePayoutTable — the monthly volume-incentive rebates, as the supplier paid them or the saler
 * received them.
 *
 * One table for both audiences because the rows are the same facts; `perspective` only decides which
 * column is first (a supplier looks for the saler's share, a saler looks for who paid).
 *
 * Invariants:
 *  - Status is always words (Paid / Waiting for funds / Not paid), never colour alone.
 *  - The amounts are the ones the server stored. Nothing is recomputed here, so what the table says
 *    can never disagree with the ledger.
 *
 * Styles: styles/components/incentive.css, loaded by the routes that render this (main.js).
 */
import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';

const STATUS_TONE = { PAID: 'success', UNFUNDED: 'warning', LAPSED: 'danger' };

function cell(tag, text, className) {
  const c = document.createElement(tag);
  if (className) c.className = className;
  c.textContent = text;
  return c;
}

/**
 * @param {Array<object>} rows payouts from the API
 * @param {{ perspective?: 'supplier'|'saler' }} [options]
 */
export function IncentivePayoutTable(rows, { perspective = 'supplier' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'incentive-table-wrap';

  const table = document.createElement('table');
  table.className = 'incentive-table';

  const head = document.createElement('tr');
  const columns = [
    ['col_period', ''],
    ...(perspective === 'saler' ? [['col_supplier', '']] : []),
    ['col_volume', 'incentive-table__num'],
    ['col_rebate', 'incentive-table__num'],
    ['col_fee', 'incentive-table__num'],
    ['col_net', 'incentive-table__num'],
    ['col_status', ''],
  ];
  for (const [key, cls] of columns) {
    const th = cell('th', t(`incentive.${key}`), cls);
    th.scope = 'col';
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);

  const tbody = document.createElement('tbody');
  for (const r of rows || []) {
    const tr = document.createElement('tr');
    tr.append(cell('td', String(r.period_start).slice(0, 7)));
    if (perspective === 'saler') tr.append(cell('td', r.supplier_name || ''));
    tr.append(
      cell('td', formatCurrency(r.volume), 'incentive-table__num'),
      cell('td', `${formatCurrency(r.gross_amount)} (${Number(r.rebate_pct)}%)`, 'incentive-table__num'),
      cell('td', formatCurrency(r.platform_fee), 'incentive-table__num'),
      cell('td', formatCurrency(r.net_amount), 'incentive-table__num')
    );
    const status = document.createElement('td');
    const chip = document.createElement('span');
    chip.className = `incentive-status incentive-status--${STATUS_TONE[r.status] || 'info'}`;
    chip.textContent = t(`incentive.status.${r.status}`, r.status);
    status.append(chip);
    tr.append(status);
    tbody.append(tr);
  }

  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}
