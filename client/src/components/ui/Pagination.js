/**
 * Pagination — offset (numbered pages) and cursor (prev/next) modes.
 *
 * Both modes exist because docs/api-contract.md uses both: offset for admin tables where a user
 * needs to jump to page 7, cursor for feeds and ledgers where rows are inserted constantly and
 * offset paging would silently skip or repeat records.
 *
 * Invariants:
 *  - Cursor mode CANNOT show a page count or a "last page" jump — that information does not exist
 *    in a cursor-paginated response. Faking it with an estimate is worse than omitting it.
 *  - The current page is announced with `aria-current="page"`, not conveyed by styling alone.
 *  - The ellipsis is inert text, never a button.
 */

function createArrow(direction) {
  const span = document.createElement('span');
  span.className = 'pagination__arrow';
  span.setAttribute('aria-hidden', 'true');
  const d = direction === 'prev' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6';
  span.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    `stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  return span;
}

/**
 * Page numbers with ellipses: 1 … 4 5 [6] 7 8 … 20
 * Always shows first, last, current, and `siblings` neighbours on each side.
 */
function buildPageList(current, total, siblings = 1) {
  const pages = [];
  const push = (v) => pages.push(v);

  if (total <= 7 + siblings * 2) {
    for (let i = 1; i <= total; i += 1) push(i);
    return pages;
  }

  const left = Math.max(2, current - siblings);
  const right = Math.min(total - 1, current + siblings);

  push(1);
  if (left > 2) push('…');
  for (let i = left; i <= right; i += 1) push(i);
  if (right < total - 1) push('…');
  push(total);

  return pages;
}

export function Pagination({
  mode = 'offset',
  page = 1,
  totalPages = 1,
  totalItems = null,
  pageSize = 20,
  hasNext = false,
  hasPrev = false,
  siblings = 1,
  labels = {},
  onChange = null,
} = {}) {
  const text = {
    prev: 'Previous',
    next: 'Next',
    page: 'Page',
    of: 'of',
    showing: 'Showing',
    ...labels,
  };

  const root = document.createElement('nav');
  root.className = `pagination pagination--${mode}`;
  root.setAttribute('aria-label', 'Pagination');

  const status = document.createElement('p');
  status.className = 'pagination__status';

  const controls = document.createElement('div');
  controls.className = 'pagination__controls';

  function makeNav(direction, disabled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pagination__nav pagination__nav--${direction}`;
    btn.disabled = disabled;
    const label = direction === 'prev' ? text.prev : text.next;
    btn.setAttribute('aria-label', label);
    const labelEl = document.createElement('span');
    labelEl.className = 'pagination__nav-label';
    labelEl.textContent = label;
    if (direction === 'prev') btn.append(createArrow('prev'), labelEl);
    else btn.append(labelEl, createArrow('next'));
    btn.addEventListener('click', () => {
      if (btn.disabled || !onChange) return;
      if (mode === 'cursor') onChange({ direction });
      else onChange({ page: direction === 'prev' ? page - 1 : page + 1 });
    });
    return btn;
  }

  if (mode === 'cursor') {
    // No page numbers, no total — a cursor-paginated API does not know either.
    controls.append(makeNav('prev', !hasPrev), makeNav('next', !hasNext));
    status.textContent = '';
  } else {
    const safeTotal = Math.max(1, totalPages);
    controls.append(makeNav('prev', page <= 1));

    const list = document.createElement('ul');
    list.className = 'pagination__pages';
    for (const entry of buildPageList(page, safeTotal, siblings)) {
      const li = document.createElement('li');
      if (entry === '…') {
        const gap = document.createElement('span');
        gap.className = 'pagination__ellipsis';
        gap.setAttribute('aria-hidden', 'true');
        gap.textContent = '…';
        li.append(gap);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pagination__page';
        btn.textContent = String(entry);
        btn.setAttribute('aria-label', `${text.page} ${entry}`);
        if (entry === page) {
          btn.dataset.current = 'true';
          btn.setAttribute('aria-current', 'page');
        }
        btn.addEventListener('click', () => {
          if (entry !== page && onChange) onChange({ page: entry });
        });
        li.append(btn);
      }
      list.append(li);
    }
    controls.append(list, makeNav('next', page >= safeTotal));

    if (totalItems !== null) {
      const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
      const to = Math.min(page * pageSize, totalItems);
      status.textContent = `${text.showing} ${from}–${to} ${text.of} ${totalItems}`;
    } else {
      status.textContent = `${text.page} ${page} ${text.of} ${safeTotal}`;
    }
  }

  root.append(status, controls);
  return root;
}
