/**
 * CommandPalette — Ctrl/Cmd+K, ia-sitemap.md §3. "Mandatory": with ~115 nav items across 6 roles,
 * tree navigation alone is not discoverable.
 *
 * Scope note: routes only (fuzzy search over navigation.js, permission/module filtered, recent
 * items via localStorage). §3's "quick actions" (Create product, Toggle a module, …) and entity
 * search (order ID, SKU) need real handlers/data that don't exist before Phase 2–4 — a palette
 * entry that does nothing when pressed is worse than not having it, so both are left for the
 * prompt that gives them something real to call. Route search is the part ACCEPTANCE actually
 * tests (open/navigate/keyboard/close) and the part genuinely usable today.
 *
 * Built directly on <dialog> + showModal() (like Modal/Drawer) rather than wrapping Modal(): the
 * layout (search input pinned to the top, a scrolling result list, no footer) doesn't fit Modal's
 * title/body/footer shape.
 */
import { navItems } from '../../config/navigation.js';
import { t } from '../../services/i18n.js';
import { lockScroll, unlockScroll } from '../ui/Modal.js';

const RECENT_KEY = 'explooro:palette:recent';
const MAX_RECENT = 5;
const MAX_RESULTS = 8;

function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) ?? [];
  } catch {
    return [];
  }
}

function pushRecent(path) {
  const next = [path, ...loadRecent().filter((p) => p !== path)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Recency is a convenience — losing it in private browsing is not worth failing over.
  }
}

function hasModule(modules, key) {
  return !key || key === 'core' || modules[key] === true;
}
function hasPermission(permissions, key) {
  return !key || permissions.includes(key);
}

/**
 * Subsequence fuzzy match: every query character must appear, in order, in the target. Returns
 * the matched span's length (smaller = tighter = better) or `null` for no match. No dependency —
 * this is the entire matching algorithm, deliberately simple over "smart".
 */
function fuzzyScore(query, target) {
  const q = query.toLowerCase();
  const s = target.toLowerCase();
  let qi = 0;
  let first = -1;
  let last = -1;
  for (let si = 0; si < s.length && qi < q.length; si++) {
    if (s[si] === q[qi]) {
      if (first === -1) first = si;
      last = si;
      qi += 1;
    }
  }
  if (qi < q.length) return null;
  return q.length === 0 ? 0 : last - first;
}

export function createCommandPalette({ getState }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'overlay command-palette';
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', t('palette.placeholder'));

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'command-palette__input';
  input.placeholder = t('palette.placeholder');
  input.setAttribute('aria-label', t('palette.placeholder'));
  input.autocomplete = 'off';

  const resultsEl = document.createElement('div');
  resultsEl.className = 'command-palette__results';
  resultsEl.setAttribute('role', 'listbox');

  const hint = document.createElement('div');
  hint.className = 'command-palette__hint';
  hint.textContent = t('palette.hint');

  dialog.append(input, resultsEl, hint);

  let flat = [];
  let activeIndex = 0;
  let previouslyFocused = null;

  function computeGroups(query) {
    const { ctx } = getState();
    const q = query.trim();

    const visible = navItems.filter((item) => hasModule(ctx.modules, item.module) && hasPermission(ctx.permissions, item.permission));

    if (!q) {
      const recent = loadRecent()
        .map((path) => visible.find((i) => i.path === path))
        .filter(Boolean)
        .map((item) => ({ item, label: t(item.label_i18n_key) }));
      return recent.length ? [{ labelKey: 'palette.group_recent', entries: recent }] : [];
    }

    const scored = [];
    for (const item of visible) {
      const label = t(item.label_i18n_key);
      const score = fuzzyScore(q, label) ?? fuzzyScore(q, item.path);
      if (score !== null) scored.push({ item, label, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return [{ labelKey: 'palette.group_routes', entries: scored.slice(0, MAX_RESULTS) }];
  }

  function render(query) {
    const groups = computeGroups(query);
    resultsEl.replaceChildren();
    flat = [];
    activeIndex = 0;

    if (query.trim() && groups.every((g) => g.entries.length === 0)) {
      const empty = document.createElement('div');
      empty.className = 'command-palette__empty';
      empty.textContent = t('palette.no_results', { query: query.trim() });
      resultsEl.append(empty);
      return;
    }

    for (const group of groups) {
      if (group.entries.length === 0) continue;
      const heading = document.createElement('div');
      heading.className = 'command-palette__group-label';
      heading.textContent = t(group.labelKey);
      resultsEl.append(heading);

      for (const entry of group.entries) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'command-palette__result';
        row.setAttribute('role', 'option');
        row.textContent = entry.label;
        const pathHint = document.createElement('span');
        pathHint.className = 'command-palette__result-path';
        pathHint.textContent = entry.item.path;
        row.append(pathHint);
        row.addEventListener('click', () => choose(entry.item));
        resultsEl.append(row);
        flat.push(row);
      }
    }
    highlight();
  }

  function highlight() {
    flat.forEach((row, i) => row.classList.toggle('command-palette__result--active', i === activeIndex));
    flat[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function choose(item) {
    pushRecent(item.path);
    close();
    getState().navigate(item.path);
  }

  function onKeydown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (flat.length) activeIndex = (activeIndex + 1) % flat.length;
      highlight();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length) activeIndex = (activeIndex - 1 + flat.length) % flat.length;
      highlight();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = flat[activeIndex];
      if (target) target.click();
    } else if (event.key === 'Escape') {
      close();
    }
  }

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', onKeydown);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  function open() {
    if (dialog.open) return;
    previouslyFocused = document.activeElement;
    if (!dialog.isConnected) document.body.append(dialog);
    input.value = '';
    dialog.showModal();
    lockScroll();
    render('');
    input.focus();
  }

  function close() {
    if (!dialog.open) return;
    dialog.close();
  }

  dialog.addEventListener('close', () => {
    unlockScroll();
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
  });

  return { dialog, open, close };
}
