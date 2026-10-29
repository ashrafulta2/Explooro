/**
 * SampleRequestTable — sample requests as a supplier handles them or a shop partner follows them.
 *
 * One table for both audiences because the rows are the same facts; `perspective` only decides who
 * the "other party" column names. What a row can DO is passed in (`actionsFor`), so this file never
 * decides who may act - the server does, and the page only offers what the server will accept.
 *
 * Invariants:
 *  - Status is always words (Requested / Accepted / Shipped / Received / ...), never colour alone.
 *  - Amounts are the ones the server snapshotted on the request. Nothing is recomputed here.
 *
 * Styles: styles/components/incentive.css (table/status) + sample-kit.css, loaded by the routes that
 * render this (main.ts).
 */
import { t } from '../../services/i18n.ts';
import { formatCurrency, formatDate } from '../../services/format.ts';
import { Button } from '../ui/Button.ts';

/** A sample request row from the API. The amounts are the ones the server snapshotted. */
export interface SampleRequest {
  title_en?: string;
  price: number | string;
  shipping_fee: number | string;
  status: string;
  requested_at: string;
  ship_to_name?: string;
  ship_to_phone?: string;
  ship_to_address?: string;
  note?: string;
  tracking_note?: string;
  decline_reason?: string;
  saler_name?: string;
  supplier_name?: string;
}

/** One button a row offers; the page decides which, the server decides what is accepted. */
export interface SampleAction {
  label: string;
  variant?: string;
  onClick: (event: MouseEvent) => void;
}

export interface SampleRequestTableOptions {
  perspective?: 'supplier' | 'saler';
  actionsFor?: (row: SampleRequest) => SampleAction[];
}

const STATUS_TONE: Record<string, string> = {
  REQUESTED: 'info', ACCEPTED: 'info', SHIPPED: 'warning',
  DELIVERED: 'success', DECLINED: 'danger', CANCELLED: 'danger', EXPIRED: 'danger',
};

function cell<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
  const c = document.createElement(tag);
  if (className) c.className = className;
  c.textContent = text;
  return c;
}

/**
 */
export function SampleRequestTable(rows: SampleRequest[], { perspective = 'supplier', actionsFor = () => [] }: SampleRequestTableOptions = {}): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'incentive-table-wrap';

  const table = document.createElement('table');
  table.className = 'incentive-table sample-table';

  const head = document.createElement('tr');
  const columns = [
    ['col_product', ''],
    [perspective === 'supplier' ? 'col_saler' : 'col_supplier', ''],
    ['col_date', ''],
    ['col_total', 'incentive-table__num'],
    ['col_status', ''],
    ['col_actions', ''],
  ];
  for (const [key, cls] of columns) {
    const th = cell('th', t(`sample.${key}`), cls);
    th.scope = 'col';
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    const total = Number(r.price) + Number(r.shipping_fee);

    const product = cell('td', '');
    // WHY one inner div: on a phone the cell is a flex row (label | content); several loose children would
    // sit side by side instead of stacking.
    const info = cell('div', '', 'sample-info');
    info.append(cell('div', r.title_en || ''));
    if (perspective === 'supplier') {
      info.append(cell('div', `${r.ship_to_name} · ${r.ship_to_phone}`, 'sample-sub'), cell('div', r.ship_to_address, 'sample-sub'));
      if (r.note) info.append(cell('div', r.note, 'sample-sub'));
    }
    if (r.tracking_note) info.append(cell('div', t('sample.tracking', { note: r.tracking_note }), 'sample-sub'));
    if (r.decline_reason) info.append(cell('div', t('sample.declined_reason', { reason: r.decline_reason }), 'sample-sub'));
    product.append(info);

    const status = cell('td', '');
    status.append(cell('span', t(`sample.status.${r.status}`), `incentive-status incentive-status--${STATUS_TONE[r.status] || 'info'}`));

    // WHY a div inside the cell: display:flex on a <td> stops it being a table cell and breaks the row.
    const actions = cell('td', '');
    const buttons = cell('div', '', 'sample-actions');
    for (const a of actionsFor(r)) {
      buttons.append(Button({ label: a.label, variant: a.variant || 'secondary', size: 'sm', onClick: a.onClick }));
    }
    actions.append(buttons);

    tr.append(
      product,
      cell('td', perspective === 'supplier' ? r.saler_name || '' : r.supplier_name || ''),
      cell('td', formatDate(r.requested_at)),
      cell('td', formatCurrency(total), 'incentive-table__num'),
      status,
      actions
    );
    // WHY data-label: on a phone each row becomes a stacked card (sample-kit.css) and the header row is gone,
    // so every cell has to carry its own column name.
    [...tr.children].forEach((td: HTMLElement, i) => { td.dataset.label = t(`sample.${columns[i][0]}`); });
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}
