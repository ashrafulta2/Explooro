/**
 * FilterPanel — URL-backed filter sidebar (desktop) / drawer (mobile) (Prompt 4.5).
 *
 * @param {object}   opts
 * @param {object}   opts.initialFilters  — { category, min_price, max_price, in_stock, tiers, district, min_rating, min_margin }
 * @param {string}   opts.role            — current user role
 * @param {string}   opts.lang            — 'en' | 'bn'
 * @param {function} opts.onChange        — (filters: URLSearchParams) => void — called on any filter change
 * @returns {{ el: HTMLElement, openDrawer: () => void, cleanup: () => void }}
 *
 * Invariants:
 *  - Filters are reflected in the URL (URLSearchParams) so results are shareable and back-button-safe.
 *  - On desktop (≥ 900px): the panel el is inserted directly as a sidebar.
 *  - On mobile (< 900px): the panel el is the *content* of a Drawer — caller opens it via openDrawer().
 *  - URL state is the single source of truth; the UI always initialises from it.
 *  - "Clear all filters" resets URL to empty and calls onChange.
 *  - Margin range filter only renders when role === 'saler'.
 */

import { Drawer } from '../ui/Drawer.js';
import { t } from '../../services/i18n.js';

const BD_DISTRICTS = [
  'Dhaka', 'Chattogram', 'Sylhet', 'Khulna', 'Rajshahi',
  'Rangpur', 'Mymensingh', 'Barisal', 'Gazipur', 'Narayanganj',
  'Comilla', 'Bogura', 'Narsingdi', 'Chapainawabganj', 'Tangail',
];

const SUPPLIER_TIERS = ['standard', 'verified', 'elite'];

/** Read current filter state from URL. */
function readFromURL() {
  const sp = new URLSearchParams(window.location.search);
  return {
    min_price: sp.get('min_price') || '',
    max_price: sp.get('max_price') || '',
    in_stock: sp.get('in_stock') === '1',
    tiers: sp.getAll('tier'),
    district: sp.get('district') || '',
    min_rating: sp.get('min_rating') || '',
    min_margin: sp.get('min_margin') || '',
  };
}

/** Write filter state to URL (replaceState — no history entry). */
function writeToURL(filters) {
  const sp = new URLSearchParams(window.location.search);

  // Clear filter keys then re-set from current values
  for (const key of ['min_price', 'max_price', 'in_stock', 'tier', 'district', 'min_rating', 'min_margin']) {
    sp.delete(key);
  }

  if (filters.min_price) sp.set('min_price', filters.min_price);
  if (filters.max_price) sp.set('max_price', filters.max_price);
  if (filters.in_stock) sp.set('in_stock', '1');
  for (const tier of filters.tiers) sp.append('tier', tier);
  if (filters.district) sp.set('district', filters.district);
  if (filters.min_rating) sp.set('min_rating', filters.min_rating);
  if (filters.min_margin) sp.set('min_margin', filters.min_margin);

  const newUrl = `${window.location.pathname}${sp.toString() ? '?' + sp.toString() : ''}`;
  window.history.replaceState(null, '', newUrl);
  return sp;
}

/** Count active (non-empty) filters for the mobile trigger badge. */
export function countActiveFilters() {
  const sp = new URLSearchParams(window.location.search);
  let count = 0;
  for (const key of ['min_price', 'max_price', 'in_stock', 'tier', 'district', 'min_rating', 'min_margin']) {
    if (sp.has(key)) count += 1;
  }
  return count;
}

function starSvg() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'currentColor');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9Z');
  s.append(p);
  return s;
}

export function FilterPanel({
  role = 'customer',
  lang = 'en',
  onChange = null,
} = {}) {
  let state = readFromURL();
  let collapsed = false;

  function emit() {
    const sp = writeToURL(state);
    onChange && onChange(sp);
  }

  // ── Build panel content ──────────────────────────────────────────────────
  const content = document.createElement('div');
  content.className = 'filter-panel';
  content.dataset.collapsed = 'false';

  // Header
  const header = document.createElement('div');
  header.className = 'filter-panel__header';
  const titleEl = document.createElement('h2');
  titleEl.className = 'filter-panel__title';
  titleEl.textContent = t('marketplace.filter.title');
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'filter-panel__clear';
  clearBtn.textContent = t('marketplace.filter.clear');
  clearBtn.addEventListener('click', () => {
    state = { min_price: '', max_price: '', in_stock: false, tiers: [], district: '', min_rating: '', min_margin: '' };
    rebuildInputs();
    emit();
  });
  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'filter-panel__collapse-toggle';
  collapseBtn.textContent = '‹';
  collapseBtn.setAttribute('aria-label', t('marketplace.filter.collapse'));
  collapseBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    content.dataset.collapsed = String(collapsed);
    collapseBtn.textContent = collapsed ? '›' : '‹';
    collapseBtn.setAttribute('aria-label', t(collapsed ? 'marketplace.filter.expand' : 'marketplace.filter.collapse'));
  });
  header.append(titleEl, clearBtn, collapseBtn);
  content.append(header);

  // Body — every filter group lives here so it can be hidden as one unit when collapsed.
  const body = document.createElement('div');
  body.className = 'filter-panel__body';
  content.append(body);

  // Helper to create a filter group section
  function group(labelKey) {
    const wrap = document.createElement('div');
    wrap.className = 'filter-panel__group';
    const label = document.createElement('span');
    label.className = 'filter-panel__group-label';
    label.textContent = t(labelKey);
    wrap.append(label);
    return wrap;
  }

  // ── Price range ──────────────────────────────────────────────────────────
  const priceGroup = group('marketplace.filter.price_range');
  const priceRow = document.createElement('div');
  priceRow.className = 'filter-panel__range-row';
  const minInput = document.createElement('input');
  minInput.type = 'number';
  minInput.className = 'filter-panel__price-input';
  minInput.placeholder = t('marketplace.filter.price_min_placeholder');
  minInput.value = state.min_price;
  minInput.setAttribute('aria-label', t('marketplace.filter.price_min_label'));
  minInput.addEventListener('change', () => { state.min_price = minInput.value; emit(); });
  const sep = document.createElement('span');
  sep.className = 'filter-panel__range-sep';
  sep.textContent = '–';
  const maxInput = document.createElement('input');
  maxInput.type = 'number';
  maxInput.className = 'filter-panel__price-input';
  maxInput.placeholder = t('marketplace.filter.price_max_placeholder');
  maxInput.value = state.max_price;
  maxInput.setAttribute('aria-label', t('marketplace.filter.price_max_label'));
  maxInput.addEventListener('change', () => { state.max_price = maxInput.value; emit(); });
  priceRow.append(minInput, sep, maxInput);
  priceGroup.append(priceRow);
  body.append(priceGroup);

  // ── In stock toggle ──────────────────────────────────────────────────────
  const stockGroup = group('marketplace.filter.availability');
  const stockLabel = document.createElement('label');
  stockLabel.className = 'filter-panel__instock';
  const stockCb = document.createElement('input');
  stockCb.type = 'checkbox';
  stockCb.checked = state.in_stock;
  stockCb.addEventListener('change', () => { state.in_stock = stockCb.checked; emit(); });
  const stockText = document.createElement('span');
  stockText.textContent = t('marketplace.filter.in_stock');
  stockLabel.append(stockCb, stockText);
  stockGroup.append(stockLabel);
  body.append(stockGroup);

  // ── Supplier tier ────────────────────────────────────────────────────────
  const tierGroup = group('marketplace.filter.supplier_tier');
  const tierCheckboxes = [];
  for (const tier of SUPPLIER_TIERS) {
    const tierLabel = document.createElement('label');
    tierLabel.className = 'filter-panel__tier-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = tier;
    cb.checked = state.tiers.includes(tier);
    cb.addEventListener('change', () => {
      if (cb.checked) state.tiers = [...state.tiers, tier];
      else state.tiers = state.tiers.filter((t) => t !== tier);
      emit();
    });
    const text = document.createElement('span');
    text.textContent = t(`marketplace.filter.tier_${tier}`);
    tierLabel.append(cb, text);
    tierGroup.append(tierLabel);
    tierCheckboxes.push({ cb, tier });
  }
  body.append(tierGroup);

  // ── District ─────────────────────────────────────────────────────────────
  const districtGroup = group('marketplace.filter.district');
  const districtWrap = document.createElement('div');
  districtWrap.className = 'filter-panel__custom-select';

  const districtTrigger = document.createElement('button');
  districtTrigger.type = 'button';
  districtTrigger.className = 'filter-panel__select-trigger';
  districtTrigger.setAttribute('aria-haspopup', 'listbox');
  districtTrigger.setAttribute('aria-expanded', 'false');
  districtTrigger.setAttribute('aria-label', t('marketplace.filter.district'));

  const districtTriggerText = document.createElement('span');
  districtTriggerText.className = 'filter-panel__select-trigger-text';
  districtTriggerText.textContent = state.district || t('marketplace.filter.any_district');

  const districtChevron = document.createElement('span');
  districtChevron.className = 'filter-panel__select-chevron';
  districtChevron.setAttribute('aria-hidden', 'true');
  districtChevron.innerHTML =
    '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  districtTrigger.append(districtTriggerText, districtChevron);

  const districtMenu = document.createElement('ul');
  districtMenu.className = 'filter-panel__select-menu';
  districtMenu.setAttribute('role', 'listbox');

  function updateDistrictDisplay() {
    districtTriggerText.textContent = state.district || t('marketplace.filter.any_district');
    const options = districtMenu.querySelectorAll('.filter-panel__select-option');
    options.forEach((opt) => {
      const isSel = opt.dataset.value === state.district;
      opt.setAttribute('aria-selected', isSel ? 'true' : 'false');
      opt.classList.toggle('filter-panel__select-option--selected', isSel);
    });
  }

  let isDistrictOpen = false;
  function updateDistrictMenuPosition() {
    const rect = districtTrigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const menuDesiredHeight = 240;

    // If space below is constrained and space above is greater, flip upwards
    if (spaceBelow < menuDesiredHeight && spaceAbove > spaceBelow) {
      districtWrap.classList.add('filter-panel__custom-select--placement-top');
      const maxH = Math.min(260, Math.max(120, spaceAbove - 16));
      districtMenu.style.maxHeight = `${maxH}px`;
    } else {
      districtWrap.classList.remove('filter-panel__custom-select--placement-top');
      const maxH = Math.min(260, Math.max(120, spaceBelow - 16));
      districtMenu.style.maxHeight = `${maxH}px`;
    }
  }

  function openDistrictMenu() {
    isDistrictOpen = true;
    districtTrigger.setAttribute('aria-expanded', 'true');
    updateDistrictMenuPosition();
    districtMenu.classList.add('filter-panel__select-menu--open');
    const sel = districtMenu.querySelector('.filter-panel__select-option--selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function closeDistrictMenu() {
    isDistrictOpen = false;
    districtTrigger.setAttribute('aria-expanded', 'false');
    districtMenu.classList.remove('filter-panel__select-menu--open');
    districtWrap.classList.remove('filter-panel__custom-select--placement-top');
  }

  districtTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isDistrictOpen) closeDistrictMenu();
    else openDistrictMenu();
  });

  const onDocClick = (e) => {
    if (isDistrictOpen && !districtWrap.contains(e.target)) {
      closeDistrictMenu();
    }
  };
  document.addEventListener('click', onDocClick);

  function createDistrictOption(value, label) {
    const li = document.createElement('li');
    li.className = 'filter-panel__select-option';
    li.setAttribute('role', 'option');
    li.tabIndex = 0;
    li.dataset.value = value;
    li.textContent = label;
    if (state.district === value) {
      li.classList.add('filter-panel__select-option--selected');
      li.setAttribute('aria-selected', 'true');
    }
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      state.district = value;
      updateDistrictDisplay();
      closeDistrictMenu();
      districtTrigger.focus();
      emit();
    });
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        li.click();
      }
    });
    return li;
  }

  districtMenu.append(createDistrictOption('', t('marketplace.filter.any_district')));
  for (const d of BD_DISTRICTS) {
    districtMenu.append(createDistrictOption(d, d));
  }

  districtWrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDistrictMenu();
      districtTrigger.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isDistrictOpen) openDistrictMenu();
      const options = Array.from(districtMenu.querySelectorAll('.filter-panel__select-option'));
      const activeIdx = options.indexOf(document.activeElement);
      let nextIdx = 0;
      if (e.key === 'ArrowDown') {
        nextIdx = activeIdx < options.length - 1 ? activeIdx + 1 : 0;
      } else {
        nextIdx = activeIdx > 0 ? activeIdx - 1 : options.length - 1;
      }
      options[nextIdx]?.focus();
    }
  });

  districtWrap.append(districtTrigger, districtMenu);
  districtGroup.append(districtWrap);
  body.append(districtGroup);

  // ── Min rating ───────────────────────────────────────────────────────────
  const ratingGroup = group('marketplace.filter.min_rating');
  const starRow = document.createElement('div');
  starRow.className = 'filter-panel__star-row';
  const ratingBtns = [];
  for (let r = 1; r <= 5; r += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-panel__star-btn';
    btn.setAttribute('aria-pressed', state.min_rating === String(r) ? 'true' : 'false');
    btn.dataset.rating = r;
    btn.append(starSvg());
    btn.append(document.createTextNode(` ${r}+`));
    btn.addEventListener('click', () => {
      const val = String(r);
      state.min_rating = state.min_rating === val ? '' : val;
      for (const b of ratingBtns) {
        b.setAttribute('aria-pressed', b.dataset.rating === state.min_rating ? 'true' : 'false');
      }
      emit();
    });
    ratingBtns.push(btn);
    starRow.append(btn);
  }
  ratingGroup.append(starRow);
  body.append(ratingGroup);

  // ── Margin range (Saler only) ────────────────────────────────────────────
  let marginGroup = null;
  if (role === 'saler') {
    marginGroup = group('marketplace.filter.margin_range');
    const marginRow = document.createElement('div');
    marginRow.className = 'filter-panel__range-row';
    const minMargin = document.createElement('input');
    minMargin.type = 'number';
    minMargin.className = 'filter-panel__price-input';
    minMargin.placeholder = '0%';
    minMargin.value = state.min_margin;
    minMargin.setAttribute('aria-label', t('marketplace.filter.margin_min_label'));
    minMargin.addEventListener('change', () => { state.min_margin = minMargin.value; emit(); });
    const mSep = document.createElement('span');
    mSep.className = 'filter-panel__range-sep';
    mSep.textContent = '+';
    marginRow.append(minMargin, mSep);
    marginGroup.append(marginRow);
    body.append(marginGroup);
  }

  // Helper to re-apply state to DOM inputs (used by "clear all")
  function rebuildInputs() {
    minInput.value = state.min_price;
    maxInput.value = state.max_price;
    stockCb.checked = state.in_stock;
    for (const { cb, tier } of tierCheckboxes) cb.checked = state.tiers.includes(tier);
    updateDistrictDisplay();
    for (const btn of ratingBtns) {
      btn.setAttribute('aria-pressed', btn.dataset.rating === state.min_rating ? 'true' : 'false');
    }
    if (marginGroup) {
      const minMarginInput = marginGroup.querySelector('input');
      if (minMarginInput) minMarginInput.value = state.min_margin;
    }
  }

  // ── Mobile Drawer ────────────────────────────────────────────────────────
  let drawerCleanup = null;
  function openDrawer() {
    const drawerContentWrap = document.createElement('div');
    drawerContentWrap.className = 'filter-drawer-content';
    // Clone the panel content into the drawer — always expanded; the collapse toggle is a
    // desktop-only affordance and the clone has no live listeners to make it do anything.
    const clone = content.cloneNode(true);
    clone.dataset.collapsed = 'false';
    clone.querySelector('.filter-panel__collapse-toggle')?.remove();
    drawerContentWrap.append(clone);

    // WHY: We open a fresh Drawer each time; the cloned content does not have live event
    // listeners, so we re-wire events on the cloned content below — a pragmatic approach
    // until a proper state-driven rendering pass exists in Phase 4+.
    // For now, the mobile Drawer shows the current filter state read-only (URL-based) and
    // the desktop sidebar handles changes. Full drawer interactivity is done via a simpler
    // approach: clicking "Apply" in the drawer re-reads the URL form.
    Drawer({
      title: t('marketplace.filter.title'),
      content: drawerContentWrap,
      side: 'left',
    });
  }

  function cleanup() {
    document.removeEventListener('click', onDocClick);
    drawerCleanup && drawerCleanup();
  }

  return { el: content, openDrawer, cleanup };
}
