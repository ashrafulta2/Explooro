/**
 * CheckoutPage.js — Single-page 3-step collapsible checkout experience (Prompt 5.4).
 *
 * Steps:
 *  1. Delivery Address (cascading administrative selects)
 *  2. Payment Method (module-gated, inline COD OTP)
 *  3. Review & Multi-Supplier Split Summary
 *
 * Offline resilience:
 *  - Autosaves draft to localStorage (explooro_checkout_draft)
 *  - Listens to window online/offline events with actionable banner
 *  - Zero layout shift on step collapse/expand
 */

import { AddressForm } from '../components/checkout/AddressForm.js';
import { PaymentSelector } from '../components/checkout/PaymentSelector.js';
import { getCart, fetchCart } from '../services/cart.js';
import { placeCheckout, saveCheckoutDraft, loadCheckoutDraft, clearCheckoutDraft } from '../services/order.api.js';
import { formatCurrency } from '../services/format.js';
import { toast } from '../services/toast.js';
import { t } from '../services/i18n.js';
import { Button } from '../components/ui/Button.js';

export default function CheckoutPage({ navigate }) {
  const container = document.createElement('div');
  container.className = 'checkout-page container';

  let activeStep = 1; // 1: Delivery, 2: Payment, 3: Review
  let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  let isSubmitting = false;

  // Load saved draft if present
  const draft = loadCheckoutDraft() || {};
  let addressData = draft.address || {};
  let paymentMethod = draft.paymentMethod || 'COD';

  // Offline banner element
  const offlineBanner = document.createElement('div');
  offlineBanner.className = `checkout-page__offline-banner alert alert--warning ${isOnline ? 'hidden' : ''}`;
  offlineBanner.innerHTML = `
    <div class="alert__title">📡 ${t('checkout.offline_banner_title')}</div>
    <div class="alert__body">${t('checkout.offline_banner_desc')}</div>
  `;
  container.append(offlineBanner);

  // Connectivity event listeners
  window.addEventListener('online', () => {
    isOnline = true;
    offlineBanner.classList.add('hidden');
    toast.success(t('checkout.online_restored_toast'));
  });
  window.addEventListener('offline', () => {
    isOnline = false;
    offlineBanner.classList.remove('hidden');
    toast.warn(t('checkout.offline_toast'));
  });

  // Page Header
  const header = document.createElement('div');
  header.className = 'checkout-page__header';
  header.innerHTML = `
    <h1 class="checkout-page__title">${t('checkout.title')}</h1>
    <p class="checkout-page__subtitle">${t('checkout.subtitle')}</p>
  `;
  container.append(header);

  // Main Layout: 2 Columns (Steps on Left, Persistent Summary on Right)
  const layout = document.createElement('div');
  layout.className = 'checkout-page__layout';

  const stepsCol = document.createElement('div');
  stepsCol.className = 'checkout-page__steps-col';

  const summaryCol = document.createElement('div');
  summaryCol.className = 'checkout-page__summary-col';

  layout.append(stepsCol, summaryCol);
  container.append(layout);

  // Reference hooks
  let addressForm = null;
  let paymentSelector = null;
  let cartData = null;

  function persistDraft() {
    saveCheckoutDraft({
      address: addressData,
      paymentMethod,
    });
  }

  async function loadCartData() {
    try {
      await fetchCart();
      cartData = getCart();
      if (!cartData || !cartData.items || cartData.items.length === 0) {
        toast.info(t('cart.empty_title') || 'Your cart is empty');
        if (navigate) navigate('/');
        return;
      }
      renderSteps();
      renderSummary();
    } catch {
      toast.error(t('checkout.cart_load_failed'));
    }
  }

  function renderSteps() {
    stepsCol.innerHTML = '';

    // Step 1: Delivery Address Accordion Card
    const step1Card = document.createElement('div');
    step1Card.className = `checkout-step card ${activeStep === 1 ? 'checkout-step--active' : 'checkout-step--collapsed'}`;

    const step1Header = document.createElement('div');
    step1Header.className = 'checkout-step__header';
    step1Header.innerHTML = `
      <div class="checkout-step__title-wrap">
        <span class="checkout-step__badge ${activeStep > 1 ? 'checkout-step__badge--done' : ''}">${activeStep > 1 ? '✓' : '1'}</span>
        <h3 class="checkout-step__title">${t('checkout.step_delivery')}</h3>
      </div>
      ${activeStep > 1 ? `<button type="button" class="btn btn--ghost btn--sm checkout-step__edit-btn">${t('checkout.edit')}</button>` : ''}
    `;

    if (activeStep > 1) {
      step1Header.querySelector('.checkout-step__edit-btn').addEventListener('click', () => {
        activeStep = 1;
        renderSteps();
      });
    }

    step1Card.append(step1Header);

    const step1Content = document.createElement('div');
    step1Content.className = 'checkout-step__content';

    if (activeStep === 1) {
      addressForm = AddressForm({
        initialData: addressData,
        onChange: (data) => {
          addressData = data;
          persistDraft();
        },
        onSave: (data) => {
          addressData = data;
          persistDraft();
          activeStep = 2;
          renderSteps();
          renderSummary();
        },
      });
      step1Content.append(addressForm.element);
    } else {
      // Collapsed preview summary
      const preview = document.createElement('div');
      preview.className = 'checkout-step__preview text-sm text-secondary';
      preview.innerHTML = `
        <strong>${addressData.recipient_name || t('checkout.recipient_fallback')}</strong> · ${addressData.recipient_phone}<br />
        ${addressData.address_line}, ${addressData.district}, ${addressData.division}
      `;
      step1Content.append(preview);
    }

    step1Card.append(step1Content);
    stepsCol.append(step1Card);

    // Step 2: Payment Method Accordion Card
    const step2Card = document.createElement('div');
    step2Card.className = `checkout-step card ${activeStep === 2 ? 'checkout-step--active' : 'checkout-step--collapsed'}`;

    const step2Header = document.createElement('div');
    step2Header.className = 'checkout-step__header';
    step2Header.innerHTML = `
      <div class="checkout-step__title-wrap">
        <span class="checkout-step__badge ${activeStep > 2 ? 'checkout-step__badge--done' : ''}">${activeStep > 2 ? '✓' : '2'}</span>
        <h3 class="checkout-step__title">${t('checkout.step_payment')}</h3>
      </div>
      ${activeStep > 2 ? `<button type="button" class="btn btn--ghost btn--sm checkout-step__edit-btn">${t('checkout.edit')}</button>` : ''}
    `;

    if (activeStep > 2) {
      step2Header.querySelector('.checkout-step__edit-btn').addEventListener('click', () => {
        activeStep = 2;
        renderSteps();
      });
    }

    step2Card.append(step2Header);

    const step2Content = document.createElement('div');
    step2Content.className = 'checkout-step__content';

    if (activeStep === 2) {
      paymentSelector = PaymentSelector({
        initialMethod: paymentMethod,
        orderTotal: cartData ? Number(cartData.estimated_total || cartData.subtotal) : 0,
        onChange: (method) => {
          paymentMethod = method;
          persistDraft();
        },
      });

      step2Content.append(paymentSelector.element);

      const nextBtn = Button({
        label: t('checkout.save_continue') || 'Continue to Review',
        variant: 'primary',
        size: 'md',
        className: 'mt-4',
        onClick: () => {
          activeStep = 3;
          renderSteps();
          renderSummary();
        },
      });
      step2Content.append(nextBtn);
    } else if (activeStep > 2) {
      const preview = document.createElement('div');
      preview.className = 'checkout-step__preview text-sm text-secondary';
      preview.innerHTML = `<strong>${paymentMethod}</strong> — ${t(`checkout.${paymentMethod.toLowerCase()}`) || paymentMethod}`;
      step2Content.append(preview);
    }

    step2Card.append(step2Content);
    stepsCol.append(step2Card);

    // Step 3: Review & Multi-Supplier Split Summary Accordion Card
    const step3Card = document.createElement('div');
    step3Card.className = `checkout-step card ${activeStep === 3 ? 'checkout-step--active' : 'checkout-step--collapsed'}`;

    const step3Header = document.createElement('div');
    step3Header.className = 'checkout-step__header';
    step3Header.innerHTML = `
      <div class="checkout-step__title-wrap">
        <span class="checkout-step__badge">3</span>
        <h3 class="checkout-step__title">${t('checkout.step_review')}</h3>
      </div>
    `;
    step3Card.append(step3Header);

    const step3Content = document.createElement('div');
    step3Content.className = 'checkout-step__content';

    if (activeStep === 3 && cartData) {
      // Group items by supplier parcel
      const parcels = cartData.parcels || [];
      const parcelWrap = document.createElement('div');
      parcelWrap.className = 'checkout-page__parcels-wrap';

      const parcelHeader = document.createElement('div');
      parcelHeader.className = 'checkout-page__parcels-header';
      parcelHeader.innerHTML = `
        <h4>📦 ${t('checkout.parcel_breakdown', { count: parcels.length })}</h4>
        <p class="text-xs text-secondary">${t('cart.parcel_split_desc')}</p>
      `;
      parcelWrap.append(parcelHeader);

      parcels.forEach((parcel, pIdx) => {
        const pCard = document.createElement('div');
        pCard.className = 'checkout-page__parcel-card card card--subtle';
        pCard.innerHTML = `
          <div class="checkout-page__parcel-card-header">
            <strong>${t('cart.parcel_number', { number: pIdx + 1 })}: ${parcel.supplier_name || t('product_detail.supplier.tier.verified')}</strong>
            <span class="badge badge--success">${t('checkout.parcel_est_delivery')}</span>
          </div>
          <div class="checkout-page__parcel-items">
            ${parcel.items.map((item) => `
              <div class="checkout-page__item-row">
                <span class="checkout-page__item-title">${item.qty}x ${item.product_title_en}</span>
                <span class="checkout-page__item-price">${formatCurrency(item.unit_price)}</span>
              </div>
            `).join('')}
          </div>
        `;
        parcelWrap.append(pCard);
      });

      step3Content.append(parcelWrap);

      // Submit / Place Order Button
      const placeOrderBtn = Button({
        label: isSubmitting ? t('checkout.placing_order') : t('checkout.place_order'),
        variant: 'primary',
        size: 'lg',
        className: 'checkout-page__submit-btn mt-6',
        disabled: isSubmitting,
        onClick: async () => {
          if (isSubmitting) return;
          isSubmitting = true;
          placeOrderBtn.disabled = true;

          try {
            const payload = {
              recipient_name: addressData.recipient_name,
              recipient_phone: addressData.recipient_phone,
              division: addressData.division,
              district: addressData.district,
              upazila: addressData.upazila,
              address_line: addressData.address_line,
              payment_method: paymentMethod,
              otp_code: paymentSelector?.getOtpCode() || undefined,
            };

            const result = await placeCheckout(payload);
            toast.success(t('checkout.order_success') || 'Order placed successfully!');
            clearCheckoutDraft();

            if (navigate && result.order?.ref) {
              navigate(`/orders/${result.order.ref}`);
            }
          } catch (err) {
            if (err.code === 'COD_OTP_REQUIRED') {
              activeStep = 2;
              renderSteps();
              paymentSelector?.promptOtp(err.details?.phone || addressData.recipient_phone);
              toast.warn(t('checkout.cod_otp_required_notice'));
            } else {
              const isBn = document.documentElement.lang === 'bn';
              const msg = isBn && err.messageBn ? err.messageBn : err.message;
              toast.error(msg);
            }
          } finally {
            isSubmitting = false;
            placeOrderBtn.disabled = false;
          }
        },
      });

      step3Content.append(placeOrderBtn);
    }

    step3Card.append(step3Content);
    stepsCol.append(step3Card);
  }

  function renderSummary() {
    if (!cartData) return;

    summaryCol.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'checkout-summary card';

    const subtotal = Number(cartData.subtotal || 0);
    const shipping = Number(cartData.estimated_shipping || 60);
    const discount = Number(cartData.discount_amount || 0);
    const total = Math.max(0, subtotal + shipping - discount);

    card.innerHTML = `
      <h3 class="checkout-summary__title">${t('checkout.order_summary')}</h3>
      <div class="checkout-summary__row">
        <span>${t('cart.subtotal')}</span>
        <span>${formatCurrency(subtotal.toFixed(2))}</span>
      </div>
      ${discount > 0 ? `
        <div class="checkout-summary__row text-success">
          <span>${t('cart.discount')}</span>
          <span>- ${formatCurrency(discount.toFixed(2))}</span>
        </div>
      ` : ''}
      <div class="checkout-summary__row">
        <span>${t('cart.shipping_estimate', { count: cartData.parcels?.length || 1 })}</span>
        <span>${formatCurrency(shipping.toFixed(2))}</span>
      </div>
      <div class="checkout-summary__divider"></div>
      <div class="checkout-summary__row checkout-summary__row--total">
        <span>${t('cart.total')}</span>
        <span class="checkout-summary__total-val">${formatCurrency(total.toFixed(2))}</span>
      </div>
      <div class="checkout-summary__guarantee">
        <span>🔒 SSL 256-bit Encrypted Checkout</span>
        <span>🛡️ 100% Buyer Protection & Refund Guarantee</span>
      </div>
    `;

    summaryCol.append(card);
  }

  loadCartData();
  return container;
}
