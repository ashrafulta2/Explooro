/**
 * Table — sortable, selectable data grid with built-in loading and empty states.
 *
 * Responsibility: every list of records in the admin, vault, and catalogue surfaces.
 *
 * Invariants:
 *  - `rows === null` means UNKNOWN (still loading) and renders skeleton rows; `rows === []` means
 *    KNOWN-EMPTY and renders the EmptyState. Collapsing these two into one falsy check is the bug
 *    that makes a slow connection look like an empty account — the single most damaging thing a
 *    marketplace can tell a seller who has products.
 *  - Horizontal overflow is contained by the wrapper, never the page (design-system §8). The
 *    wrapper is the only thing that scrolls sideways at 360px.
 *  - Sort state is CONTROLLED. The table renders what it is given and reports intent through
 *    onSortChange; it never sorts in place, because real sorting is server-side and paginated.
 *  - The select-all checkbox reflects three states, and `indeterminate` is a DOM property with no
 *    HTML attribute — it must be reapplied on every render.
 */

import { Checkbox } from './Checkbox.js';
import { EmptyState } from './EmptyState.js';
import { Skeleton } from './Skeleton.js';

/** Sort arrow. Rotated by CSS for descending. */
function createSortIcon() {
  const span = document.createElement('span');
  span.className = 'table__sort-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6 6 6-6M6 9l6-6 6 6"/></svg>';
  return span;
}

export function Table({
  columns = [],
  rows = null,
  loading = false,
  selectable = false,
  density = 'comfortable',
  caption = '',
  sort = null,
  skeletonRows = 5,
  emptyState = null,
  getRowId = (row, index) => row.id ?? index,
  onSortChange = null,
  onSelectionChange = null,
} = {}) {
  const root = document.createElement('div');
  root.className = 'table-root';

  const wrapper = document.createElement('div');
  // The scroll container. `tabindex=0` is required: a region that scrolls must be reachable by
  // keyboard, or a keyboard user cannot see the off-screen columns at all.
  wrapper.className = 'table-wrapper';
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  if (caption) wrapper.setAttribute('aria-label', caption);

  const table = document.createElement('table');
  table.className = `table table--${density}`;

  if (caption) {
    const cap = document.createElement('caption');
    cap.className = 'table__caption';
    cap.textContent = caption;
    table.append(cap);
  }

  const thead = document.createElement('thead');
  thead.className = 'table__head';
  const headRow = document.createElement('tr');

  const selection = new Set();
  let selectAllBox = null;
  /** column key -> { th, btn }, so sort state can be updated without re-deriving it from markup. */
  const sortControls = new Map();

  if (selectable) {
    const th = document.createElement('th');
    th.className = 'table__cell table__cell--select';
    th.scope = 'col';
    selectAllBox = Checkbox({
      label: '',
      onChange: (checked) => {
        selection.clear();
        if (checked && Array.isArray(rows)) {
          rows.forEach((row, i) => selection.add(getRowId(row, i)));
        }
        renderBody();
        emitSelection();
      },
    });
    selectAllBox.input.setAttribute('aria-label', 'Select all rows');
    th.append(selectAllBox);
    headRow.append(th);
  }

  for (const col of columns) {
    const th = document.createElement('th');
    th.className = 'table__cell table__cell--head';
    th.scope = 'col';
    if (col.align) th.dataset.align = col.align;
    if (col.width) th.style.width = typeof col.width === 'number' ? `${col.width}px` : col.width;

    if (col.sortable) {
      const active = sort?.key === col.key;
      const dir = active ? sort.dir : 'none';
      // aria-sort on the header cell is what actually communicates sort state to a screen
      // reader; the icon is only the visual half of the same message.
      th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'table__sort';
      btn.dataset.direction = dir;
      btn.textContent = col.label;
      btn.append(createSortIcon());
      btn.addEventListener('click', () => {
        const current = sort?.key === col.key ? sort.dir : 'none';
        const next = current === 'asc' ? 'desc' : 'asc';
        if (onSortChange) onSortChange({ key: col.key, dir: next });
      });
      th.append(btn);
      sortControls.set(col.key, { th, btn });
    } else {
      th.textContent = col.label;
    }
    headRow.append(th);
  }

  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  tbody.className = 'table__body';
  table.append(tbody);

  const totalColumns = columns.length + (selectable ? 1 : 0);

  function emitSelection() {
    if (onSelectionChange) onSelectionChange([...selection]);
  }

  function syncSelectAll() {
    if (!selectAllBox || !Array.isArray(rows)) return;
    const total = rows.length;
    const picked = selection.size;
    selectAllBox.input.checked = total > 0 && picked === total;
    selectAllBox.setIndeterminate(picked > 0 && picked < total);
  }

  function renderBody() {
    tbody.replaceChildren();

    // UNKNOWN — still loading.
    if (loading || rows === null) {
      root.dataset.state = 'loading';
      table.setAttribute('aria-busy', 'true');
      for (let i = 0; i < skeletonRows; i += 1) {
        const tr = document.createElement('tr');
        tr.className = 'table__row table__row--skeleton';
        for (let c = 0; c < totalColumns; c += 1) {
          const td = document.createElement('td');
          td.className = 'table__cell';
          td.append(Skeleton({ variant: 'block', height: 14 }));
          tr.append(td);
        }
        tbody.append(tr);
      }
      return;
    }

    table.removeAttribute('aria-busy');

    // KNOWN-EMPTY — a designed surface, not a blank area.
    if (rows.length === 0) {
      root.dataset.state = 'empty';
      const tr = document.createElement('tr');
      tr.className = 'table__row table__row--empty';
      const td = document.createElement('td');
      td.className = 'table__cell table__cell--empty';
      td.colSpan = totalColumns;
      td.append(
        emptyState ??
          EmptyState({
            title: 'Nothing here yet',
            description: 'When there is data to show, it will appear in this table.',
          })
      );
      tr.append(td);
      tbody.append(tr);
      syncSelectAll();
      return;
    }

    root.dataset.state = 'ready';

    rows.forEach((row, index) => {
      const id = getRowId(row, index);
      const tr = document.createElement('tr');
      tr.className = 'table__row';
      const isSelected = selection.has(id);
      if (isSelected) {
        tr.dataset.selected = 'true';
        // Announce selection, don't just tint the row.
        tr.setAttribute('aria-selected', 'true');
      }

      if (selectable) {
        const td = document.createElement('td');
        td.className = 'table__cell table__cell--select';
        const box = Checkbox({
          label: '',
          checked: isSelected,
          onChange: (checked) => {
            if (checked) selection.add(id);
            else selection.delete(id);
            tr.dataset.selected = checked ? 'true' : 'false';
            if (checked) tr.setAttribute('aria-selected', 'true');
            else tr.removeAttribute('aria-selected');
            syncSelectAll();
            emitSelection();
          },
        });
        box.input.setAttribute('aria-label', `Select row ${index + 1}`);
        td.append(box);
        tr.append(td);
      }

      for (const col of columns) {
        const td = document.createElement('td');
        td.className = 'table__cell';
        if (col.align) td.dataset.align = col.align;
        if (col.numeric) td.classList.add('text-numeric');

        const value = col.render ? col.render(row, index) : row[col.key];
        if (value instanceof Node) td.append(value);
        else td.textContent = value ?? '';
        tr.append(td);
      }

      tbody.append(tr);
    });

    syncSelectAll();
  }

  renderBody();
  wrapper.append(table);
  root.append(wrapper);

  root.setRows = (next) => {
    rows = next;
    loading = false;
    selection.clear();
    renderBody();
  };
  root.setLoading = (on) => {
    loading = on;
    renderBody();
  };
  root.setSort = (next) => {
    sort = next;
    for (const [key, { th, btn }] of sortControls) {
      const dir = next?.key === key ? next.dir : 'none';
      btn.dataset.direction = dir;
      th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none');
    }
  };
  root.getSelection = () => [...selection];
  root.clearSelection = () => {
    selection.clear();
    renderBody();
    emitSelection();
  };

  return root;
}
