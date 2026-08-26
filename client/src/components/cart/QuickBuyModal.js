/**
 * QuickBuyModal.js — 2-step direct purchase overlay bypassing cart (Prompt 5.4).
 *
 * Steps:
 *  1. Quantity, Variant & Delivery Address
 *  2. Payment Method & Instant Order Placement
 */

import '../../styles/components/checkout.css';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { AddressForm } from '../checkout/AddressForm.js';
import { PaymentSelector } from '../checkout/PaymentSelector.js';
import { placeCheckout, loadCheckoutDraft } from '../../services/order.api.js';
import { addToCart } from '../../services/cart.js';
import { getCurrentUser } from '../../services/session.js';
import { formatCurrency } from '../../services/format.js';
import { resolveProductImage } from '../product/ProductCard.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';

export function openQuickBuyModal({
  product,
  selectedVariant = null,
  initialQty = 1,
  onSuccess,
  navigate,
}) {
  if (!product) return null;

  let step = 1;
  let qty = initialQty;
  const currentUser = getCurrentUser();
  const savedDraft = loadCheckoutDraft();
  let addressData = savedDraft || (currentUser ? {
    recipient_name: currentUser.name || currentUser.full_name || '',
    recipient_phone: currentUser.phone || '',
    division: currentUser.division || 'dhaka',
    district: currentUser.district || 'dhaka_city',
    upazila: currentUser.upazila || '',
    address_line: currentUser.address || currentUser.address_line || '',
  } : {});
  let paymentMethod = 'COD';
  let isSubmitting = false;

  const contentEl = document.createElement('div');
  contentEl.className = 'quick-buy-modal';

  const modal = Modal({
    title: t('quick_buy.title') || 'Quick Buy (1-Click Order)',
    content: contentEl,
    size: 'lg',
    showClose: true,
  });

  function renderStep() {
    contentEl.innerHTML = '';

    // Product Header Snapshot
    const header = document.createElement('div');
    header.className = 'quick-buy-modal__product-header';
    const isBn = document.documentElement.lang === 'bn';
    const title = isBn && product.title_bn ? product.title_bn : (product.title_en || product.title_bn || product.title || 'Product');
    const price = selectedVariant?.price_override ?? product.price ?? product.pricing?.retail_price ?? product.default_retail_price ?? product.retail_price ?? 0;
    const imageUrl = product.primary_image_url || product.image_url || product.images?.[0]?.url || resolveProductImage(product) || '/placeholder.svg';

    header.innerHTML = `
      <div class="quick-buy-modal__thumb">
        <img src="${imageUrl}" alt="${title}" />
      </div>
      <div class="quick-buy-modal__info">
        <h4 class="quick-buy-modal__title">${title}</h4>
        <div class="quick-buy-modal__price">${formatCurrency(price)}</div>
        <div class="quick-buy-modal__supplier text-sm text-secondary">${t('checkout.supplier_label')}: ${product.supplier_name || t('product_detail.supplier.tier.verified')}</div>
      </div>
    `;
    contentEl.append(header);

    // Stepper Indicator
    const stepper = document.createElement('div');
    stepper.className = 'quick-buy-modal__stepper';
    stepper.innerHTML = `
      <div class="quick-buy-modal__step ${step === 1 ? 'quick-buy-modal__step--active' : 'quick-buy-modal__step--done'}">
        <span class="quick-buy-modal__step-num">1</span>
        <span>${t('quick_buy.step_details')}</span>
      </div>
      <div class="quick-buy-modal__step-divider"></div>
      <div class="quick-buy-modal__step ${step === 2 ? 'quick-buy-modal__step--active' : ''}">
        <span class="quick-buy-modal__step-num">2</span>
        <span>${t('quick_buy.step_confirm')}</span>
      </div>
    `;
    contentEl.append(stepper);

    // Step 1: Details & Address
    if (step === 1) {
      const step1Body = document.createElement('div');
      step1Body.className = 'quick-buy-modal__step-body';

      // Qty Stepper
      const qtyRow = document.createElement('div');
      qtyRow.className = 'quick-buy-modal__qty-row';
      qtyRow.innerHTML = `
        <label class="form-label">${t('common.quantity') || 'Quantity'}:</label>
        <div class="cart-stepper">
          <button type="button" class="cart-stepper__btn" id="qb-minus">−</button>
          <span class="cart-stepper__qty" id="qb-qty">${qty}</span>
          <button type="button" class="cart-stepper__btn" id="qb-plus">+</button>
        </div>
      `;
      qtyRow.querySelector('#qb-minus').addEventListener('click', () => {
        if (qty > 1) {
          qty -= 1;
          qtyRow.querySelector('#qb-qty').textContent = qty;
        }
      });
      qtyRow.querySelector('#qb-plus').addEventListener('click', () => {
        qty += 1;
        qtyRow.querySelector('#qb-qty').textContent = qty;
      });
      step1Body.append(qtyRow);

      // Address Form
      const addressForm = AddressForm({
        initialData: addressData,
        onChange: (data) => { addressData = data; },
        onSave: (data) => {
          addressData = data;
          step = 2;
          renderStep();
        },
      });

      step1Body.append(addressForm.element);
      contentEl.append(step1Body);
    } else {
      // Step 2: Payment & Confirm
      const step2Body = document.createElement('div');
      step2Body.className = 'quick-buy-modal__step-body';

      const unitPriceNum = Number(price);
      const itemsSubtotal = unitPriceNum * qty;
      const shipping = 60.0;
      const totalAmount = itemsSubtotal + shipping;

      const summaryCard = document.createElement('div');
      summaryCard.className = 'quick-buy-modal__summary card';
      summaryCard.innerHTML = `
        <div class="quick-buy-modal__summary-row">
          <span>${t('cart.subtotal')} (${qty}x)</span>
          <strong>${formatCurrency(itemsSubtotal.toFixed(2))}</strong>
        </div>
        <div class="quick-buy-modal__summary-row">
          <span>${t('cart.shipping_estimate', { count: 1 })}</span>
          <strong>${formatCurrency(shipping.toFixed(2))}</strong>
        </div>
        <div class="quick-buy-modal__summary-row quick-buy-modal__summary-row--total">
          <span>${t('cart.total')}</span>
          <span class="text-lg text-primary font-bold">${formatCurrency(totalAmount.toFixed(2))}</span>
        </div>
      `;
      step2Body.append(summaryCard);

      // Payment Selector
      const paymentSelector = PaymentSelector({
        initialMethod: paymentMethod,
        orderTotal: totalAmount,
        onChange: (m) => { paymentMethod = m; },
      });
      step2Body.append(paymentSelector.element);

      // Action Buttons
      const actions = document.createElement('div');
      actions.className = 'quick-buy-modal__actions';

      const backBtn = Button({
        label: t('common.back') || 'Back',
        variant: 'ghost',
        size: 'md',
        onClick: () => {
          step = 1;
          renderStep();
        },
      });

      const confirmBtn = Button({
        label: isSubmitting ? (t('checkout.placing_order') || 'Placing Order…') : (t('quick_buy.confirm_btn') || 'Confirm Quick Purchase'),
        variant: 'primary',
        size: 'lg',
        disabled: isSubmitting,
        onClick: async () => {
          if (isSubmitting) return;
          isSubmitting = true;
          confirmBtn.disabled = true;

          try {
            await addToCart({
              product_id: product.id,
              variant_id: selectedVariant?.id || null,
              qty,
              title_en: product.title_en || product.title || '',
              title_bn: product.title_bn || product.title || '',
              slug: product.slug || product.product_slug || '',
              variant_title: selectedVariant?.title || null,
              variant_sku: selectedVariant?.sku || null,
              price: selectedVariant?.price_override ?? product.retail_price ?? product.default_retail_price ?? product.price ?? 0,
              image_url: product.primary_image_url || product.image_url || product.images?.[0]?.url || resolveProductImage(product) || '',
              supplier_id: product.supplier_id || product.supplier?.id || 1,
              supplier_name: product.supplier_name || product.supplier?.name || 'Verified Supplier',
              stock_qty: selectedVariant?.stock_qty ?? product.stock_qty ?? product.stock ?? 10,
            });

            const payload = {
              recipient_name: addressData.recipient_name,
              recipient_phone: addressData.recipient_phone,
              division: addressData.division,
              district: addressData.district,
              upazila: addressData.upazila,
              address_line: addressData.address_line,
              payment_method: paymentMethod,
              otp_code: paymentSelector.getOtpCode() || undefined,
            };

            const result = await placeCheckout(payload);
            toast.success(t('quick_buy.success') || 'Quick order placed successfully!');
            modal.closeModal();

            if (onSuccess) onSuccess(result.order);
            if (navigate && result.order?.ref) {
              navigate(`/orders/${result.order.ref}`);
            }
          } catch (err) {
            if (err.code === 'COD_OTP_REQUIRED') {
              paymentSelector.promptOtp(err.details?.phone || addressData.recipient_phone);
              toast.warn(t('checkout.cod_otp_required_notice'));
            } else if (err.code === 'AUTH_REQUIRED' || err.status === 401) {
              toast.info(t('quick_buy.login_required') || 'Please sign in to complete your purchase.');
              modal.closeModal();
              if (navigate) {
                navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
              }
            } else {
              const msg = isBn && err.message_bn ? err.message_bn : (err.message_en || err.message || err.messageBn);
              toast.error(msg);
            }
          } finally {
            isSubmitting = false;
            confirmBtn.disabled = false;
          }
        },
      });

      actions.append(backBtn, confirmBtn);
      step2Body.append(actions);
      contentEl.append(step2Body);
    }
  }

  renderStep();
  modal.openModal();
  return modal;
}
