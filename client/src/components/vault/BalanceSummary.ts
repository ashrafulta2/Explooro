/**
 * BalanceSummary.ts — 4-Bucket Balance Clarity Card Component (Prompt 6.5).
 *
 * Renders:
 * 1. Total Earnings (lifetime_earned)
 * 2. Available Balance (available_balance)
 * 3. Pending Escrow (pending_escrow_balance)
 * 4. Total Withdrawn (lifetime_withdrawn) & Processing (held_balance)
 *
 * Includes plain-language clarity explanations and Payout Request CTA.
 */

import { formatCurrency } from '../../services/format.js';
import { t } from '../../services/i18n.js';
import { PayoutRequestModal } from './PayoutRequestModal.js';

/** The wallet buckets from GET /wallet, decimal strings or numbers. */
export interface WalletBuckets {
  available_balance?: number | string | null;
  pending_escrow_balance?: number | string | null;
  lifetime_earned?: number | string | null;
  lifetime_withdrawn?: number | string | null;
  held_balance?: number | string | null;
}

export interface BalanceSummaryOptions {
  wallet?: WalletBuckets | null;
  onPayoutRequested?: (payout: unknown) => void;
}

export function BalanceSummary({ wallet, onPayoutRequested = () => {} }: BalanceSummaryOptions): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'balance-summary';

  const available = parseFloat(String(wallet?.available_balance || 0));
  const pending = parseFloat(String(wallet?.pending_escrow_balance || 0));
  const earned = parseFloat(String(wallet?.lifetime_earned || 0));
  const withdrawn = parseFloat(String(wallet?.lifetime_withdrawn || 0));
  const held = parseFloat(String(wallet?.held_balance || 0));

  function openPayoutModal() {
    PayoutRequestModal({
      availableBalance: available,
      // @ts-expect-error PayoutRequestModal (still .js) infers its options from defaults that omit onSuccess
      onSuccess: (payout: unknown) => {
        onPayoutRequested(payout);
      },
    });
  }

  container.innerHTML = `
    <div class="balance-summary__grid">
      <!-- 1. Total Earnings -->
      <div class="card balance-card balance-card--earned">
        <div class="balance-card__icon">💰</div>
        <div class="balance-card__content">
          <div class="balance-card__label">${t('vault.card_earned_label')}</div>
          <div class="balance-card__amount">${formatCurrency(earned)}</div>
          <div class="balance-card__hint">${t('vault.card_earned_hint')}</div>
        </div>
      </div>

      <!-- 2. Available Balance -->
      <div class="card balance-card balance-card--available">
        <div class="balance-card__icon">⚡</div>
        <div class="balance-card__content">
          <div class="balance-card__label">${t('vault.card_available_label')}</div>
          <div class="balance-card__amount font-bold text-success">${formatCurrency(available)}</div>
          <div class="balance-card__hint">${t('vault.card_available_hint')}</div>
        </div>
        <div class="balance-card__actions">
          <button type="button" class="btn btn--primary btn--sm balance-summary__withdraw-btn" ${available <= 0 ? 'disabled' : ''}>
            🏦 ${t('vault.btn_withdraw')}
          </button>
        </div>
      </div>

      <!-- 3. Pending Escrow -->
      <div class="card balance-card balance-card--pending">
        <div class="balance-card__icon">⏳</div>
        <div class="balance-card__content">
          <div class="balance-card__label">${t('vault.card_pending_label')}</div>
          <div class="balance-card__amount text-warning">${formatCurrency(pending)}</div>
          <div class="balance-card__hint">${t('vault.card_pending_hint')}</div>
        </div>
      </div>

      <!-- 4. Withdrawn & In-Processing -->
      <div class="card balance-card balance-card--withdrawn">
        <div class="balance-card__icon">✅</div>
        <div class="balance-card__content">
          <div class="balance-card__label">${t('vault.card_withdrawn_label')}</div>
          <div class="balance-card__amount">${formatCurrency(withdrawn)}</div>
          <div class="balance-card__hint">
            ${held > 0 ? `<span class="badge badge--warning font-mono">${formatCurrency(held)} ${t('vault.in_processing')}</span>` : t('vault.card_withdrawn_hint')}
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('.balance-summary__withdraw-btn')?.addEventListener('click', openPayoutModal);

  return container;
}
