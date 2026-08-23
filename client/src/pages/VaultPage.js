/**
 * VaultPage.js — Earner Vault & Financial Command Center (Prompt 6.5).
 *
 * Combines:
 * 1. BalanceSummary (4 clarity balance buckets & Payout CTA)
 * 2. EscrowTimeline (live countdowns on locked sales)
 * 3. LedgerTable (double-entry accounting audit trail with CSV export)
 * 4. Payout History listing
 */

import { api } from '../core/api.js';
import { toast } from '../services/toast.js';
import { t } from '../services/i18n.js';
import { BalanceSummary } from '../components/vault/BalanceSummary.js';
import { EscrowTimeline } from '../components/vault/EscrowTimeline.js';
import { LedgerTable } from '../components/vault/LedgerTable.js';

export function VaultPage() {
  const container = document.createElement('div');
  container.className = 'page vault-page';

  let wallet = null;
  let escrowEntries = [];
  let ledgerTransactions = [];
  let payouts = [];
  let isLoading = true;

  async function loadVaultData() {
    isLoading = true;
    render();

    try {
      const [overviewRes, ledgerRes, payoutRes] = await Promise.all([
        api.get('/api/v1/vault/overview').catch(() => ({ data: {} })),
        api.get('/api/v1/vault/ledger?limit=50').catch(() => ({ data: { ledger_transactions: [] } })),
        api.get('/api/v1/vault/payouts/me').catch(() => ({ data: { payout_requests: [] } })),
      ]);

      wallet = overviewRes.data?.wallet || null;
      escrowEntries = overviewRes.data?.escrow_timeline || [];
      ledgerTransactions = ledgerRes.data?.ledger_transactions || overviewRes.data?.recent_ledger || [];
      payouts = payoutRes.data?.payout_requests || [];
    } catch (err) {
      toast.error(err.message || 'Failed to load vault data');
    } finally {
      isLoading = false;
      render();
    }
  }

  function render() {
    container.innerHTML = `
      <div class="vault-page__header">
        <div>
          <h1 class="page-title">${t('vault.page_title')}</h1>
          <p class="text-secondary">${t('vault.page_subtitle')}</p>
        </div>
        <div class="vault-page__actions">
          <button type="button" class="btn btn--secondary vault-page__refresh-btn">
            🔄 ${t('common.refresh')}
          </button>
        </div>
      </div>

      ${isLoading ? `
        <div class="vault-page__loading">
          <div class="spinner"></div>
          <span>${t('common.loading')}...</span>
        </div>
      ` : `
        <div class="vault-page__body">
          <!-- 1. Balance Summary Cards -->
          <div class="vault-page__summary-slot"></div>

          <div class="vault-page__grid">
            <!-- 2. Active Escrow Timeline -->
            <div class="vault-page__escrow-slot"></div>

            <!-- 3. Double-Entry Ledger History -->
            <div class="vault-page__ledger-slot"></div>
          </div>
        </div>
      `}
    `;

    if (!isLoading) {
      const summarySlot = container.querySelector('.vault-page__summary-slot');
      if (summarySlot) {
        summarySlot.appendChild(
          BalanceSummary({
            wallet,
            onPayoutRequested: () => {
              loadVaultData();
            },
          })
        );
      }

      const escrowSlot = container.querySelector('.vault-page__escrow-slot');
      if (escrowSlot) {
        escrowSlot.appendChild(EscrowTimeline({ escrowEntries }));
      }

      const ledgerSlot = container.querySelector('.vault-page__ledger-slot');
      if (ledgerSlot) {
        ledgerSlot.appendChild(LedgerTable({ transactions: ledgerTransactions }));
      }
    }

    container.querySelector('.vault-page__refresh-btn')?.addEventListener('click', loadVaultData);
  }

  loadVaultData();
  return container;
}
