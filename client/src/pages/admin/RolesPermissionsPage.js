/**
 * RolesPermissionsPage.js — Roles × Permissions Baseline Matrix Page (Prompt 3.3).
 *
 * Implements:
 * 1. Domain-grouped Roles × Permissions baseline matrix inspector (read-only — see PermissionMatrix).
 * 2. Filters that combine: domain chips (built from the domains actually in the data), risk tier
 *    and free-text search across label, key and plain-language description.
 * 3. Visual Risk Tier categorization (LOW, MEDIUM, HIGH, CRITICAL) with a legend.
 * 4. Immutable CRITICAL-tier locks on every role but Super Admin.
 * 5. Layout-mirroring skeleton, a real error state with retry (a failed load used to render an
 *    empty matrix that looked like "nobody holds anything"), and full bilingual i18n.
 */

import { PermissionMatrix } from '../../components/admin/PermissionMatrix.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { ICONS } from '../../components/ui/icons.js';
import { api, pickMessage } from '../../core/api.js';
import { can } from '../../services/permissions.js';
import { t } from '../../services/i18n.js';
import {
  RISK_TIERS,
  buildHeldIndex,
  countHeldByRole,
  filterPermissions,
  listDomains,
  sortRoles,
} from '../../services/permissionMatrix.js';
import '../../styles/components/admin-users.css';
import '../../styles/components/admin-access.css';

const DOMAIN_ICON = {
  admin: 'dashboard',
  users: 'users',
  staff: 'id_card',
  security: 'security',
  system: 'pulse',
  platform: 'platform',
  catalog: 'catalog',
  moderation: 'enforcement',
  orders: 'orders',
  logistics: 'truck',
  finance: 'finance',
  growth: 'growth',
  content: 'content',
  chat: 'mail',
  live: 'video',
  support: 'help_circle',
  saler: 'my_store',
  supplier: 'warehouse',
  ai: 'sparkles',
};

const CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

const domainIcons = Object.fromEntries(
  Object.entries(DOMAIN_ICON).map(([domain, name]) => [domain, ICONS[name] ?? ''])
);

export default function RolesPermissionsPage(root) {
  const container = document.createElement('div');
  container.className = 'page admin-users-page admin-access';

  let roles = [];
  let permissions = [];
  let held = new Map();
  let roleTotals = new Map();
  let domains = [];
  let selectedDomain = 'ALL';
  let selectedRisk = 'ALL';
  let query = '';
  // 'loading' | 'error' | 'ready' — one field, so the page can never be "loading" and "failed" at once.
  let status = 'loading';
  let errorMessage = '';
  let requestSeq = 0;

  // Header --------------------------------------------------------------------------------------
  const header = document.createElement('div');
  header.className = 'admin-users-page__header';

  const headerText = document.createElement('div');
  const eyebrow = document.createElement('div');
  eyebrow.className = 'admin-users-page__eyebrow';
  eyebrow.textContent = `${t('perm_matrix.eyebrow', 'RBAC Security Matrix')}`;
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = t('perm_matrix.title', 'Roles & Permission Matrix');
  const subtitle = document.createElement('p');
  subtitle.className = 'text-secondary';
  subtitle.textContent = t('perm_matrix.subtitle', 'Domain-grouped roles × permissions grid defining baseline capabilities and approval tiers.');
  headerText.append(eyebrow, title, subtitle);

  const headerActions = document.createElement('div');
  headerActions.className = 'admin-users-page__header-actions';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'btn btn--secondary btn--sm';
  refreshBtn.innerHTML = `${ICONS.refresh}<span>${t('common.refresh', 'Refresh')}</span>`;
  refreshBtn.addEventListener('click', load);
  headerActions.append(refreshBtn);

  header.append(headerText, headerActions);

  // Read-only notice: says why there are no checkboxes and where to go instead ------------------
  const note = document.createElement('div');
  note.className = 'perm-note';
  const noteIcon = document.createElement('span');
  noteIcon.className = 'perm-note__icon';
  noteIcon.setAttribute('aria-hidden', 'true');
  noteIcon.innerHTML = ICONS.lock;
  const noteText = document.createElement('p');
  noteText.className = 'perm-note__text';
  const noteStrong = document.createElement('strong');
  noteStrong.textContent = `${t('perm_matrix.readonly_title', 'Read-only baseline.')} `;
  noteText.append(noteStrong, t('perm_matrix.readonly_body', 'Role defaults are seeded from the permission catalog and cannot be edited here. To give one person extra access for a limited time, issue a standing access grant.'));
  note.append(noteIcon, noteText);
  if (can('users.permission.grant')) {
    const grantsLink = document.createElement('a');
    grantsLink.className = 'btn btn--secondary btn--sm';
    grantsLink.href = '/admin/grants';
    grantsLink.innerHTML = `<span>${t('perm_matrix.btn_grants', 'Access Grants')}</span>${ICONS.arrow_right}`;
    note.append(grantsLink);
  }

  // Panel: toolbar + matrix + footer ------------------------------------------------------------
  const panel = document.createElement('section');
  panel.className = 'admin-users-panel perm-layout';

  const toolbar = document.createElement('div');
  toolbar.className = 'admin-users-toolbar perm-toolbar';

  const searchControl = document.createElement('label');
  searchControl.className = 'admin-users-search-control';
  const searchIcon = document.createElement('span');
  searchIcon.className = 'admin-users-search-icon';
  searchIcon.setAttribute('aria-hidden', 'true');
  searchIcon.innerHTML = ICONS.search;
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'admin-users-search-input';
  searchInput.placeholder = t('perm_matrix.search_placeholder', 'Search permissions by name, key or description…');
  searchInput.setAttribute('aria-label', t('perm_matrix.search_aria', 'Search permissions'));
  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    update();
  });
  searchControl.append(searchIcon, searchInput);

  const riskControl = document.createElement('label');
  riskControl.className = 'admin-users-select-control';
  const riskSelect = document.createElement('select');
  riskSelect.setAttribute('aria-label', t('perm_matrix.risk_filter_aria', 'Filter by risk tier'));
  for (const tier of ['ALL', ...RISK_TIERS]) {
    const opt = document.createElement('option');
    opt.value = tier;
    opt.textContent = tier === 'ALL'
      ? t('perm_matrix.risk_all', 'All risk tiers')
      : t(`perm_matrix.risk_${tier.toLowerCase()}`, tier);
    riskSelect.append(opt);
  }
  riskSelect.addEventListener('change', () => {
    selectedRisk = riskSelect.value;
    update();
  });
  const riskChevron = document.createElement('span');
  riskChevron.className = 'admin-users-select-chevron';
  riskChevron.setAttribute('aria-hidden', 'true');
  riskChevron.innerHTML = CHEVRON;
  riskControl.append(riskSelect, riskChevron);

  const chipRow = document.createElement('div');
  chipRow.className = 'perm-rail';
  chipRow.setAttribute('role', 'group');
  chipRow.setAttribute('aria-label', t('perm_matrix.domain_filter_aria', 'Filter by domain'));

  const legend = document.createElement('ul');
  legend.className = 'perm-legend';
  legend.setAttribute('aria-label', t('perm_matrix.legend_title', 'Risk tiers'));
  const LEGEND = [['LOW', 'success'], ['MEDIUM', 'info'], ['HIGH', 'warning'], ['CRITICAL', 'danger']];
  for (const [tier, variant] of LEGEND) {
    const li = document.createElement('li');
    li.className = 'perm-legend__item';
    const badge = document.createElement('span');
    badge.className = `badge badge--${variant}`;
    badge.textContent = tier;
    const hint = document.createElement('span');
    hint.textContent = t(`perm_matrix.risk_${tier.toLowerCase()}_hint`, tier);
    li.append(badge, hint);
    legend.append(li);
  }

  toolbar.append(searchControl, riskControl);

  const matrixWrap = document.createElement('div');
  matrixWrap.className = 'perm-matrix';

  const footer = document.createElement('div');
  footer.className = 'admin-users-panel__footer';
  const footerCount = document.createElement('span');
  footerCount.setAttribute('role', 'status');
  footerCount.setAttribute('aria-live', 'polite');
  footer.append(footerCount, legend);

  const main = document.createElement('div');
  main.className = 'perm-main';
  main.append(toolbar, matrixWrap, footer);
  panel.append(chipRow, main);
  container.append(header, note, panel);

  // Rendering -----------------------------------------------------------------------------------
  function renderChips() {
    chipRow.replaceChildren();
    // Counts follow the risk + search filters, so a chip never promises rows the table won't show.
    const scoped = filterPermissions(permissions, { risk: selectedRisk, query });
    const perDomain = new Map();
    for (const p of scoped) perDomain.set(p.domain || 'system', (perDomain.get(p.domain || 'system') ?? 0) + 1);

    const chips = [
      { key: 'ALL', label: t('perm_matrix.domain_all', 'All domains'), count: scoped.length, icon: ICONS.layers },
      ...domains.map((d) => ({
        key: d.key,
        label: t(`perm_matrix.domain_${d.key}`, d.key),
        count: perDomain.get(d.key) ?? 0,
        icon: domainIcons[d.key] ?? '',
      })),
    ];

    for (const chip of chips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'perm-rail__item';
      btn.setAttribute('aria-pressed', String(chip.key === selectedDomain));
      if (chip.count === 0 && chip.key !== 'ALL') btn.classList.add('perm-rail__item--empty');
      const ic = document.createElement('span');
      ic.className = 'perm-rail__icon';
      ic.setAttribute('aria-hidden', 'true');
      ic.innerHTML = chip.icon;
      const label = document.createElement('span');
      label.className = 'perm-rail__label';
      label.textContent = chip.label;
      // Long domain names truncate in the rail; the full name stays reachable.
      btn.title = chip.label;
      const count = document.createElement('span');
      count.className = 'perm-rail__count';
      count.textContent = String(chip.count);
      btn.append(ic, label, count);
      btn.addEventListener('click', () => {
        selectedDomain = chip.key;
        update();
      });
      chipRow.append(btn);
    }
  }

  function skeleton() {
    const wrap = document.createElement('div');
    wrap.className = 'perm-skel-wrap';
    wrap.setAttribute('aria-busy', 'true');
    wrap.setAttribute('aria-label', t('common.loading', 'Loading…'));
    for (let i = 0; i < 7; i += 1) {
      const row = document.createElement('div');
      row.className = 'perm-skel-row';
      row.innerHTML = '<span class="perm-skel perm-skel--wide"></span>' + '<span class="perm-skel"></span>'.repeat(5);
      wrap.append(row);
    }
    return wrap;
  }

  function renderMatrix() {
    matrixWrap.replaceChildren();

    if (status === 'loading') {
      matrixWrap.append(skeleton());
      footerCount.textContent = '';
      return;
    }

    if (status === 'error') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn--primary btn--sm';
      retry.textContent = t('perm_matrix.retry', 'Try again');
      retry.addEventListener('click', load);
      matrixWrap.append(EmptyState({
        variant: 'error',
        title: t('perm_matrix.error_title', 'Could not load the permission matrix'),
        description: errorMessage || t('perm_matrix.error_body', 'The permissions service did not respond. Your data is unchanged.'),
        action: retry,
      }));
      footerCount.textContent = '';
      return;
    }

    const visible = filterPermissions(permissions, { domain: selectedDomain, risk: selectedRisk, query });
    footerCount.textContent = t('perm_matrix.showing', { shown: visible.length, total: permissions.length });

    if (visible.length === 0) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'btn btn--secondary btn--sm';
      clear.textContent = t('perm_matrix.clear_filters', 'Clear filters');
      clear.addEventListener('click', () => {
        selectedDomain = 'ALL';
        selectedRisk = 'ALL';
        query = '';
        searchInput.value = '';
        riskSelect.value = 'ALL';
        update();
      });
      matrixWrap.append(EmptyState({
        title: t('perm_matrix.empty_title', 'No permissions match'),
        description: t('perm_matrix.empty_body', 'Try a different domain, risk tier or search term.'),
        action: clear,
      }));
      return;
    }

    matrixWrap.append(PermissionMatrix({ roles, permissions: visible, held, roleTotals, domainIcons }));
  }

  function update() {
    renderChips();
    renderMatrix();
  }

  async function load() {
    // A slow first response must not overwrite a newer one after a fast retry.
    const seq = ++requestSeq;
    status = 'loading';
    refreshBtn.disabled = true;
    update();

    try {
      const res = await api.get('/admin/roles-permissions');
      if (seq !== requestSeq) return;
      const body = res?.data && !res.roles ? res.data : res;
      roles = sortRoles(body?.roles ?? []);
      permissions = body?.permissions ?? [];
      held = buildHeldIndex(body?.rolePermissions ?? []);
      roleTotals = countHeldByRole(roles, permissions, held);
      domains = listDomains(permissions);
      // A domain that vanished between loads must not leave the page filtered to nothing.
      if (selectedDomain !== 'ALL' && !domains.some((d) => d.key === selectedDomain)) selectedDomain = 'ALL';
      status = 'ready';
    } catch (err) {
      if (seq !== requestSeq) return;
      errorMessage = err && typeof err === 'object' ? pickMessage(err) ?? '' : '';
      status = 'error';
    } finally {
      if (seq === requestSeq) {
        refreshBtn.disabled = false;
        update();
      }
    }
  }

  update();
  load();
  root.append(container);

  return () => {
    requestSeq += 1;
  };
}
