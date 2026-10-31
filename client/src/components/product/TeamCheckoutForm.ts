/**
 * TeamCheckoutForm.ts — the form a shopper fills to start or join a team purchase.
 *
 * It asks for the recipient's name, their division and district, and their address, plus how to pay:
 * Cash on Delivery or the Explooro wallet. Below them it shows what will be charged — the group
 * price, the delivery charge and the total — and how long delivery takes.
 *
 * WHY the district: since migration 099 each member pays the team-purchase charge of THEIR delivery
 * zone (/admin/platform/delivery), so two members of one team can pay different delivery charges.
 * The charge shown follows the picked district through services/deliveryZones.ts, the mirror of the
 * server's resolver; the server re-resolves it on join and that is what is charged.
 *
 * The phone number on the order is the buyer's account phone, so it is not asked for.
 *
 * Cash on Delivery passes the same trust check as a normal checkout. When the server answers
 * COD_OTP_REQUIRED it has sent an SMS code to the account phone; the form then shows a code field
 * and the next submit carries `otp_code` (server/src/services/codGate.service.ts).
 *
 *   const form = TeamCheckoutForm({ itemPrice, shippingCharge, walletBalance, submitLabel, onSubmit });
 *   form.el            // <form>
 *   form.setItemPrice(n)  // when the shopper switches team size
 */

import { t } from '../../services/i18n.ts';
import { formatCurrency } from '../../services/format.ts';
import { customerApi } from '../../services/customer.api.ts';
import { BANGLADESH_DIVISIONS, getDistrictsByDivision, getDivisionById } from '../../data/bangladeshGeo.ts';
import { knownZoneFor, loadDeliveryPolicy, deliveryEtaText } from '../../services/deliveryCharge.ts';
import { zoneName } from '../../services/deliveryZones.ts';
import '../../styles/components/team-checkout.css';

/** What `onSubmit` receives; `otp_code` only follows a COD_OTP_REQUIRED answer. */
export interface TeamCheckoutPayload {
  recipient_name: string;
  division: string;
  district: string;
  address_line: string;
  payment_method: 'COD' | 'WALLET';
  otp_code?: string;
}

export interface TeamCheckoutFormOptions {
  itemPrice?: number | string;
  /** Shown only until the zone policy has loaded; after that the picked district's zone decides. */
  shippingCharge?: number | string;
  /** Null when signed out. */
  walletBalance?: number | string | null;
  submitLabel?: string;
  onSubmit?: (payload: TeamCheckoutPayload) => Promise<unknown>;
}

export interface TeamCheckoutFormParts {
  el: HTMLFormElement;
  setItemPrice(price: number | string): void;
}

/** A saved address row from GET /customer/addresses, the fields the form reads. */
interface SavedAddress {
  recipient_name?: string;
  address_line?: string;
  upazila?: string;
  division?: string;
  district?: string;
  is_default?: boolean;
}

/** The `details` of a COD_OTP_REQUIRED error. */
interface OtpDetails {
  phone?: string;
  otp_debug?: string;
}

const toPaisa = (v: number | string | null | undefined) => Math.round(Number(v || 0) * 100);

/** "House 4, Road 7" + "Dhanmondi" from a saved address, skipping blanks (the district has its own field). */
function joinAddress(a: SavedAddress) {
  return [a.address_line, a.upazila].filter((part) => part && String(part).trim()).join(', ');
}

export function TeamCheckoutForm({
  itemPrice = 0,
  shippingCharge = 0,
  walletBalance = null,
  submitLabel = '',
  onSubmit = async () => {},
}: TeamCheckoutFormOptions = {}): TeamCheckoutFormParts {
  let currentItemPrice = Number(itemPrice) || 0;

  const form = document.createElement('form');
  form.className = 'team-checkout';
  form.noValidate = true;

  // -- recipient --------------------------------------------------------------------------------
  const nameField = document.createElement('label');
  nameField.className = 'team-checkout__field';
  nameField.innerHTML = `<span class="team-checkout__label"></span>
    <input class="input input--sm" name="recipient_name" type="text" maxlength="100" autocomplete="name" required />`;
  nameField.querySelector('.team-checkout__label')!.textContent = t('team_purchases.checkout.recipient_name');
  const nameInput = nameField.querySelector<HTMLInputElement>('input')!;
  nameInput.placeholder = t('team_purchases.checkout.recipient_name_placeholder');

  // -- division / district: decide the delivery zone, so the delivery charge ---------------------------
  const isBn = () => document.documentElement.lang === 'bn';
  const placeRow = document.createElement('div');
  placeRow.className = 'team-checkout__place';
  const divisionField = document.createElement('label');
  divisionField.className = 'team-checkout__field';
  divisionField.innerHTML = `<span class="team-checkout__label"></span><select class="input input--sm" name="division" required></select>`;
  divisionField.querySelector('.team-checkout__label')!.textContent = t('checkout.division');
  const divisionSelect = divisionField.querySelector<HTMLSelectElement>('select')!;
  for (const div of BANGLADESH_DIVISIONS) {
    const opt = document.createElement('option');
    opt.value = div.id;
    opt.textContent = isBn() ? div.name_bn : div.name_en;
    divisionSelect.append(opt);
  }
  divisionSelect.value = 'dhaka';
  const districtField = document.createElement('label');
  districtField.className = 'team-checkout__field';
  districtField.innerHTML = `<span class="team-checkout__label"></span><select class="input input--sm" name="district" required></select>`;
  districtField.querySelector('.team-checkout__label')!.textContent = t('checkout.district');
  const districtSelect = districtField.querySelector<HTMLSelectElement>('select')!;
  function fillDistricts(selected?: string) {
    const list = getDistrictsByDivision(divisionSelect.value);
    districtSelect.innerHTML = '';
    for (const d of list) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = isBn() ? d.name_bn : d.name_en;
      districtSelect.append(opt);
    }
    if (selected && list.some((d) => d.id === selected)) districtSelect.value = selected;
  }
  fillDistricts();
  divisionSelect.addEventListener('change', () => { fillDistricts(); renderSummary(); });
  districtSelect.addEventListener('change', () => renderSummary());
  placeRow.append(divisionField, districtField);

  const addressField = document.createElement('label');
  addressField.className = 'team-checkout__field';
  addressField.innerHTML = `<span class="team-checkout__label"></span>
    <textarea class="input input--sm team-checkout__address" name="address_line" rows="2" minlength="10" maxlength="300" autocomplete="street-address" required></textarea>
    <span class="team-checkout__hint"></span>`;
  addressField.querySelector('.team-checkout__label')!.textContent = t('team_purchases.checkout.address');
  addressField.querySelector('.team-checkout__hint')!.textContent = t('team_purchases.checkout.address_hint');
  const addressInput = addressField.querySelector<HTMLTextAreaElement>('textarea')!;
  addressInput.placeholder = t('team_purchases.checkout.address_placeholder');

  // -- payment ----------------------------------------------------------------------------------
  const payment = document.createElement('fieldset');
  payment.className = 'team-checkout__payment';
  const legend = document.createElement('legend');
  legend.className = 'team-checkout__label';
  legend.textContent = t('team_purchases.checkout.payment_method');
  payment.append(legend);

  function paymentOption(value: string, title: string, note: string) {
    const label = document.createElement('label');
    label.className = 'team-checkout__pay-option';
    label.dataset.method = value;
    label.innerHTML = `<input type="radio" name="payment_method" />
      <span class="team-checkout__pay-text"><strong></strong><small></small></span>`;
    const input = label.querySelector<HTMLInputElement>('input')!;
    input.value = value;
    label.querySelector('strong')!.textContent = title;
    label.querySelector('small')!.textContent = note;
    return { label, input, note: label.querySelector('small')! };
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
  otpField.querySelector('.team-checkout__label')!.textContent = t('team_purchases.checkout.otp_label');
  const otpNote = otpField.querySelector('.team-checkout__otp-note')!;
  const otpDev = otpField.querySelector<HTMLElement>('.team-checkout__otp-dev')!;
  const otpInput = otpField.querySelector<HTMLInputElement>('input')!;
  otpInput.placeholder = t('team_purchases.checkout.otp_placeholder');

  function showOtp(details: OtpDetails = {}) {
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

  form.append(nameField, placeRow, addressField, payment, otpField, summary, error, submit);

  /** The picked district's zone, once the policy is known; null before (the quote's figure stands in). */
  const zone = () => knownZoneFor(districtSelect.value);
  const shippingNow = () => {
    const z = zone();
    return z ? z.team_charge : Number(shippingCharge) || 0;
  };

  function totalPaisa() {
    return toPaisa(currentItemPrice) + toPaisa(shippingNow());
  }

  function renderSummary() {
    summary.innerHTML = '';
    const z = zone();
    const eta = deliveryEtaText(z);
    const rows = [
      [t('team_purchases.checkout.item_price'), formatCurrency(currentItemPrice)],
      [z ? t('team_purchases.checkout.shipping_zone', { zone: zoneName(z, isBn() ? 'bn' : 'en') }) : t('team_purchases.checkout.shipping_charge'), formatCurrency(shippingNow())],
      ...(eta ? [[t('checkout.delivery_eta_label'), eta]] : []),
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

  function showError(message: string) {
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
        division: divisionSelect.value,
        district: districtSelect.value,
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
  customerApi.getAddresses().then((list: SavedAddress[]) => {
    const saved = Array.isArray(list) ? (list.find((a) => a.is_default) || list[0]) : null;
    if (!saved) return;
    if (!nameInput.value) nameInput.value = saved.recipient_name || '';
    if (!addressInput.value) addressInput.value = joinAddress(saved);
    const div = getDivisionById(saved.division);
    if (div) {
      divisionSelect.value = div.id;
      fillDistricts(saved.district);
      renderSummary();
    }
  }).catch(() => {});

  // Once the zones are known, the charge follows the picked district.
  loadDeliveryPolicy().then(() => renderSummary());

  return {
    el: form,
    setItemPrice(price: number | string) {
      currentItemPrice = Number(price) || 0;
      renderSummary();
    },
  };
}
