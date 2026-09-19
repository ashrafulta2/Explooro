/**
 * CodReconciliationPage.js — Courier COD Settlement Ingestion, 3-Way Reconciliation & Aging Dashboard (Prompt 6.4).
 *
 * Implements:
 * 1. Executive Page Header & 4-Card KPI Summary Grid
 * 2. Courier Settlement Aging Matrix with right-aligned tabular numerals
 * 3. Settlement report upload (Drag & Drop CSV file picker + Monospaced CSV paste editor)
 * 4. Unified Form Controls (Select with SVG chevron, Input with affixes, zero-margin grid alignment)
 * 5. 6-Tier discrepancy classification & queue management with live search, courier, status, and variance filtering
 * 6. Accessible Discrepancy Resolution Modal with quick templates & maker-checker governance
 * 7. One-click UTF-8 BOM CSV discrepancy report export
 * 8. Surgical DOM reconciliation for focus preservation and responsive interaction
 */

import { api } from '../../core/api.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';
import { Modal } from '../../components/ui/Modal.js';
import '../../styles/components/cod-recon.css';

const SAMPLE_CSV = `consignment_id,sub_order_ref,courier_reported,deposit_received
CN-8801,SUB-89201-1,3250.00,3250.00
CN-8802,SUB-89205-1,4500.00,4200.00
CN-8803,SUB-89210-1,1800.00,0.00
CN-8804,,1150.00,1150.00`;

// WHY: exported cells carry courier-supplied text (consignment ids, notes). A cell that starts with
// = + - @ is executed as a formula when the file is opened in Excel/Sheets, so it is prefixed with
// an apostrophe; embedded quotes are doubled so a value can never break out of its column. A plain
// number is exempt: a short collection's variance is legitimately "-100.00" and must stay numeric.
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (!PLAIN_NUMBER.test(text) && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const SVG_CHEVRON = `<span class="cod-recon-control__chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>`;
const SVG_SEARCH = `<span class="cod-recon-toolbar__search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg></span>`;
const SVG_CLOUD_UPLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path><path d="M12 12v9"></path><path d="m16 16-4-4-4 4"></path></svg>`;

export default function CodReconciliationPage(root, { navigate } = {}) {
  const container = document.createElement('div');
  container.className = 'page cod-recon-page';

  let reconciliations = [];
  let agingData = null;
  let statusFilter = '';
  let courierFilter = '';
  let searchQuery = '';
  let onlyVariance = false;
  let isInitialLoading = true;
  let isQueueLoading = false;
  let isUploading = false;
  let searchTimeout = null;
  let queueRequestId = 0;

  let activeUploadTab = 'paste'; // 'paste' | 'file'
  let uploadCourier = 'STEADFAST';
  let batchRef = '';
  let tolerance = '0.00';
  let csvText = '';
  let loadedFileName = '';
  let loadedRowCount = 0;

  function getStatusBadge(status) {
    switch (status) {
      case 'MATCHED':
        return `<span class="badge badge--success">${t('cod.status.matched')}</span>`;
      case 'SHORT_COLLECTION':
        return `<span class="badge badge--danger">${t('cod.status.short_collection')}</span>`;
      case 'OVER_COLLECTION':
        return `<span class="badge badge--warning">${t('cod.status.over_collection')}</span>`;
      case 'MISSING_DEPOSIT':
        return `<span class="badge badge--danger">${t('cod.status.missing_deposit')}</span>`;
      case 'DUPLICATE':
        return `<span class="badge badge--warning">${t('cod.status.duplicate')}</span>`;
      case 'UNMATCHED_CONSIGNMENT':
        return `<span class="badge badge--muted">${t('cod.status.unmatched_consignment')}</span>`;
      case 'TIMING_DIFFERENCE':
        return `<span class="badge badge--info">${t('cod.status.timing_difference')}</span>`;
      case 'RESOLVED':
        return `<span class="badge badge--purple">${t('cod.status.resolved')}</span>`;
      default:
        return `<span class="badge badge--neutral">${escapeHtml(status)}</span>`;
    }
  }

  function handleExportCsv(list) {
    if (!list || list.length === 0) {
      toast.info(t('cod.no_filter_match'));
      return;
    }

    const headers = [
      'Consignment ID',
      'Sub-Order Ref',
      'Sub-Order ID',
      'Courier',
      'Expected Amount',
      'Courier Reported',
      'Bank Deposit',
      'Variance',
      'Status',
      'Batch Ref',
      'Resolution Reason',
    ];

    const rows = list.map((r) => [
      r.consignment_id,
      r.sub_order_ref,
      r.sub_order_id,
      r.courier,
      r.expected_amount || 0,
      r.courier_reported || 0,
      r.deposit_received || 0,
      r.variance || 0,
      r.status,
      r.settlement_batch_ref,
      r.resolution_reason,
    ].map(csvCell).join(','));

    // WHY a Blob and not a data: URI: encodeURI leaves '#' unescaped, so a note such as "ref #123"
    // ended the URI there and the download was silently truncated.
    const blob = new Blob(['\uFEFF' + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `explooro-cod-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(t('cod.export_success', { count: list.length }));
  }

  function openResolutionModal(item, triggerBtn) {
    const content = document.createElement('div');
    content.className = 'cod-recon-modal-body';

    const varianceNum = parseFloat(item.variance || 0);

    content.innerHTML = `
      <div class="cod-recon-summary-card">
        <div class="cod-recon-summary-item">
          <span class="cod-recon-summary-item__label">${t('cod.col_consignment')}</span>
          <span class="cod-recon-summary-item__value font-mono">${escapeHtml(item.consignment_id) || '-'}</span>
        </div>
        <div class="cod-recon-summary-item">
          <span class="cod-recon-summary-item__label">${t('cod.col_sub_order')}</span>
          <span class="cod-recon-summary-item__value font-mono">${escapeHtml(item.sub_order_ref) || `Sub #${item.sub_order_id || '-'}`}</span>
        </div>
        <div class="cod-recon-summary-item">
          <span class="cod-recon-summary-item__label">${t('cod.col_courier')}</span>
          <span class="cod-recon-summary-item__value font-bold">${escapeHtml(item.courier)}</span>
        </div>
        <div class="cod-recon-summary-item">
          <span class="cod-recon-summary-item__label">${t('cod.col_expected')}</span>
          <span class="cod-recon-summary-item__value font-mono">${formatCurrency(item.expected_amount)}</span>
        </div>
        <div class="cod-recon-summary-item">
          <span class="cod-recon-summary-item__label">${t('cod.col_courier_reported')}</span>
          <span class="cod-recon-summary-item__value font-mono">${formatCurrency(item.courier_reported || 0)}</span>
        </div>
        <div class="cod-recon-summary-item">
          <span class="cod-recon-summary-item__label">${t('cod.col_deposit')}</span>
          <span class="cod-recon-summary-item__value font-mono">${formatCurrency(item.deposit_received || 0)}</span>
        </div>
        <div class="cod-recon-summary-item">
          <span class="cod-recon-summary-item__label">${t('cod.col_variance')}</span>
          <span class="cod-recon-summary-item__value font-mono ${varianceNum < 0 ? 'text-danger' : varianceNum > 0 ? 'text-warning' : 'text-success'}">
            ${varianceNum > 0 ? '+' : ''}${formatCurrency(varianceNum)}
          </span>
        </div>
        <div class="cod-recon-summary-item">
          <span class="cod-recon-summary-item__label">${t('cod.col_status')}</span>
          <span class="cod-recon-summary-item__value">${getStatusBadge(item.status)}</span>
        </div>
      </div>

      <div class="cod-recon-templates">
        <label class="field__label">${t('cod.quick_templates_label')}</label>
        <div class="cod-recon-templates__chips">
          <button type="button" class="cod-recon-template-chip cod-recon-template-chip--active" data-template="${escapeHtml(t('cod.reason_template_1'))}">
            📌 ${t('cod.reason_template_1')}
          </button>
          <button type="button" class="cod-recon-template-chip" data-template="${escapeHtml(t('cod.reason_template_2'))}">
            📌 ${t('cod.reason_template_2')}
          </button>
          <button type="button" class="cod-recon-template-chip" data-template="${escapeHtml(t('cod.reason_template_3'))}">
            📌 ${t('cod.reason_template_3')}
          </button>
          <button type="button" class="cod-recon-template-chip" data-template="${escapeHtml(t('cod.reason_template_4'))}">
            📌 ${t('cod.reason_template_4')}
          </button>
        </div>
      </div>

      <div class="field">
        <label for="cod-modal-reason-input" class="field__label">${t('cod.resolution_reason_label')}</label>
        <div class="field__control field__control--textarea">
          <textarea
            id="cod-modal-reason-input"
            class="textarea font-mono text-xs"
            rows="3"
            placeholder="${escapeHtml(t('cod.resolution_reason_placeholder'))}"
          >${escapeHtml(t('cod.reason_template_1'))}</textarea>
        </div>
      </div>

      <div class="cod-recon-notice">
        <span aria-hidden="true">⚠️</span>
        <span>${t('cod.maker_checker_notice')}</span>
      </div>
    `;

    const footer = document.createElement('div');
    footer.className = 'overlay__footer-actions';
    footer.innerHTML = `
      <button type="button" class="btn btn--secondary btn--sm cod-modal-cancel-btn">${t('cod.btn_cancel')}</button>
      <button type="button" class="btn btn--primary btn--sm cod-modal-submit-btn">${t('cod.btn_confirm_resolve')}</button>
    `;

    const modal = Modal({
      title: t('cod.modal_resolve_title'),
      description: t('cod.modal_resolve_desc'),
      content,
      footer,
      size: 'md',
      onClose: () => {
        if (modal.parentNode) modal.parentNode.removeChild(modal);
      },
    });

    const chips = content.querySelectorAll('.cod-recon-template-chip');
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => c.classList.remove('cod-recon-template-chip--active'));
        chip.classList.add('cod-recon-template-chip--active');
        const textarea = content.querySelector('#cod-modal-reason-input');
        if (textarea) {
          textarea.value = chip.dataset.template;
          textarea.focus();
        }
      });
    });

    footer.querySelector('.cod-modal-cancel-btn')?.addEventListener('click', () => {
      modal.closeModal();
    });

    const submitBtn = footer.querySelector('.cod-modal-submit-btn');
    submitBtn?.addEventListener('click', async () => {
      const textarea = content.querySelector('#cod-modal-reason-input');
      const reason = textarea ? textarea.value.trim() : '';

      if (!reason) {
        toast.error(t('cod.error_reason_required'));
        textarea?.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = t('common.processing');

      try {
        const res = await api.post(`/admin/finance/cod/${item.id}/resolve`, {
          resolution_reason: reason,
        });

        modal.closeModal();

        if (res.meta?.maker_checker?.requires_super_admin) {
          toast.info(t('cod.maker_checker_pending'));
        } else {
          toast.success(t('cod.resolve_success'));
        }
        await loadAllData();
      } catch (err) {
        toast.error(err.message || t('cod.error_resolve_failed'));
        submitBtn.disabled = false;
        submitBtn.textContent = t('cod.btn_confirm_resolve');
      }
    });

    modal.open(triggerBtn);
  }

  async function handleCsvUpload() {
    if (!csvText.trim()) {
      toast.error(t('cod.error_csv_required'));
      return;
    }

    isUploading = true;
    updateUploadSubmitState();

    try {
      const res = await api.post('/admin/finance/cod/upload', {
        courier: uploadCourier,
        batch_ref: batchRef.trim() || undefined,
        tolerance: parseFloat(tolerance) || 0.00,
        csv_content: csvText.trim(),
      });

      const { matchedCount = 0, shortCount = 0, missingDepositCount = 0, unmatchedCount = 0 } = res.data || {};
      toast.success(
        t('cod.upload_summary', {
          matched: matchedCount,
          short: shortCount,
          missing: missingDepositCount,
          unmatched: unmatchedCount,
        })
      );
      csvText = '';
      loadedFileName = '';
      loadedRowCount = 0;
      updateDropzoneFileInfo();
      const csvTextarea = container.querySelector('#cod-paste-csv');
      if (csvTextarea) csvTextarea.value = '';

      await loadAllData();
    } catch (err) {
      toast.error(err.message || t('cod.error_upload_failed'));
    } finally {
      isUploading = false;
      updateUploadSubmitState();
    }
  }

  function handleFileSelection(file) {
    if (!file) return;
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      toast.error(t('cod.error_invalid_csv'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || '');
      csvText = text;
      loadedFileName = file.name;
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      loadedRowCount = Math.max(0, lines.length - 1);
      toast.success(t('cod.dropzone_loaded', { filename: file.name, count: loadedRowCount }));
      updateDropzoneFileInfo();
    };
    reader.onerror = () => {
      toast.error(t('cod.error_read_file'));
    };
    reader.readAsText(file);
  }

  function fileInfoText() {
    return t('cod.dropzone_loaded', { filename: loadedFileName, count: loadedRowCount });
  }

  function updateDropzoneFileInfo() {
    const fileInfo = container.querySelector('#cod-dropzone-file-info');
    const fileText = container.querySelector('#cod-dropzone-file-text');
    if (fileInfo && fileText) {
      if (loadedFileName) {
        fileText.textContent = fileInfoText();
        fileInfo.style.display = 'inline-flex';
      } else {
        fileInfo.style.display = 'none';
      }
    }
  }

  function updateUploadSubmitState() {
    const btn = container.querySelector('.cod-recon-page__submit-csv-btn');
    if (btn) {
      btn.disabled = isUploading;
      btn.textContent = isUploading ? t('common.processing') : `⚡ ${t('cod.btn_reconcile_csv')}`;
    }
  }

  async function loadAllData() {
    isInitialLoading = true;
    updateRefreshButton();

    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (courierFilter) params.set('courier', courierFilter);
      if (onlyVariance) params.set('has_variance', 'true');
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      params.set('limit', '50');

      const [reconRes, agingRes] = await Promise.all([
        api.get(`/admin/finance/cod?${params.toString()}`).catch(() => ({ data: { reconciliations: [] } })),
        api.get('/admin/finance/cod/aging').catch(() => ({ data: null })),
      ]);

      reconciliations = reconRes.data?.reconciliations || [];
      agingData = agingRes.data || null;
    } catch (err) {
      toast.error(err.message || t('cod.error_load_failed'));
    } finally {
      isInitialLoading = false;
      render();
    }
  }

  async function loadQueueOnly() {
    isQueueLoading = true;
    renderQueueTable();
    // WHY: typing fires overlapping requests; only the newest may write the table, or a slow
    // response for "CN-88" would land after the one for "CN-8801" and show the wrong rows.
    const requestId = ++queueRequestId;

    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (courierFilter) params.set('courier', courierFilter);
      if (onlyVariance) params.set('has_variance', 'true');
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      params.set('limit', '50');

      const res = await api.get(`/admin/finance/cod?${params.toString()}`);
      if (requestId !== queueRequestId) return;
      reconciliations = res.data?.reconciliations || [];
    } catch (err) {
      if (requestId !== queueRequestId) return;
      toast.error(err.message || t('cod.error_load_failed'));
    } finally {
      if (requestId === queueRequestId) {
        isQueueLoading = false;
        renderQueueTable();
        updateKpis();
      }
    }
  }

  function updateRefreshButton() {
    const refreshBtn = container.querySelector('.cod-recon-page__refresh-btn');
    if (refreshBtn) {
      refreshBtn.disabled = isInitialLoading;
      refreshBtn.innerHTML = `${isInitialLoading ? '⏳' : '🔄'} ${t('common.refresh')}`;
    }
  }

  function updateKpis() {
    const totalUnreconciled = agingData ? agingData.totalUnreconciledPlatform : 0;
    const openDiscrepanciesCount = agingData?.totalUnreconciledRecords ?? reconciliations.filter((r) => r.status !== 'MATCHED' && r.status !== 'RESOLVED').length;
    const slaBreachedCount = agingData?.platformAlertCount ?? 0;
    const matchedCount = reconciliations.filter((r) => r.status === 'MATCHED' || r.status === 'RESOLVED').length;

    const elTotal = container.querySelector('#cod-kpi-total-val');
    if (elTotal) elTotal.textContent = formatCurrency(totalUnreconciled);

    const elOpen = container.querySelector('#cod-kpi-open-val');
    if (elOpen) elOpen.textContent = openDiscrepanciesCount;

    const elSla = container.querySelector('#cod-kpi-sla-val');
    if (elSla) elSla.textContent = slaBreachedCount;

    const elMatched = container.querySelector('#cod-kpi-matched-val');
    if (elMatched) elMatched.textContent = matchedCount;
  }

  function renderAgingTableHtml() {
    if (!agingData) return '';

    return `
      <div class="cod-recon-panel">
        <div class="cod-recon-panel__header">
          <div>
            <h2 class="cod-recon-panel__title">📊 ${t('cod.aging_title')}</h2>
            <p class="cod-recon-panel__subtitle">
              ${t('cod.total_unreconciled')}: <strong class="text-danger font-mono font-bold">${formatCurrency(agingData.totalUnreconciledPlatform)}</strong>
            </p>
          </div>
          <span class="badge ${agingData.platformAlertCount > 0 ? 'badge--danger' : 'badge--success'}">
            ${agingData.platformAlertCount > 0 ? `⚠️ ${t('cod.aging_alert')}` : `✓ ${t('cod.badge_normal')}`}
          </span>
        </div>

        <div class="table-responsive">
          <table class="table cod-recon-aging-table">
            <thead>
              <tr>
                <th>${t('cod.col_courier')}</th>
                <th class="text-right">${t('cod.col_unreconciled_total')}</th>
                <th class="text-right">&lt; 3 ${t('cod.days')}</th>
                <th class="text-right">3–7 ${t('cod.days')}</th>
                <th class="text-right">8–14 ${t('cod.days')}</th>
                <th class="text-right">15–30 ${t('cod.days')}</th>
                <th class="text-right">&gt; 30 ${t('cod.days')}</th>
                <th class="text-center">${t('cod.col_status')}</th>
              </tr>
            </thead>
            <tbody>
              ${agingData.couriers.length === 0 ? `
                <tr><td colspan="8" class="text-center text-muted">${t('cod.all_clean')}</td></tr>
              ` : agingData.couriers.map((c) => {
                const initial = (c.courier || 'C').slice(0, 1).toUpperCase();
                return `
                  <tr class="${courierFilter === c.courier ? 'table-row--highlight' : ''}" data-courier="${escapeHtml(c.courier)}">
                    <td>
                      <button type="button" class="cod-recon-courier-btn" data-courier="${escapeHtml(c.courier)}" title="${t('cod.filter_by_courier', { courier: c.courier })}">
                        <span class="cod-recon-courier-btn__tag">${initial}</span>
                        <span>${escapeHtml(c.courier)}</span>
                      </button>
                    </td>
                    <td class="text-right text-danger font-bold font-mono">${formatCurrency(c.totalUnreconciledFormatted)}</td>
                    <td class="text-right font-mono">${formatCurrency(c.buckets.under3Days.amountFormatted)} <span class="text-muted text-xs">(${c.buckets.under3Days.count})</span></td>
                    <td class="text-right font-mono">${formatCurrency(c.buckets.days3To7.amountFormatted)} <span class="text-muted text-xs">(${c.buckets.days3To7.count})</span></td>
                    <td class="text-right font-mono ${parseFloat(c.buckets.days8To14.amountFormatted) > 0 ? 'text-warning font-bold' : ''}">
                      ${formatCurrency(c.buckets.days8To14.amountFormatted)} <span class="text-muted text-xs">(${c.buckets.days8To14.count})</span>
                    </td>
                    <td class="text-right font-mono ${parseFloat(c.buckets.days15To30.amountFormatted) > 0 ? 'text-danger font-bold' : ''}">
                      ${formatCurrency(c.buckets.days15To30.amountFormatted)} <span class="text-muted text-xs">(${c.buckets.days15To30.count})</span>
                    </td>
                    <td class="text-right font-mono ${parseFloat(c.buckets.over30Days.amountFormatted) > 0 ? 'text-danger font-bold' : ''}">
                      ${formatCurrency(c.buckets.over30Days.amountFormatted)} <span class="text-muted text-xs">(${c.buckets.over30Days.count})</span>
                    </td>
                    <td class="text-center">
                      ${c.hasAlert ? `<span class="badge badge--danger">⚠️ ${t('cod.aging_alert')}</span>` : `<span class="badge badge--success">✓ ${t('cod.badge_normal')}</span>`}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderQueueContentHtml() {
    const hasActiveFilters = Boolean(statusFilter || courierFilter || searchQuery || onlyVariance);

    if (isQueueLoading) {
      return `
        <div class="cod-recon-page__loading">
          <div class="spinner"></div>
          <span>${t('common.loading')}</span>
        </div>
      `;
    }

    if (reconciliations.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state__icon">📦</div>
          <h3>${hasActiveFilters ? t('cod.no_filter_match') : t('cod.no_discrepancies')}</h3>
          <p class="text-secondary">${hasActiveFilters ? t('cod.no_filter_match_desc') : t('cod.no_discrepancies_desc')}</p>
          ${hasActiveFilters ? `
            <div style="margin-top: var(--space-3);">
              <button type="button" class="btn btn--secondary btn--sm cod-recon__empty-reset-btn">
                ✕ ${t('cod.filter_clear')}
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }

    return `
      <div class="table-responsive">
        <table class="table cod-recon-queue-table">
          <thead>
            <tr>
              <th>${t('cod.col_consignment')}</th>
              <th>${t('cod.col_sub_order')}</th>
              <th>${t('cod.col_courier')}</th>
              <th class="text-right">${t('cod.col_expected')}</th>
              <th class="text-right">${t('cod.col_courier_reported')}</th>
              <th class="text-right">${t('cod.col_deposit')}</th>
              <th class="text-right">${t('cod.col_variance')}</th>
              <th class="text-center">${t('cod.col_status')}</th>
              <th class="text-right">${t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${reconciliations.map((r) => {
              const isActionable = r.status !== 'MATCHED' && r.status !== 'RESOLVED';
              const varianceNum = parseFloat(r.variance || 0);

              return `
                <tr>
                  <td>
                    <span class="font-mono font-bold">${escapeHtml(r.consignment_id) || '-'}</span>
                    ${r.consignment_id ? `
                      <button type="button" class="cod-recon__copy-btn" data-copy="${escapeHtml(r.consignment_id)}" title="${t('cod.copy_consignment')}" aria-label="${t('cod.copy_consignment')}">
                        📋
                      </button>
                    ` : ''}
                  </td>
                  <td>
                    ${r.sub_order_ref ? `
                      <a href="/admin/orders?q=${encodeURIComponent(r.sub_order_ref)}" class="cod-recon__order-link" title="${t('cod.view_order')}">
                        <span>${escapeHtml(r.sub_order_ref)}</span>
                        <span class="text-xs" aria-hidden="true">↗</span>
                      </a>
                    ` : `
                      <span class="font-mono text-muted">Sub #${r.sub_order_id || '-'}</span>
                    `}
                  </td>
                  <td><span class="badge badge--neutral">${escapeHtml(r.courier)}</span></td>
                  <td class="text-right font-mono">${formatCurrency(r.expected_amount)}</td>
                  <td class="text-right font-mono">${formatCurrency(r.courier_reported || 0)}</td>
                  <td class="text-right font-mono font-bold">${formatCurrency(r.deposit_received || 0)}</td>
                  <td class="text-right font-mono font-bold ${varianceNum < 0 ? 'text-danger' : varianceNum > 0 ? 'text-warning' : 'text-success'}">
                    ${varianceNum > 0 ? '+' : ''}${formatCurrency(varianceNum)}
                  </td>
                  <td class="text-center">${getStatusBadge(r.status)}</td>
                  <td class="text-right">
                    ${isActionable ? `
                      <button type="button" class="btn btn--secondary btn--sm cod-recon-page__resolve-btn" data-id="${r.id}">
                        ⚖️ ${t('cod.btn_resolve')}
                      </button>
                    ` : `
                      <div class="text-xs text-secondary font-mono">
                        ${r.resolution_reason ? `✓ ${escapeHtml(r.resolution_reason)}` : escapeHtml(r.settlement_batch_ref || '-')}
                      </div>
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderQueueTable() {
    const queueMount = container.querySelector('#cod-queue-table-mount');
    if (queueMount) {
      queueMount.innerHTML = renderQueueContentHtml();
    }

    const countBadge = container.querySelector('#cod-queue-count');
    if (countBadge) {
      countBadge.textContent = reconciliations.length;
    }

    const exportBtn = container.querySelector('.cod-recon-page__export-btn');
    if (exportBtn) {
      exportBtn.disabled = reconciliations.length === 0;
    }

    const clearBtnWrap = container.querySelector('#cod-clear-filters-wrap');
    const hasActiveFilters = Boolean(statusFilter || courierFilter || searchQuery || onlyVariance);
    if (clearBtnWrap) {
      clearBtnWrap.innerHTML = hasActiveFilters ? `
        <button type="button" class="btn btn--secondary btn--sm cod-recon__clear-filters-btn">
          ✕ ${t('cod.filter_clear')}
        </button>
      ` : '';
      clearBtnWrap.querySelector('.cod-recon__clear-filters-btn')?.addEventListener('click', clearAllFilters);
    }

    queueMount?.querySelector('.cod-recon__empty-reset-btn')?.addEventListener('click', clearAllFilters);
  }

  function clearAllFilters() {
    searchQuery = '';
    statusFilter = '';
    courierFilter = '';
    onlyVariance = false;

    const searchInput = container.querySelector('#cod-search-input');
    if (searchInput) searchInput.value = '';

    const filterStatus = container.querySelector('#cod-filter-status');
    if (filterStatus) filterStatus.value = '';

    const filterCourier = container.querySelector('#cod-filter-courier');
    if (filterCourier) filterCourier.value = '';

    const filterVariance = container.querySelector('#cod-filter-variance');
    if (filterVariance) filterVariance.checked = false;

    container.querySelectorAll('.cod-recon-aging-table tr').forEach((tr) => {
      tr.classList.remove('table-row--highlight');
    });

    loadQueueOnly();
  }

  function render() {
    const totalUnreconciled = agingData ? agingData.totalUnreconciledPlatform : 0;
    const openDiscrepanciesCount = agingData?.totalUnreconciledRecords ?? reconciliations.filter((r) => r.status !== 'MATCHED' && r.status !== 'RESOLVED').length;
    const slaBreachedCount = agingData?.platformAlertCount ?? 0;
    const matchedCount = reconciliations.filter((r) => r.status === 'MATCHED' || r.status === 'RESOLVED').length;
    const hasActiveFilters = Boolean(statusFilter || courierFilter || searchQuery || onlyVariance);

    container.innerHTML = `
      <!-- Page Header -->
      <div class="cod-recon-page__header">
        <div>
          <div class="cod-recon-page__eyebrow">
            <span>🛡️ FINANCE &amp; SETTLEMENTS</span>
            <span>•</span>
            <span>3-WAY RECONCILIATION</span>
          </div>
          <h1 class="page-title">${t('cod.page_title')}</h1>
          <p class="text-secondary">${t('cod.page_subtitle')}</p>
        </div>
        <div class="cod-recon-page__header-actions">
          <button type="button" class="btn btn--secondary btn--sm cod-recon-page__export-btn" ${reconciliations.length === 0 ? 'disabled' : ''}>
            📥 ${t('cod.btn_export_csv')}
          </button>
          <button type="button" class="btn btn--secondary cod-recon-page__refresh-btn" ${isInitialLoading ? 'disabled' : ''} aria-label="${t('common.refresh')}">
            ${isInitialLoading ? '⏳' : '🔄'} ${t('common.refresh')}
          </button>
        </div>
      </div>

      <!-- 1. Executive KPI Summary Cards -->
      <div class="cod-recon-kpis">
        <div class="cod-recon-kpi-card">
          <div class="cod-recon-kpi-card__head">
            <span class="cod-recon-kpi-card__title">${t('cod.kpi_total_unreconciled')}</span>
            <span class="badge badge--danger" aria-hidden="true">৳ COD</span>
          </div>
          <div class="cod-recon-kpi-card__value cod-recon-kpi-card__value--danger" id="cod-kpi-total-val">
            ${formatCurrency(totalUnreconciled)}
          </div>
          <span class="cod-recon-kpi-card__hint">${t('cod.kpi_total_unreconciled_hint')}</span>
        </div>

        <div class="cod-recon-kpi-card">
          <div class="cod-recon-kpi-card__head">
            <span class="cod-recon-kpi-card__title">${t('cod.kpi_open_discrepancies')}</span>
            <span class="badge ${openDiscrepanciesCount > 0 ? 'badge--warning' : 'badge--success'}">
              ${openDiscrepanciesCount}
            </span>
          </div>
          <div class="cod-recon-kpi-card__value ${openDiscrepanciesCount > 0 ? 'cod-recon-kpi-card__value--warning' : ''}" id="cod-kpi-open-val">
            ${openDiscrepanciesCount}
          </div>
          <span class="cod-recon-kpi-card__hint">${t('cod.kpi_open_discrepancies_hint')}</span>
        </div>

        <div class="cod-recon-kpi-card">
          <div class="cod-recon-kpi-card__head">
            <span class="cod-recon-kpi-card__title">${t('cod.kpi_sla_breached')}</span>
            <span class="badge ${slaBreachedCount > 0 ? 'badge--danger' : 'badge--neutral'}">
              ${slaBreachedCount > 0 ? `⚠️ ${t('cod.badge_critical')}` : t('cod.badge_clean')}
            </span>
          </div>
          <div class="cod-recon-kpi-card__value ${slaBreachedCount > 0 ? 'cod-recon-kpi-card__value--danger' : ''}" id="cod-kpi-sla-val">
            ${slaBreachedCount}
          </div>
          <span class="cod-recon-kpi-card__hint">${t('cod.kpi_sla_breached_hint')}</span>
        </div>

        <div class="cod-recon-kpi-card">
          <div class="cod-recon-kpi-card__head">
            <span class="cod-recon-kpi-card__title">${t('cod.kpi_matched_clean')}</span>
            <span class="badge badge--success">✓ ${t('cod.badge_verified')}</span>
          </div>
          <div class="cod-recon-kpi-card__value cod-recon-kpi-card__value--success" id="cod-kpi-matched-val">
            ${matchedCount}
          </div>
          <span class="cod-recon-kpi-card__hint">${t('cod.kpi_matched_clean_hint')}</span>
        </div>
      </div>

      <!-- 2. Aging Report Matrix -->
      <div id="cod-aging-mount">
        ${renderAgingTableHtml()}
      </div>

      <!-- 3. Ingest Settlement CSV Section (Fixed Aligned Controls) -->
      <div class="cod-recon-panel">
        <div class="cod-recon-panel__header">
          <div>
            <h2 class="cod-recon-panel__title">📥 ${t('cod.upload_section_title')}</h2>
            <p class="cod-recon-panel__subtitle">${t('cod.upload_desc')}</p>
          </div>
          <div class="cod-recon-tabs" role="tablist">
            <button
              type="button"
              class="cod-recon-tab ${activeUploadTab === 'paste' ? 'cod-recon-tab--active' : ''}"
              data-tab="paste"
              role="tab"
              aria-selected="${activeUploadTab === 'paste'}"
            >
              📋 ${t('cod.tab_paste_csv')}
            </button>
            <button
              type="button"
              class="cod-recon-tab ${activeUploadTab === 'file' ? 'cod-recon-tab--active' : ''}"
              data-tab="file"
              role="tab"
              aria-selected="${activeUploadTab === 'file'}"
            >
              📁 ${t('cod.tab_upload_file')}
            </button>
          </div>
        </div>

        <!-- 3-Column Aligned Config Grid -->
        <div class="cod-recon-upload__config-grid">
          <div class="field">
            <label for="cod-upload-courier" class="field__label">${t('cod.select_courier')}</label>
            <div class="cod-recon-control">
              <select id="cod-upload-courier" class="select font-medium">
                <option value="STEADFAST" ${uploadCourier === 'STEADFAST' ? 'selected' : ''}>Steadfast Courier</option>
                <option value="PATHAO" ${uploadCourier === 'PATHAO' ? 'selected' : ''}>Pathao Courier</option>
                <option value="REDX" ${uploadCourier === 'REDX' ? 'selected' : ''}>RedX Delivery</option>
                <option value="PAPERFLY" ${uploadCourier === 'PAPERFLY' ? 'selected' : ''}>Paperfly</option>
                <option value="ECOURIER" ${uploadCourier === 'ECOURIER' ? 'selected' : ''}>eCourier</option>
              </select>
              ${SVG_CHEVRON}
            </div>
          </div>

          <div class="field">
            <label for="cod-upload-batch-ref" class="field__label">${t('cod.batch_ref_label')}</label>
            <div class="cod-recon-control">
              <input
                type="text"
                id="cod-upload-batch-ref"
                class="input font-mono"
                placeholder="${t('cod.batch_ref_placeholder')}"
                value="${escapeHtml(batchRef)}"
              />
            </div>
          </div>

          <div class="field">
            <label for="cod-upload-tolerance" class="field__label">${t('cod.tolerance_label')}</label>
            <div class="cod-recon-control">
              <input
                type="number"
                step="0.01"
                min="0"
                id="cod-upload-tolerance"
                class="input font-mono"
                placeholder="${t('cod.tolerance_placeholder')}"
                value="${escapeHtml(tolerance)}"
              />
              <span class="cod-recon-control__affix">৳</span>
            </div>
          </div>
        </div>

        <!-- Tab Content Body -->
        <div id="cod-upload-tab-content">
          ${activeUploadTab === 'paste' ? `
            <div class="cod-recon-csv-box">
              <div class="cod-recon-csv-box__label-row">
                <label for="cod-paste-csv" class="cod-recon-csv-box__label">${t('cod.paste_csv_label')}</label>
                <span class="cod-recon-csv-box__format-hint">consignment_id, sub_order_ref, courier_reported, deposit_received</span>
              </div>
              <div class="cod-recon-csv-textarea-wrap">
                <textarea
                  id="cod-paste-csv"
                  class="cod-recon-csv-textarea"
                  rows="4"
                  placeholder="consignment_id,sub_order_ref,courier_reported,deposit_received&#10;CN-8801,SUB-89201-1,3250.00,3250.00"
                ></textarea>
              </div>
            </div>
          ` : `
            <div class="cod-recon-dropzone" id="cod-dropzone" role="button" tabindex="0" aria-label="${t('cod.dropzone_hint')}">
              <input type="file" id="cod-file-input" accept=".csv,text/csv" hidden />
              <div class="cod-recon-dropzone__icon-wrap">
                ${SVG_CLOUD_UPLOAD}
              </div>
              <div class="cod-recon-dropzone__text">
                ${t('cod.dropzone_hint')}
                <span class="btn btn--secondary btn--sm" style="margin-top: 8px;">
                  ${t('cod.dropzone_browse')}
                </span>
              </div>
              <div class="cod-recon-dropzone__file-info" id="cod-dropzone-file-info" style="${loadedFileName ? '' : 'display:none;'}">
                <span>✓</span>
                <span id="cod-dropzone-file-text">${escapeHtml(fileInfoText())}</span>
              </div>
            </div>
          `}
        </div>

        <!-- Ingest Actions Footer -->
        <div class="cod-recon-upload__actions">
          <div class="cod-recon-upload__actions-left">
            <button type="button" class="btn btn--secondary btn--sm cod-recon__sample-btn">
              📋 ${t('cod.btn_load_sample')}
            </button>
            <button type="button" class="btn btn--ghost btn--sm cod-recon__clear-btn">
              ✕ ${t('cod.btn_clear')}
            </button>
          </div>
          <div class="cod-recon-upload__actions-right">
            <button
              type="button"
              class="btn btn--primary cod-recon-page__submit-csv-btn"
              ${isUploading ? 'disabled' : ''}
            >
              ${isUploading ? t('common.processing') : `⚡ ${t('cod.btn_reconcile_csv')}`}
            </button>
          </div>
        </div>
      </div>

      <!-- 4. Discrepancy Queue -->
      <div class="cod-recon-panel">
        <div class="cod-recon-panel__header">
          <div>
            <h2 class="cod-recon-panel__title">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path></svg>
              ${t('cod.queue_title')}
              <span class="badge badge--neutral font-mono" id="cod-queue-count">${reconciliations.length}</span>
            </h2>
            <p class="cod-recon-panel__subtitle">${t('cod.page_subtitle')}</p>
          </div>
        </div>

        <div class="cod-recon-toolbar">
          <!-- Search Control -->
          <div class="cod-recon-toolbar__search-control">
            ${SVG_SEARCH}
            <input
              type="text"
              id="cod-search-input"
              class="cod-recon-toolbar__search-input"
              placeholder="${t('cod.search_placeholder')}"
              value="${escapeHtml(searchQuery)}"
              aria-label="${t('cod.search_placeholder')}"
            />
          </div>

          <!-- Status Filter -->
          <div class="cod-recon-toolbar__select-control">
            <select id="cod-filter-status" class="select" aria-label="${t('common.all_statuses')}">
              <option value="" ${statusFilter === '' ? 'selected' : ''}>${t('common.all_statuses')}</option>
              <option value="SHORT_COLLECTION" ${statusFilter === 'SHORT_COLLECTION' ? 'selected' : ''}>${t('cod.status.short_collection')}</option>
              <option value="MISSING_DEPOSIT" ${statusFilter === 'MISSING_DEPOSIT' ? 'selected' : ''}>${t('cod.status.missing_deposit')}</option>
              <option value="OVER_COLLECTION" ${statusFilter === 'OVER_COLLECTION' ? 'selected' : ''}>${t('cod.status.over_collection')}</option>
              <option value="UNMATCHED_CONSIGNMENT" ${statusFilter === 'UNMATCHED_CONSIGNMENT' ? 'selected' : ''}>${t('cod.status.unmatched_consignment')}</option>
              <option value="MATCHED" ${statusFilter === 'MATCHED' ? 'selected' : ''}>${t('cod.status.matched')}</option>
              <option value="RESOLVED" ${statusFilter === 'RESOLVED' ? 'selected' : ''}>${t('cod.status.resolved')}</option>
            </select>
            ${SVG_CHEVRON}
          </div>

          <!-- Courier Filter -->
          <div class="cod-recon-toolbar__select-control">
            <select id="cod-filter-courier" class="select" aria-label="${t('common.all_couriers')}">
              <option value="" ${courierFilter === '' ? 'selected' : ''}>${t('common.all_couriers')}</option>
              <option value="STEADFAST" ${courierFilter === 'STEADFAST' ? 'selected' : ''}>Steadfast</option>
              <option value="PATHAO" ${courierFilter === 'PATHAO' ? 'selected' : ''}>Pathao</option>
              <option value="REDX" ${courierFilter === 'REDX' ? 'selected' : ''}>RedX</option>
              <option value="PAPERFLY" ${courierFilter === 'PAPERFLY' ? 'selected' : ''}>Paperfly</option>
              <option value="ECOURIER" ${courierFilter === 'ECOURIER' ? 'selected' : ''}>eCourier</option>
            </select>
            ${SVG_CHEVRON}
          </div>

          <!-- Variance Only Toggle -->
          <label class="cod-recon-toolbar__toggle">
            <input type="checkbox" id="cod-filter-variance" ${onlyVariance ? 'checked' : ''} />
            <span>${t('cod.filter_has_variance')}</span>
          </label>

          <!-- Reset Filters -->
          <span id="cod-clear-filters-wrap">
            ${hasActiveFilters ? `
              <button type="button" class="btn btn--secondary btn--sm cod-recon__clear-filters-btn">
                ✕ ${t('cod.filter_clear')}
              </button>
            ` : ''}
          </span>
        </div>

        <div id="cod-queue-table-mount">
          ${renderQueueContentHtml()}
        </div>
      </div>
    `;

    attachStaticEventListeners();
    wireTabContentListeners();
  }

  function wireTabContentListeners() {
    const csvTextarea = container.querySelector('#cod-paste-csv');
    if (csvTextarea) {
      csvTextarea.value = csvText;
      csvTextarea.addEventListener('input', (e) => {
        csvText = e.target.value;
      });
    }

    const dropzone = container.querySelector('#cod-dropzone');
    const fileInput = container.querySelector('#cod-file-input');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => {
        fileInput.click();
      });

      dropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInput.click();
        }
      });

      fileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) {
          handleFileSelection(file);
          fileInput.value = '';
        }
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('cod-recon-dropzone--active');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('cod-recon-dropzone--active');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('cod-recon-dropzone--active');
        const file = e.dataTransfer?.files?.[0];
        if (file) {
          handleFileSelection(file);
          fileInput.value = '';
        }
      });
    }
  }

  function attachStaticEventListeners() {
    container.querySelector('.cod-recon-page__refresh-btn')?.addEventListener('click', loadAllData);

    container.querySelector('.cod-recon-page__export-btn')?.addEventListener('click', () => {
      handleExportCsv(reconciliations);
    });

    container.querySelectorAll('.cod-recon-courier-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const courier = btn.dataset.courier;
        if (courier) {
          courierFilter = (courierFilter === courier) ? '' : courier;
          const select = container.querySelector('#cod-filter-courier');
          if (select) select.value = courierFilter;

          container.querySelectorAll('.cod-recon-aging-table tr').forEach((tr) => {
            tr.classList.toggle('table-row--highlight', tr.dataset.courier === courierFilter);
          });

          loadQueueOnly();
        }
      });
    });

    container.querySelectorAll('.cod-recon-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        if (targetTab && targetTab !== activeUploadTab) {
          activeUploadTab = targetTab;
          container.querySelectorAll('.cod-recon-tab').forEach((tEl) => {
            const isActive = tEl.dataset.tab === activeUploadTab;
            tEl.classList.toggle('cod-recon-tab--active', isActive);
            tEl.setAttribute('aria-selected', String(isActive));
          });

          const tabMount = container.querySelector('#cod-upload-tab-content');
          if (tabMount) {
            tabMount.innerHTML = activeUploadTab === 'paste' ? `
              <div class="cod-recon-csv-box">
                <div class="cod-recon-csv-box__label-row">
                  <label for="cod-paste-csv" class="cod-recon-csv-box__label">${t('cod.paste_csv_label')}</label>
                  <span class="cod-recon-csv-box__format-hint">consignment_id, sub_order_ref, courier_reported, deposit_received</span>
                </div>
                <div class="cod-recon-csv-textarea-wrap">
                  <textarea
                    id="cod-paste-csv"
                    class="cod-recon-csv-textarea"
                    rows="4"
                    placeholder="consignment_id,sub_order_ref,courier_reported,deposit_received&#10;CN-8801,SUB-89201-1,3250.00,3250.00"
                  ></textarea>
                </div>
              </div>
            ` : `
              <div class="cod-recon-dropzone" id="cod-dropzone" role="button" tabindex="0" aria-label="${t('cod.dropzone_hint')}">
                <input type="file" id="cod-file-input" accept=".csv,text/csv" hidden />
                <div class="cod-recon-dropzone__icon-wrap">
                  ${SVG_CLOUD_UPLOAD}
                </div>
                <div class="cod-recon-dropzone__text">
                  ${t('cod.dropzone_hint')}
                  <span class="btn btn--secondary btn--sm" style="margin-top: 8px;">
                    ${t('cod.dropzone_browse')}
                  </span>
                </div>
                <div class="cod-recon-dropzone__file-info" id="cod-dropzone-file-info" style="${loadedFileName ? '' : 'display:none;'}">
                  <span>✓</span>
                  <span id="cod-dropzone-file-text">${escapeHtml(fileInfoText())}</span>
                </div>
              </div>
            `;
            wireTabContentListeners();
          }
        }
      });
    });

    const courierSel = container.querySelector('#cod-upload-courier');
    courierSel?.addEventListener('change', (e) => {
      uploadCourier = e.target.value;
    });

    const batchInput = container.querySelector('#cod-upload-batch-ref');
    batchInput?.addEventListener('input', (e) => {
      batchRef = e.target.value;
    });

    const toleranceInput = container.querySelector('#cod-upload-tolerance');
    toleranceInput?.addEventListener('input', (e) => {
      tolerance = e.target.value;
    });

    container.querySelector('.cod-recon__sample-btn')?.addEventListener('click', () => {
      csvText = SAMPLE_CSV;
      batchRef = `BATCH-${uploadCourier}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
      tolerance = '0.00';
      loadedFileName = 'sample_settlement.csv';
      loadedRowCount = 4;
      activeUploadTab = 'paste';

      const batchIn = container.querySelector('#cod-upload-batch-ref');
      if (batchIn) batchIn.value = batchRef;
      const tolIn = container.querySelector('#cod-upload-tolerance');
      if (tolIn) tolIn.value = tolerance;

      container.querySelectorAll('.cod-recon-tab').forEach((tEl) => {
        const isActive = tEl.dataset.tab === 'paste';
        tEl.classList.toggle('cod-recon-tab--active', isActive);
        tEl.setAttribute('aria-selected', String(isActive));
      });

      const tabMount = container.querySelector('#cod-upload-tab-content');
      if (tabMount) {
        tabMount.innerHTML = `
          <div class="cod-recon-csv-box">
            <div class="cod-recon-csv-box__label-row">
              <label for="cod-paste-csv" class="cod-recon-csv-box__label">${t('cod.paste_csv_label')}</label>
              <span class="cod-recon-csv-box__format-hint">consignment_id, sub_order_ref, courier_reported, deposit_received</span>
            </div>
            <div class="cod-recon-csv-textarea-wrap">
              <textarea
                id="cod-paste-csv"
                class="cod-recon-csv-textarea"
                rows="4"
              ></textarea>
            </div>
          </div>
        `;
        wireTabContentListeners();
      }

      toast.success(t('cod.dropzone_loaded', { filename: 'sample_settlement.csv', count: 4 }));
    });

    container.querySelector('.cod-recon__clear-btn')?.addEventListener('click', () => {
      csvText = '';
      loadedFileName = '';
      loadedRowCount = 0;
      batchRef = '';
      tolerance = '0.00';

      const batchIn = container.querySelector('#cod-upload-batch-ref');
      if (batchIn) batchIn.value = '';
      const tolIn = container.querySelector('#cod-upload-tolerance');
      if (tolIn) tolIn.value = '0.00';
      const pasteIn = container.querySelector('#cod-paste-csv');
      if (pasteIn) pasteIn.value = '';
      updateDropzoneFileInfo();
    });

    container.querySelector('.cod-recon-page__submit-csv-btn')?.addEventListener('click', handleCsvUpload);

    const searchInput = container.querySelector('#cod-search-input');
    searchInput?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        loadQueueOnly();
      }, 250);
    });

    const filterStatus = container.querySelector('#cod-filter-status');
    filterStatus?.addEventListener('change', (e) => {
      statusFilter = e.target.value;
      loadQueueOnly();
    });

    const filterCourier = container.querySelector('#cod-filter-courier');
    filterCourier?.addEventListener('change', (e) => {
      courierFilter = e.target.value;
      container.querySelectorAll('.cod-recon-aging-table tr').forEach((tr) => {
        tr.classList.toggle('table-row--highlight', tr.dataset.courier === courierFilter);
      });
      loadQueueOnly();
    });

    const filterVariance = container.querySelector('#cod-filter-variance');
    filterVariance?.addEventListener('change', (e) => {
      onlyVariance = e.target.checked;
      loadQueueOnly();
    });

    container.querySelector('.cod-recon__clear-filters-btn')?.addEventListener('click', clearAllFilters);
    container.querySelector('.cod-recon__empty-reset-btn')?.addEventListener('click', clearAllFilters);

    const queueMount = container.querySelector('#cod-queue-table-mount');
    queueMount?.addEventListener('click', async (e) => {
      const copyBtn = e.target.closest('.cod-recon__copy-btn');
      if (copyBtn) {
        e.stopPropagation();
        const copyText = copyBtn.dataset.copy;
        if (copyText) {
          try {
            await navigator.clipboard.writeText(copyText);
            toast.success(t('cod.copied'));
          } catch {
            toast.info(copyText);
          }
        }
        return;
      }

      const resolveBtn = e.target.closest('.cod-recon-page__resolve-btn');
      if (resolveBtn) {
        const id = parseInt(resolveBtn.dataset.id, 10);
        const item = reconciliations.find((x) => x.id === id);
        if (item) openResolutionModal(item, resolveBtn);
        return;
      }

      const orderLink = e.target.closest('.cod-recon__order-link');
      if (orderLink && typeof navigate === 'function') {
        const href = orderLink.getAttribute('href');
        if (href && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
          e.preventDefault();
          navigate(href);
        }
      }
    });
  }

  loadAllData();
  root.append(container);

  return () => {
    clearTimeout(searchTimeout);
  };
}
