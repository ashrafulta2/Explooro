/**
 * CodReconciliationPage.js — Courier COD Settlement Ingestion, 3-Way Reconciliation & Aging Dashboard (Prompt 6.4).
 *
 * Implements:
 * 1. Settlement report upload (CSV & JSON) with automated 3-way matching
 * 2. 6-Tier discrepancy classification & queue management
 * 3. Courier aging matrix report with configurable alert thresholds
 * 4. Manual discrepancy resolution dialog with maker-checker governance
 */

import { api } from '../../core/api.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';

export default function CodReconciliationPage(root) {
  const container = document.createElement('div');
  container.className = 'page cod-recon-page';

  let reconciliations = [];
  let agingData = null;
  let statusFilter = '';
  let courierFilter = '';
  let isLoading = true;
  let isUploading = false;

  let uploadCourier = 'STEADFAST';
  let csvText = '';

  async function loadData() {
    isLoading = true;
    render();

    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (courierFilter) params.set('courier', courierFilter);
      params.set('limit', '50');

      const [reconRes, agingRes] = await Promise.all([
        api.get(`/admin/finance/cod?${params.toString()}`).catch(() => ({ data: { reconciliations: [] } })),
        api.get('/admin/finance/cod/aging').catch(() => ({ data: null })),
      ]);

      reconciliations = reconRes.data?.reconciliations || [];
      agingData = agingRes.data || null;
    } catch (err) {
      toast.error(err.message || 'Failed to load reconciliation data');
    } finally {
      isLoading = false;
      render();
    }
  }

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
        return `<span class="badge badge--neutral">${status}</span>`;
    }
  }

  async function handleResolve(item) {
    const reason = window.prompt(t('cod.enter_resolution_reason'), 'Cash collected confirmed by courier hub manager');
    if (!reason) return;

    try {
      const res = await api.post(`/admin/finance/cod/${item.id}/resolve`, {
        resolution_reason: reason.trim(),
      });

      if (res.meta?.maker_checker?.requires_super_admin) {
        toast.info(t('cod.maker_checker_pending'));
      } else {
        toast.success(t('cod.resolve_success'));
      }
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Resolution failed');
    }
  }

  async function handleCsvUpload() {
    if (!csvText.trim()) {
      toast.error(t('cod.error_csv_required'));
      return;
    }

    isUploading = true;
    render();

    try {
      const res = await api.post('/admin/finance/cod/upload', {
        courier: uploadCourier,
        csv_content: csvText.trim(),
      });

      const { matchedCount, shortCount, missingDepositCount, unmatchedCount } = res.data;
      toast.success(
        t('cod.upload_summary', {
          matched: matchedCount,
          short: shortCount,
          missing: missingDepositCount,
          unmatched: unmatchedCount,
        })
      );
      csvText = '';
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Upload failed');
      isUploading = false;
      render();
    }
  }

  function render() {
    container.innerHTML = `
      <div class="cod-recon-page__header">
        <div>
          <h1 class="page-title">${t('cod.page_title')}</h1>
          <p class="text-secondary">${t('cod.page_subtitle')}</p>
        </div>
        <div class="cod-recon-page__header-actions">
          <button type="button" class="btn btn--secondary cod-recon-page__refresh-btn">
            🔄 ${t('common.refresh')}
          </button>
        </div>
      </div>

      <!-- Aging Report Matrix -->
      ${agingData ? `
        <div class="card cod-recon-page__aging-card">
          <div class="cod-recon-page__aging-header">
            <h3>📊 ${t('cod.aging_title')}</h3>
            <span class="text-sm text-secondary">
              ${t('cod.total_unreconciled')}: <strong class="text-danger">${formatCurrency(agingData.totalUnreconciledPlatform)}</strong>
            </span>
          </div>

          <div class="table-responsive">
            <table class="table cod-recon-page__aging-table">
              <thead>
                <tr>
                  <th>${t('cod.col_courier')}</th>
                  <th>${t('cod.col_unreconciled_total')}</th>
                  <th>&lt; 3 ${t('cod.days')}</th>
                  <th>3–7 ${t('cod.days')}</th>
                  <th>8–14 ${t('cod.days')}</th>
                  <th>15–30 ${t('cod.days')}</th>
                  <th>&gt; 30 ${t('cod.days')}</th>
                  <th>${t('cod.col_status')}</th>
                </tr>
              </thead>
              <tbody>
                ${agingData.couriers.length === 0 ? `
                  <tr><td colspan="8" class="text-center text-muted">${t('cod.all_clean')}</td></tr>
                ` : agingData.couriers.map((c) => `
                  <tr>
                    <td class="font-bold">${c.courier}</td>
                    <td class="text-danger font-bold">${formatCurrency(c.totalUnreconciledFormatted)}</td>
                    <td>${formatCurrency(c.buckets.under3Days.amountFormatted)} (${c.buckets.under3Days.count})</td>
                    <td>${formatCurrency(c.buckets.days3To7.amountFormatted)} (${c.buckets.days3To7.count})</td>
                    <td class="${parseFloat(c.buckets.days8To14.amountFormatted) > 0 ? 'text-warning' : ''}">
                      ${formatCurrency(c.buckets.days8To14.amountFormatted)} (${c.buckets.days8To14.count})
                    </td>
                    <td class="${parseFloat(c.buckets.days15To30.amountFormatted) > 0 ? 'text-danger font-bold' : ''}">
                      ${formatCurrency(c.buckets.days15To30.amountFormatted)} (${c.buckets.days15To30.count})
                    </td>
                    <td class="${parseFloat(c.buckets.over30Days.amountFormatted) > 0 ? 'text-danger font-bold' : ''}">
                      ${formatCurrency(c.buckets.over30Days.amountFormatted)} (${c.buckets.over30Days.count})
                    </td>
                    <td>
                      ${c.hasAlert ? `<span class="badge badge--danger">⚠️ ${t('cod.aging_alert')}</span>` : `<span class="badge badge--success">✓ Normal</span>`}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- Ingest Settlement CSV Section -->
      <div class="card cod-recon-page__upload-card">
        <h3>📥 ${t('cod.upload_section_title')}</h3>
        <p class="text-sm text-secondary">${t('cod.upload_desc')}</p>

        <div class="cod-recon-page__upload-grid">
          <div class="form-group">
            <label class="form-label">${t('cod.select_courier')}</label>
            <select class="select cod-recon-page__courier-select">
              <option value="STEADFAST" ${uploadCourier === 'STEADFAST' ? 'selected' : ''}>Steadfast Courier</option>
              <option value="PATHAO" ${uploadCourier === 'PATHAO' ? 'selected' : ''}>Pathao Courier</option>
              <option value="REDX" ${uploadCourier === 'REDX' ? 'selected' : ''}>RedX Delivery</option>
              <option value="PAPERFLY" ${uploadCourier === 'PAPERFLY' ? 'selected' : ''}>Paperfly</option>
              <option value="ECOURIER" ${uploadCourier === 'ECOURIER' ? 'selected' : ''}>eCourier</option>
            </select>
          </div>

          <div class="form-group cod-recon-page__csv-group">
            <label class="form-label">${t('cod.paste_csv_label')}</label>
            <textarea class="textarea cod-recon-page__csv-input font-mono text-xs" rows="3" placeholder="consignment_id,sub_order_ref,courier_reported,deposit_received&#10;CN-8801,SUB-501,1560.00,1560.00">${csvText}</textarea>
          </div>

          <div class="cod-recon-page__upload-btn-wrap">
            <button type="button" class="btn btn--primary cod-recon-page__submit-csv-btn" ${isUploading ? 'disabled' : ''}>
              ${isUploading ? t('common.processing') : t('cod.btn_reconcile_csv')}
            </button>
          </div>
        </div>
      </div>

      <!-- Discrepancy Queue -->
      <div class="card cod-recon-page__queue-card">
        <div class="cod-recon-page__queue-header">
          <h3>📋 ${t('cod.queue_title')}</h3>
          <div class="cod-recon-page__filters">
            <select class="select select--sm cod-recon-page__filter-status">
              <option value="" ${statusFilter === '' ? 'selected' : ''}>${t('common.all_statuses')}</option>
              <option value="SHORT_COLLECTION" ${statusFilter === 'SHORT_COLLECTION' ? 'selected' : ''}>${t('cod.status.short_collection')}</option>
              <option value="MISSING_DEPOSIT" ${statusFilter === 'MISSING_DEPOSIT' ? 'selected' : ''}>${t('cod.status.missing_deposit')}</option>
              <option value="OVER_COLLECTION" ${statusFilter === 'OVER_COLLECTION' ? 'selected' : ''}>${t('cod.status.over_collection')}</option>
              <option value="UNMATCHED_CONSIGNMENT" ${statusFilter === 'UNMATCHED_CONSIGNMENT' ? 'selected' : ''}>${t('cod.status.unmatched_consignment')}</option>
              <option value="MATCHED" ${statusFilter === 'MATCHED' ? 'selected' : ''}>${t('cod.status.matched')}</option>
              <option value="RESOLVED" ${statusFilter === 'RESOLVED' ? 'selected' : ''}>${t('cod.status.resolved')}</option>
            </select>

            <select class="select select--sm cod-recon-page__filter-courier">
              <option value="" ${courierFilter === '' ? 'selected' : ''}>${t('common.all_couriers')}</option>
              <option value="STEADFAST" ${courierFilter === 'STEADFAST' ? 'selected' : ''}>Steadfast</option>
              <option value="PATHAO" ${courierFilter === 'PATHAO' ? 'selected' : ''}>Pathao</option>
              <option value="REDX" ${courierFilter === 'REDX' ? 'selected' : ''}>RedX</option>
            </select>
          </div>
        </div>

        ${isLoading ? `
          <div class="cod-recon-page__loading">
            <div class="spinner"></div>
            <span>${t('common.loading')}...</span>
          </div>
        ` : reconciliations.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state__icon">📦</div>
            <h3>${t('cod.no_discrepancies')}</h3>
            <p class="text-secondary">${t('cod.no_discrepancies_desc')}</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('cod.col_consignment')}</th>
                  <th>${t('cod.col_sub_order')}</th>
                  <th>${t('cod.col_courier')}</th>
                  <th>${t('cod.col_expected')}</th>
                  <th>${t('cod.col_courier_reported')}</th>
                  <th>${t('cod.col_deposit')}</th>
                  <th>${t('cod.col_variance')}</th>
                  <th>${t('cod.col_status')}</th>
                  <th class="text-right">${t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                ${reconciliations.map((r) => {
                  const isActionable = r.status !== 'MATCHED' && r.status !== 'RESOLVED';
                  const varianceNum = parseFloat(r.variance || 0);

                  return `
                    <tr>
                      <td class="font-mono font-bold">${r.consignment_id || '-'}</td>
                      <td>
                        <span class="font-mono">${r.sub_order_ref || `Sub #${r.sub_order_id || '-'}`}</span>
                      </td>
                      <td><span class="badge badge--neutral">${r.courier}</span></td>
                      <td>${formatCurrency(r.expected_amount)}</td>
                      <td>${formatCurrency(r.courier_reported || 0)}</td>
                      <td class="font-bold">${formatCurrency(r.deposit_received || 0)}</td>
                      <td class="${varianceNum < 0 ? 'text-danger font-bold' : varianceNum > 0 ? 'text-warning font-bold' : 'text-success'}">
                        ${varianceNum > 0 ? '+' : ''}${formatCurrency(varianceNum)}
                      </td>
                      <td>${getStatusBadge(r.status)}</td>
                      <td class="text-right">
                        ${isActionable ? `
                          <button type="button" class="btn btn--secondary btn--sm cod-recon-page__resolve-btn" data-id="${r.id}">
                            ⚖️ ${t('cod.btn_resolve')}
                          </button>
                        ` : `
                          <div class="text-xs text-secondary font-mono">${r.resolution_reason || r.settlement_batch_ref || '-'}</div>
                        `}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;

    // Event listeners
    container.querySelector('.cod-recon-page__refresh-btn')?.addEventListener('click', loadData);

    const courierSel = container.querySelector('.cod-recon-page__courier-select');
    courierSel?.addEventListener('change', (e) => {
      uploadCourier = e.target.value;
    });

    const csvInput = container.querySelector('.cod-recon-page__csv-input');
    csvInput?.addEventListener('input', (e) => {
      csvText = e.target.value;
    });

    container.querySelector('.cod-recon-page__submit-csv-btn')?.addEventListener('click', handleCsvUpload);

    const filterStatus = container.querySelector('.cod-recon-page__filter-status');
    filterStatus?.addEventListener('change', (e) => {
      statusFilter = e.target.value;
      loadData();
    });

    const filterCourier = container.querySelector('.cod-recon-page__filter-courier');
    filterCourier?.addEventListener('change', (e) => {
      courierFilter = e.target.value;
      loadData();
    });

    container.querySelectorAll('.cod-recon-page__resolve-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        const item = reconciliations.find((x) => x.id === id);
        if (item) handleResolve(item);
      });
    });
  }

  loadData();
  root.append(container);
}
