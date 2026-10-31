/**
 * CheckoutPage.ts — Streamlined Single-Phase Express Checkout (Prompt 5.4).
 *
 * Implements a frictionless, unified 1-page checkout experience:
 *  - Auto-prefills delivery name, phone, district & address from user profile and saved drafts
 *  - Single-view layout displaying Delivery Information, Payment Channel, and Ordered Items
 *  - 1-Click Order Confirmation directly from the persistent order summary
 *  - Direct in-place validation and smooth inline COD OTP challenge
 *  - Offline draft autosave & network resilience
 */

import { AddressForm } from '../components/checkout/AddressForm.ts';
import { PaymentSelector } from '../components/checkout/PaymentSelector.ts';
import { getCart, fetchCart, clearCart } from '../services/cart.ts';
import { placeCheckout, saveCheckoutDraft, loadCheckoutDraft, clearCheckoutDraft } from '../services/order.api.ts';
import { needsOnlinePayment, payForOrder } from '../services/payment.api.ts';
import { getTopUps } from '../services/walletTopup.api.ts';
import { adsApi } from '../services/ads.api.ts';
import { customerApi } from '../services/customer.api.ts';
import { getCurrentUser } from '../services/session.ts';
import { appStore } from '../state/appStore.ts';
import { formatCurrency } from '../services/format.ts';
import { toast } from '../services/toast.ts';
import { t, getLanguage } from '../services/i18n.ts';
import { knownZoneFor, loadDeliveryPolicy } from '../services/deliveryCharge.ts';
import { zoneName } from '../services/deliveryZones.ts';
import { escapeHtml } from '../services/html.ts';
import { Button } from '../components/ui/Button.ts';
import type { PageContext } from './types.ts';

export default function CheckoutPage(root: HTMLElement, { navigate }: PageContext = {}) {
  const container = document.createElement('div');
  container.className = 'checkout-page container';

  let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  let isSubmitting = false;

  // Retrieve authenticated user profile to auto-fill defaults
  const user = getCurrentUser() || appStore.get().auth?.user || {};

  // Load saved draft if present, falling back to profile details
  const draft: Record<string, any> = loadCheckoutDraft() || {};
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
    toast.warning(t('checkout.offline_toast'));
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
  let vaultBalance: number | null = null;

  /**
   * The delivery charge for the district the shopper has picked: the zone's per-parcel charge
   * (Inside Dhaka, Outside Dhaka, ...) times one parcel per supplier. The server resolves the same zone
   * from the same district when the order is placed (deliveryCharge.service.ts); until the policy has
   * loaded, the cart's default-zone estimate stands in.
   */
  function shippingInfo() {
    const parcels = Math.max(1, cartData?.parcels?.length || 1);
    const zone = knownZoneFor(addressData.district);
    if (zone) return { zone, perParcel: zone.charge, parcels, total: zone.charge * parcels };
    const total = Number(cartData?.estimated_shipping) || 0;
    return { zone: null, perParcel: total / parcels, parcels, total };
  }

  /** What the order will cost: the same sum the summary shows and the server charges. */
  function orderTotal() {
    if (!cartData) return 0;
    return Math.max(0, Number(cartData.subtotal || 0) + shippingInfo().total - Number(cartData.discount_amount || 0));
  }

  async function loadCartData() {
    try {
      await fetchCart();
      cartData = getCart();
      if (!cartData || !cartData.items || cartData.items.length === 0) {
        layout.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'checkout-empty card text-center';
        empty.style.padding = 'var(--space-9) var(--space-6)';
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

      // WHY no error: without a balance the vault option is simply not offered.
      try {
        const own = await getTopUps();
        vaultBalance = Number(own?.balance);
        if (!Number.isFinite(vaultBalance)) vaultBalance = null;
      } catch {
        vaultBalance = null;
      }

      renderCheckoutForm();
      renderSummary();

      // A cold first visit has no remembered policy yet; once it arrives, price by zone.
      const zoneBefore = knownZoneFor(addressData.district)?.key ?? null;
      loadDeliveryPolicy().then(() => {
        if ((knownZoneFor(addressData.district)?.key ?? null) !== zoneBefore || zoneBefore === null) {
          renderPayment();
          renderSummary();
        }
      });
    } catch {
      toast.error(t('checkout.cart_load_failed'));
    }
  }

  let paymentContent: HTMLElement | null = null;

  /** (Re)builds the payment choices: whether the vault covers the order depends on the zone's charge. */
  function renderPayment() {
    if (!paymentContent) return;
    paymentContent.innerHTML = '';
    paymentSelector = PaymentSelector({
      initialMethod: paymentMethod,
      orderTotal: orderTotal(),
      vaultBalance,
      onChange: (method) => {
        paymentMethod = method;
        persistDraft();
      },
    });
    paymentContent.append(paymentSelector.element);
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
        const zoneBefore = shippingInfo();
        addressData = { ...data };
        persistDraft();
        // WHY only on a zone change: typing a name must not rebuild the summary, but moving from a
        // Dhaka district to an outside one changes what the order costs, so the shopper sees it now.
        const zoneAfter = shippingInfo();
        if (zoneAfter.zone?.key !== zoneBefore.zone?.key || zoneAfter.total !== zoneBefore.total) {
          renderPayment();
          renderSummary();
        }
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

    paymentContent = document.createElement('div');
    paymentContent.className = 'checkout-section-card__content';
    renderPayment();
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
    // The zone of the picked district decides the per-parcel charge; checkout charges the same.
    const ship = shippingInfo();
    const shipping = ship.total;
    const discount = Number(cartData.discount_amount || 0);
    const total = Math.max(0, subtotal + shipping - discount);
    const zoneLine = ship.zone
      ? `<div class="checkout-summary__row checkout-summary__row--zone text-xs text-secondary" data-delivery-zone="${ship.zone.key}">
          <span>${escapeHtml(t('checkout.delivery_zone', { zone: zoneName(ship.zone, getLanguage()) }))}</span>
          <span>${escapeHtml(t('checkout.delivery_zone_rate', { charge: formatCurrency(ship.perParcel.toFixed(2)), count: ship.parcels }))}</span>
        </div>`
      : '';

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
        <span>${ship.zone ? t('checkout.delivery_charge', { count: ship.parcels }) : t('cart.shipping_estimate', { count: cartData.parcels?.length || 1 })}</span>
        <span>${formatCurrency(shipping.toFixed(2))}</span>
      </div>
      ${zoneLine}
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
      disabled: isSubmitting,
      onClick: async () => {
        if (isSubmitting) return;

        // Direct in-place validation
        if (addressForm && !addressForm.validate()) {
          toast.warning(t('checkout.fill_required_fields') || 'Please fill in the required delivery fields.');
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
            ad_campaign_id: adsApi.getAttribution() || undefined,
          };

          const result = await placeCheckout(payload);
          clearCheckoutDraft();
          clearCart();
          adsApi.clearAttribution();

          if (needsOnlinePayment(result.order)) {
            // The order exists now; a failed payment must not look like a failed order. The order
            // page offers "Pay now" for anything left unpaid.
            try {
              const paid = await payForOrder(result.order);
              if ((paid as { redirected?: true }).redirected) return;
              toast.success(t('checkout.payment_success'));
            } catch {
              toast.warning(t('checkout.payment_failed_after_order'));
            }
          } else {
            toast.success(t('checkout.order_success') || 'Order placed successfully!');
          }

          if (navigate && result.order?.ref) {
            navigate(`/orders/${result.order.ref}`);
          }
        } catch (err) {
          if (err.code === 'COD_OTP_REQUIRED') {
            paymentSelector?.promptOtp(err.details?.phone || addressData.recipient_phone);
            toast.warning(t('checkout.cod_otp_required_notice'));
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
    // WHY after the call: Button has no `className` option, so these classes were never applied.
    placeOrderBtn.classList.add('checkout-page__submit-btn', 'mt-6');

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
