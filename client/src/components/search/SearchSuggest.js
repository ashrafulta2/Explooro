/**
 * SearchSuggest — typeahead dropdown for the TopBar product search (Prompt 4.4, plan A).
 *
 * Attaches to an existing search <form> + <input> rather than rendering its own, because the
 * TopBar owns that markup. Everything it adds lives inside the form subtree (the dropdown is
 * `position: absolute` under a `position: relative` form) and every listener is on the form,
 * the input, or a dropdown row — so when AppShell rebuilds the TopBar (`replaceChildren`), the
 * whole thing is garbage-collected with no document-level listener left behind. `destroy()` is
 * still returned for the gallery specimen and any future explicit-cleanup caller.
 *
 * Keyboard: ↓/↑ move the active row, Enter on an active row opens it (otherwise the form submits
 * normally → /search results page), Esc closes the dropdown.
 */
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { searchSuggest } from '../../services/catalog.api.js';
import { resolveProductImage } from '../product/ProductCard.js';

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;

function productPath(p) {
  return `/product/${encodeURIComponent(p.ref || p.slug || p.id)}`;
}

function searchPath(term) {
  return `/search?q=${encodeURIComponent(term)}`;
}

export function attachSearchSuggest({ form, input, navigate }) {
  if (!form || !input || typeof navigate !== 'function') {
    return { destroy() {} };
  }

  const panel = document.createElement('div');
  panel.className = 'topbar__search-suggest';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;
  form.append(panel);

  let timer = null;
  let reqSeq = 0;
  let items = []; // [{ type: 'product', product } | { type: 'all', term }]
  let activeIndex = -1;
  let lastTerm = '';

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function close() {
    panel.hidden = true;
    panel.replaceChildren();
    items = [];
    activeIndex = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function setActive(next) {
    activeIndex = next;
    const rows = panel.querySelectorAll('[data-suggest-row]');
    rows.forEach((row, i) => {
      const on = i === activeIndex;
      row.classList.toggle('is-active', on);
      row.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        input.setAttribute('aria-activedescendant', row.id);
        row.scrollIntoView({ block: 'nearest' });
      }
    });
    if (activeIndex < 0) input.removeAttribute('aria-activedescendant');
  }

  function activate(index) {
    const item = items[index];
    if (!item) return;
    close();
    if (item.type === 'product') navigate(productPath(item.product));
    else navigate(searchPath(item.term));
  }

  function render(term, suggestions, total) {
    panel.replaceChildren();
    items = [];
    activeIndex = -1;

    const lang = getLanguage();

    if (suggestions.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'topbar__search-suggest-empty';
      empty.textContent = t('marketplace.search_suggest.no_results', { query: term });
      panel.append(empty);
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      return;
    } else {
      const heading = document.createElement('p');
      heading.className = 'topbar__search-suggest-heading';
      heading.textContent = t('marketplace.search_suggest.heading');
      panel.append(heading);

      suggestions.forEach((product, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.id = `suggest-row-${i}`;
        row.className = 'topbar__search-suggest-row';
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        row.dataset.suggestRow = 'product';

        const thumb = document.createElement('img');
        thumb.className = 'topbar__search-suggest-thumb';
        thumb.src = resolveProductImage(product);
        thumb.alt = '';
        thumb.loading = 'lazy';

        const textWrap = document.createElement('span');
        textWrap.className = 'topbar__search-suggest-text';
        const title = document.createElement('span');
        title.className = 'topbar__search-suggest-title';
        title.textContent = lang === 'bn' ? product.title_bn || product.title_en : product.title_en || product.title_bn;
        const meta = document.createElement('span');
        meta.className = 'topbar__search-suggest-meta';
        const cat = lang === 'bn' ? product.category_bn || product.category : product.category;
        const price = product.price != null ? formatCurrency(product.price, { lang }) : '';
        meta.textContent = [cat, price].filter(Boolean).join(' · ');
        textWrap.append(title, meta);

        row.append(thumb, textWrap);
        // mousedown, not click: fire before the input's blur so the dropdown is still open.
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          activate(items.findIndex((it) => it.type === 'product' && it.product === product));
        });
        panel.append(row);
        items.push({ type: 'product', product });
      });
    }

    // The "see all results" row is always the last item in `items`.
    const allIndex = items.length;
    const allRow = document.createElement('button');
    allRow.type = 'button';
    allRow.id = `suggest-row-${allIndex}`;
    allRow.className = 'topbar__search-suggest-all';
    allRow.setAttribute('role', 'option');
    allRow.setAttribute('aria-selected', 'false');
    allRow.dataset.suggestRow = 'all';
    const totalHint = total > suggestions.length ? ` (${total})` : '';
    allRow.textContent = t('marketplace.search_suggest.view_all', { query: term }) + totalHint;
    allRow.addEventListener('mousedown', (e) => {
      e.preventDefault();
      activate(allIndex);
    });
    panel.append(allRow);
    items.push({ type: 'all', term });

    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  async function runQuery() {
    const term = input.value.trim();
    lastTerm = term;
    if (term.length < MIN_CHARS) {
      close();
      return;
    }
    const seq = ++reqSeq;
    try {
      const { suggestions, total } = await searchSuggest(term, { limit: 6 });
      // Stale response, the form was torn down, or the user cleared the box meanwhile.
      if (seq !== reqSeq || !form.isConnected) return;
      if (input.value.trim() !== term) return;
      render(term, suggestions, total);
    } catch {
      if (seq === reqSeq) close();
    }
  }

  function onInput() {
    clearTimer();
    timer = setTimeout(runQuery, DEBOUNCE_MS);
  }

  function onFocusIn() {
    if (items.length > 0 && input.value.trim().length >= MIN_CHARS) {
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
  }

  function onFocusOut(e) {
    if (!form.contains(e.relatedTarget)) close();
  }

  function onKeydown(e) {
    if (panel.hidden || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(activeIndex + 1 >= items.length ? 0 : activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeIndex - 1 < 0 ? items.length - 1 : activeIndex - 1);
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        e.preventDefault();
        activate(activeIndex);
      }
      // else: let the form submit handler take it to the results page
    } else if (e.key === 'Escape') {
      if (!panel.hidden) {
        e.stopPropagation();
        close();
      }
    }
  }

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.addEventListener('input', onInput);
  input.addEventListener('focusin', onFocusIn);
  form.addEventListener('focusout', onFocusOut);
  input.addEventListener('keydown', onKeydown);

  function destroy() {
    clearTimer();
    reqSeq++;
    input.removeEventListener('input', onInput);
    input.removeEventListener('focusin', onFocusIn);
    form.removeEventListener('focusout', onFocusOut);
    input.removeEventListener('keydown', onKeydown);
    panel.remove();
  }

  return { destroy };
}
