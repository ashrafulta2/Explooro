/**
 * LedgerTable.js — Double-Entry Ledger Audit Log Component (Prompt 6.5).
 *
 * Implements:
 * 1. Complete chronological double-entry movements.
 * 2. Category filtering (COMMISSION, ESCROW_RELEASE, PAYOUT_DISBURSED, REFUND, CLAWBACK).
 * 3. Color-coded signs (+ green / - red) with South Asian currency format.
 * 4. Client-side CSV export capability.
 */

import { formatCurrency, formatDate } from '../../services/format.js';
import { t } from '../../services/i18n.js';

export function LedgerTable({ transactions = [], onFilterChange = () => {} }) {
  const container = document.createElement('div');
  container.className = 'ledger-table-component';

  let currentCategory = '';
  let searchQuery = '';

  function getCategoryBadge(category) {
    switch (category) {
      case 'COMMISSION':
      case 'ESCROW_RELEASE':
      case 'DEPOSIT':
        return `<span class="badge badge--success">${category}</span>`;
      case 'PAYOUT_DISBURSED':
      case 'WITHDRAWAL':
        return `<span class="badge badge--purple">${category}</span>`;
      case 'REFUND':
      case 'CLAWBACK':
        return `<span class="badge badge--danger">${category}</span>`;
      case 'ADJUSTMENT':
        return `<span class="badge badge--warning">${category}</span>`;
      default:
        return `<span class="badge badge--neutral">${category || 'GENERAL'}</span>`;
    }
  }

  function exportCsv() {
    if (transactions.length === 0) return;
    const headers = ['ID', 'Date', 'Reference Type', 'Reference ID', 'Category', 'Bucket', 'Type', 'Amount (BDT)', 'Memo'];
    const rows = transactions.map((t) => [
      t.id,
      t.created_at,
      t.reference_type || '',
      t.reference_id || t.sub_order_ref || '',
      t.category,
      t.balance_bucket,
      t.entry_type,
      `${t.entry_type === 'CREDIT' ? '+' : '-'}${t.amount}`,
      `"${(t.memo || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `explooro_ledger_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function render() {
    const filtered = transactions.filter((item) => {
      if (currentCategory && item.category !== currentCategory) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const refMatch = String(item.reference_id || '').toLowerCase().includes(q) ||
                         String(item.sub_order_ref || '').toLowerCase().includes(q) ||
                         String(item.memo || '').toLowerCase().includes(q);
        if (!refMatch) return false;
      }
      return true;
    });

    container.innerHTML = `
      <div class="card ledger-table-card">
        <div class="ledger-table__header">
          <div>
            <h3 class="ledger-table__title">📜 ${t('vault.ledger_title')}</h3>
            <p class="text-sm text-secondary">${t('vault.ledger_subtitle')}</p>
          </div>

          <div class="ledger-table__actions">
            <input type="text" class="input input--sm ledger-table__search" placeholder="${t('common.search')}..." value="${searchQuery}" />
            <select class="select select--sm ledger-table__category-filter">
              <option value="" ${currentCategory === '' ? 'selected' : ''}>${t('common.all_categories')}</option>
              <option value="ESCROW_RELEASE" ${currentCategory === 'ESCROW_RELEASE' ? 'selected' : ''}>Escrow Release</option>
              <option value="COMMISSION" ${currentCategory === 'COMMISSION' ? 'selected' : ''}>Commission</option>
              <option value="PAYOUT_DISBURSED" ${currentCategory === 'PAYOUT_DISBURSED' ? 'selected' : ''}>Payout Disbursed</option>
              <option value="REFUND" ${currentCategory === 'REFUND' ? 'selected' : ''}>Refund</option>
              <option value="CLAWBACK" ${currentCategory === 'CLAWBACK' ? 'selected' : ''}>Clawback</option>
              <option value="ADJUSTMENT" ${currentCategory === 'ADJUSTMENT' ? 'selected' : ''}>Adjustment</option>
            </select>
            <button type="button" class="btn btn--secondary btn--sm ledger-table__export-btn">
              📥 ${t('vault.btn_export_csv')}
            </button>
          </div>
        </div>

        ${filtered.length === 0 ? `
          <div class="empty-state p-6">
            <div class="empty-state__icon">📄</div>
            <h4>${t('vault.no_ledger_entries')}</h4>
            <p class="text-sm text-secondary">${t('vault.no_ledger_entries_desc')}</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>${t('vault.col_date')}</th>
                  <th>${t('vault.col_reference')}</th>
                  <th>${t('vault.col_category')}</th>
                  <th>${t('vault.col_bucket')}</th>
                  <th>${t('vault.col_memo')}</th>
                  <th class="text-right">${t('vault.col_amount')}</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map((entry) => {
                  const isCredit = entry.entry_type === 'CREDIT';
                  const sign = isCredit ? '+' : '-';
                  const amountClass = isCredit ? 'text-success font-bold' : 'text-danger font-bold';

                  return `
                    <tr>
                      <td class="text-xs text-secondary whitespace-nowrap">
                        ${formatDate(entry.created_at)}
                      </td>
                      <td>
                        <span class="font-mono font-bold text-primary">
                          ${entry.sub_order_ref || (entry.reference_type ? `${entry.reference_type} #${entry.reference_id}` : `#${entry.id}`)}
                        </span>
                      </td>
                      <td>${getCategoryBadge(entry.category)}</td>
                      <td>
                        <span class="badge badge--neutral font-mono text-xs">${entry.balance_bucket}</span>
                      </td>
                      <td class="text-sm text-secondary">${entry.memo || '-'}</td>
                      <td class="text-right font-mono ${amountClass}">
                        ${sign}${formatCurrency(entry.amount)}
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
    container.querySelector('.ledger-table__category-filter')?.addEventListener('change', (e) => {
      currentCategory = e.target.value;
      onFilterChange({ category: currentCategory, search: searchQuery });
      render();
    });

    container.querySelector('.ledger-table__search')?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      render();
    });

    container.querySelector('.ledger-table__export-btn')?.addEventListener('click', exportCsv);
  }

  render();
  return container;
}
