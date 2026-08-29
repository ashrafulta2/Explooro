/**
 * CheckoutPage.js — Streamlined Single-Phase Express Checkout (Prompt 5.4).
 *
 * Implements a frictionless, unified 1-page checkout experience:
 *  - Auto-prefills delivery name, phone, district & address from user profile and saved drafts
 *  - Single-view layout displaying Delivery Information, Payment Channel, and Ordered Items
 *  - 1-Click Order Confirmation directly from the persistent order summary
 *  - Direct in-place validation and smooth inline COD OTP challenge
 *  - Offline draft autosave & network resilience
 */

import { AddressForm } from '../components/checkout/AddressForm.js';
import { PaymentSelector } from '../components/checkout/PaymentSelector.js';
import { getCart, fetchCart, clearCart } from '../services/cart.js';
import { placeCheckout, saveCheckoutDraft, loadCheckoutDraft, clearCheckoutDraft } from '../services/order.api.js';
import { customerApi } from '../services/customer.api.js';
import { getCurrentUser } from '../services/session.js';
import { appStore } from '../state/appStore.js';
import { formatCurrency } from '../services/format.js';
import { toast } from '../services/toast.js';
import { t } from '../services/i18n.js';
import { Button } from '../components/ui/Button.js';

export default function CheckoutPage(root, { navigate } = {}) {
  const container = document.createElement('div');
  container.className = 'checkout-page container';

  let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  let isSubmitting = false;

  // Retrieve authenticated user profile to auto-fill defaults
  const user = getCurrentUser() || appStore.state?.auth?.user || {};

  // Load saved draft if present, falling back to profile details
  const draft = loadCheckoutDraft() || {};
  let addressData = {
    recipient_name: draft.address?.recipient_name || user.full_name || user.display_name || user.name || '',
    recipient_phone: draft.address?.recipient_phone || user.phone || '',
    division: draft.address?.division || user.division || 'dhaka',
    district: draft.address?.district || user.district || 'dhaka_city',
    upazila: draft.address?.upazila || user.upazila || '',
    address_line: draft.address?.address_line || user.address_line || user.address || '',
    delivery_notes: draft.address?.delivery_notes || '',
  };
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
  const handleOnline = () => {
    isOnline = true;
    offlineBanner.classList.add('hidden');
    toast.success(t('checkout.online_restored_toast'));
  };
  const handleOffline = () => {
    isOnline = false;
    offlineBanner.classList.remove('hidden');
    toast.warn(t('checkout.offline_toast'));
  };
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Page Header
  const header = document.createElement('div');
  header.className = 'checkout-page__header';
  header.innerHTML = `
    <h1 class="checkout-page__title">${t('checkout.title') || 'Secure Checkout'}</h1>
    <p class="checkout-page__subtitle">${t('checkout.subtitle') || 'Review your delivery information and confirm your order in one click.'}</p>
  `;
  container.append(header);

  // Main Layout: 2 Columns (Main Form & Items on Left, Summary & 1-Click Action on Right)
  const layout = document.createElement('div');
  layout.className = 'checkout-page__layout';

  const mainCol = document.createElement('div');
  mainCol.className = 'checkout-page__steps-col';

  const summaryCol = document.createElement('div');
  summaryCol.className = 'checkout-page__summary-col';

  layout.append(mainCol, summaryCol);
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

  let userAddresses = [];

  async function loadCartData() {
    try {
      await fetchCart();
      cartData = getCart();
      if (!cartData || !cartData.items || cartData.items.length === 0) {
        layout.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'checkout-empty card text-center';
        empty.style.padding = 'var(--space-12) var(--space-6)';
        empty.style.width = '100%';
        empty.innerHTML = `
          <div style="font-size: 3rem; margin-bottom: var(--space-4);">🛒</div>
          <h2 class="text-xl font-bold">${t('cart.empty_title') || 'Your Cart is Empty'}</h2>
          <p class="text-secondary" style="margin: var(--space-2) 0 var(--space-6);">${t('cart.empty_sub') || 'Add products from the marketplace before checking out.'}</p>
        `;
        const cta = Button({
          label: t('common.back_to_marketplace') || 'Explore Marketplace',
          variant: 'primary',
          onClick: () => navigate('/'),
        });
        empty.append(cta);
        layout.append(empty);
        return;
      }

      try {
        userAddresses = (await customerApi.getAddresses()) || [];
        if (userAddresses.length > 0 && !draft.address) {
          const defaultAddr = userAddresses.find((a) => a.is_default) || userAddresses[0];
          if (defaultAddr) {
            addressData = {
              recipient_name: defaultAddr.recipient_name,
              recipient_phone: defaultAddr.recipient_phone,
              division: defaultAddr.division,
              district: defaultAddr.district,
              upazila: defaultAddr.upazila || '',
              address_line: defaultAddr.address_line,
              delivery_notes: defaultAddr.delivery_notes || '',
            };
          }
        }
      } catch {}

      renderCheckoutForm();
      renderSummary();
    } catch {
      toast.error(t('checkout.cart_load_failed'));
    }
  }

  function renderCheckoutForm() {
    mainCol.innerHTML = '';

    // 1. Delivery Information Card
    const addressCard = document.createElement('section');
    addressCard.className = 'checkout-section-card card';

    const addressHeader = document.createElement('div');
    addressHeader.className = 'checkout-section-card__header';
    addressHeader.innerHTML = `
      <div class="checkout-section-card__title-wrap">
        <span class="checkout-section-card__icon">📍</span>
        <h3 class="checkout-section-card__title">${t('checkout.step_delivery') || 'Delivery Address & Contact'}</h3>
      </div>
      <a href="/account/addresses" class="text-xs text-primary font-bold hover:underline" style="text-decoration: none;">
        ${t('customer_addresses.badge', 'Manage Addresses')} →
      </a>
    `;
    addressCard.append(addressHeader);

    const addressContent = document.createElement('div');
    addressContent.className = 'checkout-section-card__content';

    addressForm = AddressForm({
      initialData: addressData,
      savedAddresses: userAddresses,
      hideSubmitButton: true,
      onChange: (data) => {
        addressData = data;
        persistDraft();
      },
    });
    addressContent.append(addressForm.element);
    addressCard.append(addressContent);
    mainCol.append(addressCard);

    // 2. Payment Method Card
    const paymentCard = document.createElement('section');
    paymentCard.className = 'checkout-section-card card';

    const paymentHeader = document.createElement('div');
    paymentHeader.className = 'checkout-section-card__header';
    paymentHeader.innerHTML = `
      <div class="checkout-section-card__title-wrap">
        <span class="checkout-section-card__icon">💳</span>
        <h3 class="checkout-section-card__title">${t('checkout.payment_method') || 'Payment Method'}</h3>
      </div>
      <span class="text-xs text-secondary">${t('checkout.badge_instant') || 'Instant & COD'}</span>
    `;
    paymentCard.append(paymentHeader);

    const paymentContent = document.createElement('div');
    paymentContent.className = 'checkout-section-card__content';

    paymentSelector = PaymentSelector({
      initialMethod: paymentMethod,
      orderTotal: cartData ? Number(cartData.estimated_total || cartData.subtotal) : 0,
      onChange: (method) => {
        paymentMethod = method;
        persistDraft();
      },
    });
    paymentContent.append(paymentSelector.element);
    paymentCard.append(paymentContent);
    mainCol.append(paymentCard);

    // 3. Ordered Items & Multi-Supplier Parcel Breakdown Card
    if (cartData) {
      const itemsCard = document.createElement('section');
      itemsCard.className = 'checkout-section-card card';

      const parcels = cartData.parcels || [];
      const itemsHeader = document.createElement('div');
      itemsHeader.className = 'checkout-section-card__header';
      itemsHeader.innerHTML = `
        <div class="checkout-section-card__title-wrap">
          <span class="checkout-section-card__icon">📦</span>
          <h3 class="checkout-section-card__title">${t('checkout.parcel_breakdown', { count: parcels.length }) || 'Ordered Items'}</h3>
        </div>
        <span class="text-xs text-secondary">${t('cart.items_count', { count: cartData.items?.length || 0 })}</span>
      `;
      itemsCard.append(itemsHeader);

      const itemsContent = document.createElement('div');
      itemsContent.className = 'checkout-section-card__content';

      const parcelWrap = document.createElement('div');
      parcelWrap.className = 'checkout-page__parcels-wrap';

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
                <span class="checkout-page__item-title">${item.qty}x ${item.product_title_en || item.product_title || 'Item'}</span>
                <span class="checkout-page__item-price">${formatCurrency(item.unit_price)}</span>
              </div>
            `).join('')}
          </div>
        `;
        parcelWrap.append(pCard);
      });

      itemsContent.append(parcelWrap);
      itemsCard.append(itemsContent);
      mainCol.append(itemsCard);
    }
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
      <h3 class="checkout-summary__title">${t('checkout.order_summary') || 'Order Summary'}</h3>
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
    `;

    // 1-Click Submit / Place Order Button
    const placeOrderBtn = Button({
      label: isSubmitting ? t('checkout.placing_order') : t('checkout.place_order'),
      variant: 'primary',
      size: 'lg',
      className: 'checkout-page__submit-btn mt-6',
      disabled: isSubmitting,
      onClick: async () => {
        if (isSubmitting) return;

        // Direct in-place validation
        if (addressForm && !addressForm.validate()) {
          toast.warn(t('checkout.fill_required_fields') || 'Please fill in the required delivery fields.');
          return;
        }

        isSubmitting = true;
        placeOrderBtn.disabled = true;

        try {
          const validatedAddress = addressForm ? addressForm.getData() : addressData;
          const payload = {
            recipient_name: validatedAddress.recipient_name,
            recipient_phone: validatedAddress.recipient_phone,
            division: validatedAddress.division,
            district: validatedAddress.district,
            upazila: validatedAddress.upazila,
            address_line: validatedAddress.address_line,
            payment_method: paymentSelector?.getPaymentMethod() || paymentMethod,
            otp_code: paymentSelector?.getOtpCode() || undefined,
          };

          const result = await placeCheckout(payload);
          toast.success(t('checkout.order_success') || 'Order placed successfully!');
          clearCheckoutDraft();
          clearCart();

          if (navigate && result.order?.ref) {
            navigate(`/orders/${result.order.ref}`);
          }
        } catch (err) {
          if (err.code === 'COD_OTP_REQUIRED') {
            paymentSelector?.promptOtp(err.details?.phone || addressData.recipient_phone);
            toast.warn(t('checkout.cod_otp_required_notice'));
          } else {
            const isBn = document.documentElement.lang === 'bn';
            const msg = isBn && err.messageBn ? err.messageBn : err.message;
            toast.error(msg || t('common.error_occurred'));
          }
        } finally {
          isSubmitting = false;
          placeOrderBtn.disabled = false;
        }
      },
    });

    card.append(placeOrderBtn);

    const guaranteeWrap = document.createElement('div');
    guaranteeWrap.className = 'checkout-summary__guarantee';
    guaranteeWrap.innerHTML = `
      <span>🔒 SSL 256-bit Encrypted Checkout</span>
      <span>🛡️ 100% Buyer Protection & Refund Guarantee</span>
    `;
    card.append(guaranteeWrap);

    summaryCol.append(card);
  }

  loadCartData();
  root.append(container);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
