/**
 * TeamCheckoutForm.js — the form a shopper fills to start or join a team purchase.
 *
 * It asks for exactly two things, the recipient's name and their address, plus how to pay:
 * Cash on Delivery or the Explooro wallet. Below them it shows what will be charged — the group
 * price, the shipping charge a super admin set, and the total — using the numbers the server sent
 * (GET /team-purchases/quote), never prices computed here.
 *
 * The phone number on the order is the buyer's account phone, and the district is read from the
 * address on the server, so neither is asked for.
 *
 * Cash on Delivery passes the same trust check as a normal checkout. When the server answers
 * COD_OTP_REQUIRED it has sent an SMS code to the account phone; the form then shows a code field
 * and the next submit carries `otp_code` (server/src/services/codGate.service.js).
 *
 *   const form = TeamCheckoutForm({ itemPrice, shippingCharge, walletBalance, submitLabel, onSubmit });
 *   form.el            // <form>
 *   form.setItemPrice(n)  // when the shopper switches team size
 */

import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { customerApi } from '../../services/customer.api.js';
import '../../styles/components/team-checkout.css';

const toPaisa = (v) => Math.round(Number(v || 0) * 100);

/** "House 4, Road 7" + "Dhanmondi" + "Dhaka" from a saved address, skipping blanks. */
function joinAddress(a) {
  return [a.address_line, a.upazila, a.district].filter((part) => part && String(part).trim()).join(', ');
}

export function TeamCheckoutForm({
  itemPrice = 0,
  shippingCharge = 0,
  walletBalance = null,
  submitLabel = '',
  onSubmit = async () => {},
} = {}) {
  let currentItemPrice = Number(itemPrice) || 0;

  const form = document.createElement('form');
  form.className = 'team-checkout';
  form.noValidate = true;

  // -- recipient --------------------------------------------------------------------------------
  const nameField = document.createElement('label');
  nameField.className = 'team-checkout__field';
  nameField.innerHTML = `<span class="team-checkout__label"></span>
    <input class="input input--sm" name="recipient_name" type="text" maxlength="100" autocomplete="name" required />`;
  nameField.querySelector('.team-checkout__label').textContent = t('team_purchases.checkout.recipient_name');
  const nameInput = nameField.querySelector('input');
  nameInput.placeholder = t('team_purchases.checkout.recipient_name_placeholder');

  const addressField = document.createElement('label');
  addressField.className = 'team-checkout__field';
  addressField.innerHTML = `<span class="team-checkout__label"></span>
    <textarea class="input input--sm team-checkout__address" name="address_line" rows="2" minlength="10" maxlength="300" autocomplete="street-address" required></textarea>
    <span class="team-checkout__hint"></span>`;
  addressField.querySelector('.team-checkout__label').textContent = t('team_purchases.checkout.address');
  addressField.querySelector('.team-checkout__hint').textContent = t('team_purchases.checkout.address_hint');
  const addressInput = addressField.querySelector('textarea');
  addressInput.placeholder = t('team_purchases.checkout.address_placeholder');

  // -- payment ----------------------------------------------------------------------------------
  const payment = document.createElement('fieldset');
  payment.className = 'team-checkout__payment';
  const legend = document.createElement('legend');
  legend.className = 'team-checkout__label';
  legend.textContent = t('team_purchases.checkout.payment_method');
  payment.append(legend);

  function paymentOption(value, title, note) {
    const label = document.createElement('label');
    label.className = 'team-checkout__pay-option';
    label.dataset.method = value;
    label.innerHTML = `<input type="radio" name="payment_method" />
      <span class="team-checkout__pay-text"><strong></strong><small></small></span>`;
    const input = label.querySelector('input');
    input.value = value;
    label.querySelector('strong').textContent = title;
    label.querySelector('small').textContent = note;
    return { label, input, note: label.querySelector('small') };
  }

  const cod = paymentOption('COD', t('team_purchases.checkout.pay_cod'), t('team_purchases.checkout.pay_cod_note'));
  const wallet = paymentOption('WALLET', t('team_purchases.checkout.pay_wallet'), '');
  cod.input.checked = true;
  payment.append(cod.label, wallet.label);

  // -- COD confirmation code (shown only after the server asks for it) -----------------------------
  const otpField = document.createElement('label');
  otpField.className = 'team-checkout__field team-checkout__otp';
  otpField.hidden = true;
  otpField.innerHTML = `<span class="team-checkout__hint team-checkout__otp-note"></span>
    <span class="team-checkout__label"></span>
    <input class="input input--sm font-mono" name="otp_code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
    <span class="team-checkout__hint team-checkout__otp-dev"></span>`;
  otpField.querySelector('.team-checkout__label').textContent = t('team_purchases.checkout.otp_label');
  const otpNote = otpField.querySelector('.team-checkout__otp-note');
  const otpDev = otpField.querySelector('.team-checkout__otp-dev');
  const otpInput = otpField.querySelector('input');
  otpInput.placeholder = t('team_purchases.checkout.otp_placeholder');

  function showOtp(details = {}) {
    otpField.hidden = false;
    otpNote.textContent = t('team_purchases.checkout.otp_sent', { phone: details.phone || '' });
    otpDev.textContent = details.otp_debug ? t('team_purchases.checkout.otp_dev', { code: details.otp_debug }) : '';
    otpDev.hidden = !details.otp_debug;
    otpInput.value = '';
    otpInput.focus();
  }

  // A wallet payment is not gated, so the code field only belongs to COD.
  cod.input.addEventListener('change', () => { if (otpNote.textContent) otpField.hidden = false; });
  wallet.input.addEventListener('change', () => { otpField.hidden = true; });

  // -- summary ----------------------------------------------------------------------------------
  const summary = document.createElement('dl');
  summary.className = 'team-checkout__summary';

  const error = document.createElement('p');
  error.className = 'team-checkout__error';
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary btn--md w-full team-checkout__submit';

  form.append(nameField, addressField, payment, otpField, summary, error, submit);

  function totalPaisa() {
    return toPaisa(currentItemPrice) + toPaisa(shippingCharge);
  }

  function renderSummary() {
    summary.innerHTML = '';
    const rows = [
      [t('team_purchases.checkout.item_price'), formatCurrency(currentItemPrice)],
      [t('team_purchases.checkout.shipping_charge'), formatCurrency(shippingCharge)],
      [t('team_purchases.checkout.total'), formatCurrency(totalPaisa() / 100)],
    ];
    rows.forEach(([term, value], i) => {
      const row = document.createElement('div');
      row.className = `team-checkout__row${i === rows.length - 1 ? ' team-checkout__row--total' : ''}`;
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      row.append(dt, dd);
      summary.append(row);
    });

    // A wallet that cannot cover the total is shown but cannot be chosen.
    const signedIn = walletBalance !== null && walletBalance !== undefined;
    const enough = signedIn && toPaisa(walletBalance) >= totalPaisa();
    wallet.input.disabled = !enough;
    wallet.label.classList.toggle('team-checkout__pay-option--disabled', !enough);
    wallet.note.textContent = !signedIn
      ? t('team_purchases.checkout.wallet_sign_in')
      : enough
        ? t('team_purchases.checkout.wallet_balance', { amount: formatCurrency(walletBalance) })
        : t('team_purchases.checkout.wallet_short', { amount: formatCurrency(walletBalance) });
    if (!enough && wallet.input.checked) cod.input.checked = true;

    submit.textContent = `${submitLabel} (${formatCurrency(totalPaisa() / 100)})`;
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const recipientName = nameInput.value.trim();
    const addressLine = addressInput.value.trim();
    if (!recipientName) {
      showError(t('team_purchases.checkout.error_name'));
      nameInput.focus();
      return;
    }
    if (addressLine.length < 10) {
      showError(t('team_purchases.checkout.error_address'));
      addressInput.focus();
      return;
    }
    const payingCod = !wallet.input.checked;
    const otpCode = otpInput.value.trim();
    if (payingCod && !otpField.hidden && !otpCode) {
      showError(t('team_purchases.checkout.error_otp'));
      otpInput.focus();
      return;
    }
    showError('');
    const label = submit.textContent;
    submit.disabled = true;
    submit.textContent = t('common.processing');
    try {
      await onSubmit({
        recipient_name: recipientName,
        address_line: addressLine,
        payment_method: payingCod ? 'COD' : 'WALLET',
        ...(payingCod && otpCode ? { otp_code: otpCode } : {}),
      });
    } catch (err) {
      if (err?.code === 'COD_OTP_REQUIRED') {
        showError('');
        showOtp(err.details || {});
        return;
      }
      showError(err?.message || t('common.error_generic'));
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  renderSummary();

  // Prefill from the default saved address, without overwriting anything already typed.
  customerApi.getAddresses().then((list) => {
    const saved = Array.isArray(list) ? (list.find((a) => a.is_default) || list[0]) : null;
    if (!saved) return;
    if (!nameInput.value) nameInput.value = saved.recipient_name || '';
    if (!addressInput.value) addressInput.value = joinAddress(saved);
  }).catch(() => {});

  return {
    el: form,
    setItemPrice(price) {
      currentItemPrice = Number(price) || 0;
      renderSummary();
    },
  };
}
