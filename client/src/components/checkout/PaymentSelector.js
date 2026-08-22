/**
 * PaymentSelector.js — Module-gated payment channel selector with inline COD OTP (Prompt 5.4).
 *
 * Supports:
 *  - bKash (tokenized)
 *  - Nagad
 *  - Rocket
 *  - Cards
 *  - Cash on Delivery (COD) with advance fee policy and inline OTP challenge
 */

import { isFeatureEnabled } from '../../services/featureFlags.js';
import { t } from '../../services/i18n.js';
import { Button } from '../ui/Button.js';

export function PaymentSelector({
  initialMethod = 'COD',
  orderTotal = 0,
  onChange,
  onOtpSubmit,
} = {}) {
  const container = document.createElement('div');
  container.className = 'payment-selector';

  let selectedMethod = initialMethod;
  let otpState = {
    required: false,
    phone: '',
    code: '',
  };

  const methods = [
    {
      id: 'BKASH',
      title: t('checkout.bkash'),
      desc: t('checkout.bkash_desc'),
      icon: '📱',
      badge: t('checkout.badge_instant'),
      flag: 'bkash',
    },
    {
      id: 'NAGAD',
      title: t('checkout.nagad'),
      desc: t('checkout.nagad_desc'),
      icon: '📲',
      badge: t('checkout.badge_fast'),
      flag: 'nagad',
    },
    {
      id: 'ROCKET',
      title: t('checkout.rocket'),
      desc: t('checkout.rocket_desc'),
      icon: '🚀',
      badge: t('checkout.badge_dbbl'),
      flag: 'rocket',
    },
    {
      id: 'CARD',
      title: t('checkout.card'),
      desc: t('checkout.card_desc'),
      icon: '💳',
      badge: t('checkout.badge_card'),
      flag: 'cards',
    },
    {
      id: 'COD',
      title: t('checkout.cod'),
      desc: t('checkout.cod_desc'),
      icon: '💵',
      badge: t('checkout.badge_cash'),
      flag: 'cod',
    },
  ];

  // Render methods list
  const listEl = document.createElement('div');
  listEl.className = 'payment-selector__list';

  methods.forEach((m) => {
    // Check if feature flag is active (if feature flags initialized)
    const isEnabled = !m.flag || isFeatureEnabled(m.flag, true);
    if (!isEnabled) return;

    const card = document.createElement('label');
    card.className = `payment-selector__card ${selectedMethod === m.id ? 'payment-selector__card--selected' : ''}`;
    card.setAttribute('for', `pay-method-${m.id}`);

    card.innerHTML = `
      <input type="radio" id="pay-method-${m.id}" name="payment_method" value="${m.id}" ${selectedMethod === m.id ? 'checked' : ''} class="payment-selector__radio" />
      <div class="payment-selector__icon">${m.icon}</div>
      <div class="payment-selector__info">
        <div class="payment-selector__title">
          <span>${m.title}</span>
          <span class="badge badge--neutral">${m.badge}</span>
        </div>
        <div class="payment-selector__desc">${m.desc}</div>
      </div>
    `;

    const radio = card.querySelector('input');
    radio.addEventListener('change', () => {
      selectedMethod = m.id;
      listEl.querySelectorAll('.payment-selector__card').forEach((c) => c.classList.remove('payment-selector__card--selected'));
      card.classList.add('payment-selector__card--selected');
      renderExtraPanels();
      if (onChange) onChange(selectedMethod);
    });

    listEl.append(card);
  });

  container.append(listEl);

  // Extra Details / OTP Panel
  const extraPanel = document.createElement('div');
  extraPanel.className = 'payment-selector__extra';
  container.append(extraPanel);

  function renderExtraPanels() {
    extraPanel.innerHTML = '';

    if (selectedMethod === 'COD') {
      const codNotice = document.createElement('div');
      codNotice.className = 'payment-selector__notice alert alert--info';
      codNotice.innerHTML = `
        <div class="alert__title">ℹ️ ${t('checkout.cod')}</div>
        <div class="alert__body">${t('checkout.cod_note')}</div>
      `;
      extraPanel.append(codNotice);

      // Inline OTP Challenge (if required)
      if (otpState.required) {
        const otpBox = document.createElement('div');
        otpBox.className = 'payment-selector__otp-box';
        otpBox.innerHTML = `
          <div class="payment-selector__otp-header">
            <strong>🔒 ${t('checkout.cod_otp_required_notice')}</strong>
            <p class="text-sm text-secondary">${t('checkout.otp_sent_to', { phone: otpState.phone })}</p>
          </div>
          <div class="payment-selector__otp-input-wrap">
            <input type="text" maxlength="6" inputmode="numeric" class="form-input form-input--lg payment-selector__otp-input" placeholder="••••••" autofocus />
          </div>
          <span class="form-error" id="err-payment-otp"></span>
        `;

        const otpInput = otpBox.querySelector('input');
        otpInput.addEventListener('input', (e) => {
          otpState.code = e.target.value.replace(/\D/g, '');
        });

        extraPanel.append(otpBox);
      }
    }
  }

  renderExtraPanels();

  return {
    element: container,
    getPaymentMethod: () => selectedMethod,
    getOtpCode: () => otpState.code,
    promptOtp: (phone) => {
      otpState.required = true;
      otpState.phone = phone || '';
      renderExtraPanels();
      const input = extraPanel.querySelector('.payment-selector__otp-input');
      if (input) input.focus();
    },
    clearOtp: () => {
      otpState.required = false;
      otpState.code = '';
      renderExtraPanels();
    },
  };
}
