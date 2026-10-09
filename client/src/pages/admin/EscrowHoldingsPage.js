/**
 * EscrowHoldingsPage.js — the money held in escrow, one row per sub-order (/admin/finance/escrow).
 *
 * WHY rewritten (2026-10-09): the page read `holdings` from a response that only carried
 * `escrow_entries`, found nothing and showed four made-up orders. Its sweep and "Release now"
 * buttons changed those rows in the browser only. Now:
 *
 *   GET  /admin/finance/escrow                      real rows, summary over ALL held escrow, paged
 *   POST /admin/finance/escrow/sweep                releases every row past its return window
 *   POST /admin/finance/escrow/:subOrderId/release  one row now, before its window ends (needs a reason)
 *
 * Both writes are `finance.escrow.release_manual` (CRITICAL, super admin only); anyone else sees the
 * page without the buttons. A COD row cannot be released until its courier cash is reconciled, and
 * the row says so instead of offering a button the server would refuse.
 */

import { confirmDialog, confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { Pagination } from '../../components/ui/Pagination.js';
import { FinanceSubnav } from '../../components/admin/FinanceSubnav.js';
import { api } from '../../core/api.js';
import { can } from '../../services/permissions.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency, formatDate, formatNumber } from '../../services/format.js';
import { escapeHtml } from '../../services/html.js';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.js';

const STATUS_TABS = ['LOCKED', 'FROZEN', 'RELEASED', 'ALL'];
const SEARCH_DEBOUNCE_MS = 300;
const MIN_REASON_LENGTH = 10;

export default function EscrowHoldingsPage(root, { navigate } = {}) {
  loadSystemHealthStyles();
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page escrow-page';

  const canRelease = can('finance.escrow.release_manual');

  let data = null;
  let loadError = null;
  let isLoading = true;
  let status = 'LOCKED';
  let searchQuery = '';
  let page = 1;
  let searchTimer = null;

  async function loadData() {
    isLoading = true;
    render();
    try {
      const params = new URLSearchParams({ status, page: String(page) });
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      const res = await api.get(`/admin/finance/escrow?${params}`);
      data = res?.data ?? res;
      loadError = null;
    } catch (err) {
      loadError = err?.message || t('common.error_generic');
    } finally {
      isLoading = false;
      render();
    }
  }

  function remainingText(seconds) {
    const hours = Math.ceil(seconds / 3600);
    if (hours >= 48) return t('admin.escrow_page.days_left', { count: Math.ceil(hours / 24) });
    return t('admin.escrow_page.hours_left', { count: hours });
  }

  async function runSweep() {
    const s = data?.summary;
    const ok = await confirmDialog({
      title: t('admin.escrow_page.sweep_confirm_title'),
      description: t('admin.escrow_page.sweep_confirm_body', {
        count: s?.mature_count ?? 0,
        amount: formatCurrency(s?.mature_amount ?? 0),
      }),
      confirmLabel: t('admin.escrow_page.sweep'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      const res = await api.post('/admin/finance/escrow/sweep');
      const r = res?.data ?? res ?? {};
      toast.success(t('admin.escrow_page.sweep_done', { released: r.successCount ?? 0, failed: r.errorCount ?? 0 }));
      if (r.errorCount > 0) toast.error(t('admin.escrow_page.sweep_some_failed'));
    } catch (err) {
      toast.error(err?.message || t('common.error_generic'));
    }
    await loadData();
  }

  async function releaseOne(h) {
    const { confirmed, reason } = await confirmDialogWithReason({
      title: t('admin.escrow_page.release_title', { ref: h.sub_order_ref }),
      description: t('admin.escrow_page.release_body', { amount: formatCurrency(h.amount) }),
      confirmLabel: t('admin.escrow_page.release_now'),
      cancelLabel: t('common.cancel'),
      variant: 'danger',
      reasonRequired: true,
      reasonMinLength: MIN_REASON_LENGTH,
      reasonLabel: t('admin.escrow_page.reason'),
      reasonHint: t('admin.escrow_page.reason_hint', { min: MIN_REASON_LENGTH }),
    });
    if (!confirmed) return;
    try {
      const res = await api.post(`/admin/finance/escrow/${h.sub_order_id}/release`, { reason });
      toast.success((isBn ? res?.message_bn : res?.message_en) || t('admin.escrow_page.released'));
    } catch (err) {
      toast.error(err?.message || t('common.error_generic'));
    }
    await loadData();
  }

  function kpis() {
    const s = data.summary;
    const grid = document.createElement('div');
    grid.className = 'admin-kpi-grid';
    grid.innerHTML = `
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(t('admin.escrow_page.kpi_held'))}</div>
        <div class="admin-kpi-card__val font-mono">${escapeHtml(formatCurrency(s.total_held))}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(t('admin.escrow_page.kpi_held_hint', { count: s.held_count }))}</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(t('admin.escrow_page.kpi_mature'))}</div>
        <div class="admin-kpi-card__val font-mono">${escapeHtml(formatCurrency(s.mature_amount))}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(t('admin.escrow_page.kpi_mature_hint', { count: s.mature_count }))}</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(t('admin.escrow_page.kpi_window'))}</div>
        <div class="admin-kpi-card__val font-mono">${escapeHtml(formatNumber(s.active_count))}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(t('admin.escrow_page.kpi_window_hint', { days: s.return_window_days }))}</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${escapeHtml(t('admin.escrow_page.kpi_frozen'))}</div>
        <div class="admin-kpi-card__val font-mono">${escapeHtml(formatCurrency(s.frozen_amount))}</div>
        <div class="admin-kpi-card__hint">${escapeHtml(t('admin.escrow_page.kpi_frozen_hint', { count: s.frozen_count }))}</div>
      </div>`;
    return grid;
  }

  function toolbar() {
    const bar = document.createElement('div');
    bar.className = 'admin-toolbar';

    const tabs = document.createElement('div');
    tabs.className = 'admin-toolbar__filters';
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', t('admin.escrow_page.filter_label'));
    for (const key of STATUS_TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn btn--sm ${key === status ? 'btn--primary' : 'btn--secondary'}`;
      b.textContent = t(`admin.escrow_page.tab_${key.toLowerCase()}`);
      b.setAttribute('aria-pressed', String(key === status));
      b.addEventListener('click', () => {
        if (status === key) return;
        status = key;
        page = 1;
        loadData();
      });
      tabs.append(b);
    }

    const search = document.createElement('div');
    search.className = 'admin-toolbar__search';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'input';
    input.id = 'escrow-search-input';
    input.placeholder = t('admin.escrow_page.search');
    input.setAttribute('aria-label', t('admin.escrow_page.search'));
    input.value = searchQuery;
    input.addEventListener('input', () => {
      searchQuery = input.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        page = 1;
        loadData().then(() => {
          const again = root.querySelector('#escrow-search-input');
          if (again) {
            again.focus();
            again.setSelectionRange(again.value.length, again.value.length);
          }
        });
      }, SEARCH_DEBOUNCE_MS);
    });
    search.append(input);

    bar.append(tabs, search);
    return bar;
  }

  function statusCell(h) {
    if (h.status === 'RELEASED') {
      return `<span class="system-table__badge system-table__badge--success">${escapeHtml(t('admin.escrow_page.status_released'))}</span>
        <div class="text-xs text-muted">${h.released_at ? escapeHtml(formatDate(h.released_at)) : ''}</div>`;
    }
    if (h.status === 'FROZEN') {
      return `<span class="system-table__badge system-table__badge--danger">${escapeHtml(t('admin.escrow_page.status_frozen'))}</span>`;
    }
    if (h.status !== 'LOCKED') {
      return `<span class="system-table__badge">${escapeHtml(h.status)}</span>`;
    }
    if (h.release_blocked_reason === 'COD_NOT_RECONCILED') {
      return `<span class="system-table__badge system-table__badge--warn">${escapeHtml(t('admin.escrow_page.status_cod_wait'))}</span>
        <div class="text-xs text-muted">${escapeHtml(t('admin.escrow_page.cod_wait_hint'))}</div>`;
    }
    if (h.is_due) {
      return `<span class="system-table__badge system-table__badge--success">${escapeHtml(t('admin.escrow_page.status_due'))}</span>`;
    }
    return `<span class="system-table__badge system-table__badge--warn">${escapeHtml(t('admin.escrow_page.status_held'))}</span>
      <div class="text-xs text-muted font-mono">${escapeHtml(remainingText(h.remaining_seconds))}</div>`;
  }

  function table() {
    const panel = document.createElement('div');
    panel.className = 'admin-panel';
    const rows = data.holdings;

    if (rows.length === 0) {
      panel.innerHTML = `<p class="p-8 text-center text-sm text-muted">${escapeHtml(
        searchQuery.trim() ? t('admin.escrow_page.empty_search') : t('admin.escrow_page.empty')
      )}</p>`;
      return panel;
    }

    const showActions = canRelease && rows.some((h) => h.status === 'LOCKED');
    panel.innerHTML = `
      <div class="system-table-wrap">
        <table class="system-table">
          <thead><tr>
            <th>${escapeHtml(t('admin.escrow_page.col_order'))}</th>
            <th>${escapeHtml(t('admin.escrow_page.col_customer'))}</th>
            <th>${escapeHtml(t('admin.escrow_page.col_parties'))}</th>
            <th>${escapeHtml(t('admin.escrow_page.col_amount'))}</th>
            <th>${escapeHtml(t('admin.escrow_page.col_status'))}</th>
            ${showActions ? `<th style="text-align:right">${escapeHtml(t('admin.escrow_page.col_action'))}</th>` : ''}
          </tr></thead>
          <tbody>
            ${rows.map((h) => `
              <tr>
                <td>
                  <code class="font-mono font-bold">${escapeHtml(h.sub_order_ref)}</code>
                  <div class="text-xs text-muted">${escapeHtml(t(`admin.escrow_page.pay_${String(h.payment_method || 'other').toLowerCase()}`))}</div>
                </td>
                <td>
                  <div class="font-semibold">${escapeHtml(h.customer_name || '—')}</div>
                  <div class="text-xs text-muted">${h.delivered_at
                    ? escapeHtml(t('admin.escrow_page.delivered_on', { date: formatDate(h.delivered_at) }))
                    : escapeHtml(t('admin.escrow_page.not_delivered'))}</div>
                </td>
                <td>
                  <div class="text-xs">${escapeHtml(t('admin.escrow_page.supplier'))}: <strong>${escapeHtml(h.supplier_name || '—')}</strong> · <span class="font-mono">${escapeHtml(formatCurrency(h.supplier_amount))}</span></div>
                  ${Number(h.saler_amount) > 0 ? `<div class="text-xs">${escapeHtml(t('admin.escrow_page.saler'))}: <strong>${escapeHtml(h.saler_name || '—')}</strong> · <span class="font-mono">${escapeHtml(formatCurrency(h.saler_amount))}</span></div>` : ''}
                  <div class="text-xs text-muted">${escapeHtml(t('admin.escrow_page.platform'))}: <span class="font-mono">${escapeHtml(formatCurrency(h.platform_amount))}</span></div>
                </td>
                <td><div class="font-mono font-bold">${escapeHtml(formatCurrency(h.amount))}</div></td>
                <td>${statusCell(h)}</td>
                ${showActions ? `<td style="text-align:right">${h.status === 'LOCKED' && !h.release_blocked_reason
                  ? `<button type="button" class="btn btn--secondary btn--sm release-single-btn" data-id="${escapeHtml(String(h.sub_order_id))}">${escapeHtml(t('admin.escrow_page.release_now'))}</button>`
                  : ''}</td>` : ''}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    panel.querySelectorAll('.release-single-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const h = rows.find((x) => String(x.sub_order_id) === btn.dataset.id);
        if (h) releaseOne(h);
      });
    });

    const p = data.pagination;
    if (p && p.pages > 1) {
      panel.append(Pagination({
        page: p.page,
        totalPages: p.pages,
        totalItems: p.total,
        pageSize: p.limit,
        labels: {
          prev: t('admin.escrow_page.prev'),
          next: t('admin.escrow_page.next'),
        },
        onChange: (next) => {
          page = next;
          loadData();
        },
      }));
    }
    return panel;
  }

  function render() {
    root.innerHTML = '';
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'admin-page-header';
    header.innerHTML = `
      <div>
        <h1 class="admin-page-title">${escapeHtml(t('admin.escrow_page.title'))}</h1>
        <p class="admin-page-subtitle">${escapeHtml(t('admin.escrow_page.subtitle'))}</p>
      </div>
      <div class="admin-page-actions"></div>`;

    const actions = header.querySelector('.admin-page-actions');
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'btn btn--secondary btn--sm';
    refresh.textContent = t('admin.escrow_page.refresh');
    refresh.addEventListener('click', () => loadData());
    actions.append(refresh);

    if (canRelease) {
      const sweep = document.createElement('button');
      sweep.type = 'button';
      sweep.className = 'btn btn--primary btn--sm';
      sweep.textContent = t('admin.escrow_page.sweep');
      sweep.disabled = !data || !(data.summary?.mature_count > 0);
      sweep.addEventListener('click', runSweep);
      actions.append(sweep);
    }

    container.append(header, FinanceSubnav({ activeKey: 'escrow', navigate }));

    if (isLoading && !data) {
      const loading = document.createElement('div');
      loading.className = 'p-8 text-center text-muted';
      loading.textContent = t('common.loading');
      container.append(loading);
    } else if (loadError && !data) {
      const error = document.createElement('div');
      error.className = 'admin-panel p-6 text-center text-sm';
      error.textContent = loadError;
      container.append(error);
    } else if (data) {
      container.append(kpis(), toolbar(), table());
    }

    root.appendChild(container);
  }

  loadData();
}
