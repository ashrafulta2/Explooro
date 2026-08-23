/**
 * PayoutRequestModal.js — Withdrawal Request Modal (Prompt 6.3).
 *
 * Implements:
 * - Method selection: bKash, Nagad, Rocket, Bank
 * - Dynamic balance validation & quick 'Withdraw Max' action
 * - Destination account detail collection with validation
 * - Transparent fee breakdown and net amount display
 * - Immediate submit handling with loading state & toast notifications
 */

import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { FormField } from '../ui/FormField.js';
import { Input } from '../ui/Input.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';
import { api } from '../../core/api.js';

export function openPayoutRequestModal({
  availableBalance = 0,
  onSuccess,
} = {}) {
  let selectedMethod = 'BKASH';
  let amount = '';
  let accountNumber = '';
  let accountName = '';
  let bankName = '';
  let isSubmitting = false;

  const contentEl = document.createElement('div');
  contentEl.className = 'payout-modal';

  const modal = Modal({
    title: t('payout.request_title'),
    content: contentEl,
    size: 'md',
    showClose: true,
  });

  function render() {
    contentEl.innerHTML = `
      <div class="payout-modal__balance-card">
        <span class="payout-modal__balance-label">${t('payout.available_balance')}:</span>
        <span class="payout-modal__balance-val">${formatCurrency(availableBalance)}</span>
      </div>

      <div class="payout-modal__methods">
        <label class="form-label">${t('payout.select_method')}</label>
        <div class="payout-modal__method-grid">
          <button type="button" class="payout-modal__method-btn ${selectedMethod === 'BKASH' ? 'is-active' : ''}" data-method="BKASH">
            <span class="payout-modal__method-icon">📱</span>
            <span>bKash</span>
          </button>
          <button type="button" class="payout-modal__method-btn ${selectedMethod === 'NAGAD' ? 'is-active' : ''}" data-method="NAGAD">
            <span class="payout-modal__method-icon">📱</span>
            <span>Nagad</span>
          </button>
          <button type="button" class="payout-modal__method-btn ${selectedMethod === 'ROCKET' ? 'is-active' : ''}" data-method="ROCKET">
            <span class="payout-modal__method-icon">📱</span>
            <span>Rocket</span>
          </button>
          <button type="button" class="payout-modal__method-btn ${selectedMethod === 'BANK' ? 'is-active' : ''}" data-method="BANK">
            <span class="payout-modal__method-icon">🏦</span>
            <span>Bank Transfer</span>
          </button>
        </div>
      </div>

      <div class="payout-modal__form">
        <div class="payout-modal__amount-group">
          <div class="payout-modal__amount-input-wrap">
            <label class="form-label" for="payout-amount">${t('payout.amount_label')} (৳)</label>
            <div class="payout-modal__input-row">
              <input type="number" id="payout-amount" class="input" placeholder="Min 100" min="100" max="${availableBalance}" value="${amount}" step="any" />
              <button type="button" class="btn btn--secondary btn--sm payout-modal__max-btn">${t('payout.max_btn')}</button>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="payout-account-num">
            ${selectedMethod === 'BANK' ? t('payout.bank_account_num') : t('payout.mfs_number')}
          </label>
          <input type="text" id="payout-account-num" class="input" placeholder="${selectedMethod === 'BANK' ? 'e.g. 1029384756' : '+8801XXXXXXXXX'}" value="${accountNumber}" />
        </div>

        <div class="form-group">
          <label class="form-label" for="payout-account-name">${t('payout.account_name')}</label>
          <input type="text" id="payout-account-name" class="input" placeholder="${t('payout.account_name_placeholder')}" value="${accountName}" />
        </div>

        ${selectedMethod === 'BANK' ? `
          <div class="form-group">
            <label class="form-label" for="payout-bank-name">${t('payout.bank_name')}</label>
            <input type="text" id="payout-bank-name" class="input" placeholder="e.g. BRAC Bank Ltd." value="${bankName}" />
          </div>
        ` : ''}

        <div class="payout-modal__fee-summary">
          <div class="payout-modal__fee-row">
            <span>${t('payout.fee_label')}:</span>
            <span class="text-success">${t('payout.fee_free')}</span>
          </div>
          <div class="payout-modal__fee-row payout-modal__fee-row--total">
            <span>${t('payout.net_disbursement')}:</span>
            <span id="payout-net-val" class="font-bold">${formatCurrency(amount || 0)}</span>
          </div>
        </div>
      </div>

      <div class="payout-modal__actions">
        <button type="button" class="btn btn--ghost payout-modal__cancel-btn">${t('common.cancel')}</button>
        <button type="button" class="btn btn--primary payout-modal__submit-btn" ${isSubmitting ? 'disabled' : ''}>
          ${isSubmitting ? t('common.processing') : t('payout.submit_request')}
        </button>
      </div>
    `;

    // Attach event listeners
    contentEl.querySelectorAll('.payout-modal__method-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedMethod = btn.dataset.method;
        render();
      });
    });

    const amountInput = contentEl.querySelector('#payout-amount');
    amountInput?.addEventListener('input', (e) => {
      amount = e.target.value;
      const netEl = contentEl.querySelector('#payout-net-val');
      if (netEl) netEl.textContent = formatCurrency(amount || 0);
    });

    const maxBtn = contentEl.querySelector('.payout-modal__max-btn');
    maxBtn?.addEventListener('click', () => {
      amount = String(availableBalance);
      if (amountInput) amountInput.value = amount;
      const netEl = contentEl.querySelector('#payout-net-val');
      if (netEl) netEl.textContent = formatCurrency(amount || 0);
    });

    const accNumInput = contentEl.querySelector('#payout-account-num');
    accNumInput?.addEventListener('input', (e) => {
      accountNumber = e.target.value;
    });

    const accNameInput = contentEl.querySelector('#payout-account-name');
    accNameInput?.addEventListener('input', (e) => {
      accountName = e.target.value;
    });

    const bankInput = contentEl.querySelector('#payout-bank-name');
    bankInput?.addEventListener('input', (e) => {
      bankName = e.target.value;
    });

    contentEl.querySelector('.payout-modal__cancel-btn')?.addEventListener('click', () => {
      modal.close();
    });

    contentEl.querySelector('.payout-modal__submit-btn')?.addEventListener('click', async () => {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount < 100) {
        toast.error(t('payout.error_min_100'));
        return;
      }
      if (numAmount > availableBalance) {
        toast.error(t('payout.error_exceeds_balance'));
        return;
      }
      if (!accountNumber || accountNumber.trim().length < 6) {
        toast.error(t('payout.error_account_required'));
        return;
      }
      if (!accountName || accountName.trim().length < 2) {
        toast.error(t('payout.error_name_required'));
        return;
      }

      isSubmitting = true;
      render();

      try {
        const res = await api.post('/api/v1/vault/withdraw', {
          method: selectedMethod,
          account_number: accountNumber.trim(),
          account_name: accountName.trim(),
          bank_name: selectedMethod === 'BANK' ? bankName.trim() : null,
          amount: numAmount,
        });

        toast.success(t('payout.request_submitted'));
        modal.close();
        onSuccess?.(res.data?.payout);
      } catch (err) {
        toast.error(err.message || t('payout.request_failed'));
        isSubmitting = false;
        render();
      }
    });
  }

  render();
  modal.open();

  return modal;
}

export const PayoutRequestModal = openPayoutRequestModal;
