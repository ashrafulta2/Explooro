/**
 * CartDrawer.js — Multi-supplier interactive Cart Drawer (Prompt 5.1).
 *
 * Implements:
 *  - Multi-supplier parcel split visualizer with supplier attribution
 *  - Quantity steppers with per-line stock ceiling
 *  - Live price change and stock depletion warnings
 *  - Coupon code input with interactive feedback
 *  - Optimistic updates with rollback on failure
 *  - Empty state and full keyboard accessibility
 */

import { Drawer } from '../ui/Drawer.js';
import { Button } from '../ui/Button.js';
import { EmptyState } from '../ui/EmptyState.js';
import { cartStore, closeCartDrawer, updateItemQuantity, removeFromCart } from '../../services/cart.js';
import { formatCurrency } from '../../services/format.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

const PARCEL_ICON_SVG = `
<svg class="cart-drawer__split-banner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="m7.5 4.27 9 5.15"/>
  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
  <path d="m3.3 7 8.7 5 8.7-5"/>
  <path d="M12 22V12"/>
</svg>`;

export function CartDrawer({ navigate = null } = {}) {
  const container = document.createElement('div');
  container.className = 'cart-drawer';

  let appliedCoupon = null;

  function renderDrawerContent() {
    container.innerHTML = '';
    const state = cartStore.get();
    const cart = state.cart || { items: [], parcels: [], subtotal: '0.00', grand_total: '0.00' };
    const items = cart.items || [];
    const parcels = cart.parcels || [];

    // Header
    const header = document.createElement('div');
    header.className = 'cart-drawer__header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'cart-drawer__title-wrap';

    const title = document.createElement('h2');
    title.className = 'cart-drawer__title';
    title.textContent = t('cart.title') || 'Shopping Cart';
    titleWrap.append(title);

    if (cart.items_count > 0) {
      const badge = document.createElement('span');
      badge.className = 'cart-drawer__badge';
      badge.textContent = cart.items_count;
      titleWrap.append(badge);
    }
    header.append(titleWrap);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'overlay__close';
    closeBtn.setAttribute('aria-label', t('common.close') || 'Close');
    closeBtn.innerHTML = '✕';
    closeBtn.addEventListener('click', () => closeCartDrawer());
    header.append(closeBtn);

    container.append(header);

    // Body
    const body = document.createElement('div');
    body.className = 'cart-drawer__body';

    if (items.length === 0) {
      const empty = EmptyState({
        icon: '🛒',
        title: t('cart.empty_title') || 'Your cart is empty',
        description: t('cart.empty_description') || 'Explore verified Bangladeshi suppliers and start shopping today.',
        action: Button({
          label: t('cart.continue_shopping') || 'Browse Marketplace',
          variant: 'primary',
          onClick: () => {
            closeCartDrawer();
            if (navigate) navigate('/');
          },
        }),
      });
      body.append(empty);
      container.append(body);
      return;
    }

    // Multi-supplier parcel notice if items span > 1 supplier
    if (parcels.length > 1) {
      const banner = document.createElement('div');
      banner.className = 'cart-drawer__split-banner';
      banner.innerHTML = `
        ${PARCEL_ICON_SVG}
        <div>
          <strong>${t('cart.parcel_split_title', { count: parcels.length }) || `Order will arrive in ${parcels.length} separate parcels`}</strong>
          <div>${t('cart.parcel_split_desc') || 'Your items come from different verified suppliers and will be packaged individually.'}</div>
        </div>
      `;
      body.append(banner);
    }

    // Parcels list
    parcels.forEach((parcel, parcelIdx) => {
      const parcelCard = document.createElement('div');
      parcelCard.className = 'cart-parcel';

      const pHeader = document.createElement('div');
      pHeader.className = 'cart-parcel__header';

      const suppInfo = document.createElement('div');
      suppInfo.className = 'cart-parcel__supplier-info';
      suppInfo.innerHTML = `
        <span class="cart-parcel__tag">${t('cart.parcel_number', { number: parcelIdx + 1 }) || `Parcel #${parcelIdx + 1}`}</span>
        <span class="cart-parcel__supplier-name">${parcel.supplier_name}</span>
      `;
      pHeader.append(suppInfo);

      const pSub = document.createElement('span');
      pSub.className = 'text-muted';
      pSub.textContent = `${t('cart.items_count', { count: parcel.items_count })} · ${formatCurrency(parcel.subtotal)}`;
      pHeader.append(pSub);

      parcelCard.append(pHeader);

      const pItems = document.createElement('div');
      pItems.className = 'cart-parcel__items';

      parcel.items.forEach((item) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'cart-item';

        // Image
        const imgWrap = document.createElement('div');
        imgWrap.className = 'cart-item__image-wrap';
        const img = document.createElement('img');
        img.className = 'cart-item__image';
        img.src = item.image_url;
        img.alt = item.product_title_en;
        img.loading = 'lazy';
        imgWrap.append(img);
        itemEl.append(imgWrap);

        // Details
        const details = document.createElement('div');
        details.className = 'cart-item__details';

        const titleRow = document.createElement('div');
        titleRow.className = 'cart-item__title-row';

        const titleLink = document.createElement('a');
        titleLink.className = 'cart-item__title';
        titleLink.href = `/product/${item.product_ref || item.product_id}`;
        titleLink.textContent = document.documentElement.lang === 'bn' && item.product_title_bn ? item.product_title_bn : item.product_title_en;
        titleLink.addEventListener('click', (e) => {
          e.preventDefault();
          closeCartDrawer();
          if (navigate) navigate(`/product/${item.product_ref || item.product_id}`);
        });
        titleRow.append(titleLink);
        details.append(titleRow);

        if (item.variant_title) {
          const varEl = document.createElement('div');
          varEl.className = 'cart-item__variant';
          varEl.textContent = item.variant_title;
          details.append(varEl);
        }

        // Price
        const priceRow = document.createElement('div');
        priceRow.className = 'cart-item__price-row';
        const priceEl = document.createElement('span');
        priceEl.className = 'cart-item__price';
        priceEl.textContent = formatCurrency(item.unit_price);
        priceRow.append(priceEl);

        if (item.qty > 1) {
          const totalEl = document.createElement('span');
          totalEl.className = 'cart-item__line-total';
          totalEl.textContent = `(${formatCurrency(item.line_total)})`;
          priceRow.append(totalEl);
        }
        details.append(priceRow);

        // Stepper controls
        const controls = document.createElement('div');
        controls.className = 'cart-item__controls';

        const stepper = document.createElement('div');
        stepper.className = 'cart-stepper';

        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'cart-stepper__btn';
        minusBtn.textContent = item.qty === 1 ? '🗑️' : '−';
        minusBtn.title = item.qty === 1 ? t('cart.remove') : t('cart.decrease');
        minusBtn.addEventListener('click', () => {
          updateItemQuantity(item.id, item.qty - 1);
        });

        const qtySpan = document.createElement('span');
        qtySpan.className = 'cart-stepper__qty';
        qtySpan.textContent = item.qty;

        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'cart-stepper__btn';
        plusBtn.textContent = '+';
        plusBtn.title = t('cart.increase');
        plusBtn.disabled = item.stock_ceiling && item.qty >= item.stock_ceiling;
        plusBtn.addEventListener('click', () => {
          updateItemQuantity(item.id, item.qty + 1);
        });

        stepper.append(minusBtn, qtySpan, plusBtn);
        controls.append(stepper);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'cart-item__remove-btn';
        removeBtn.textContent = t('cart.remove') || 'Remove';
        removeBtn.addEventListener('click', () => removeFromCart(item.id));
        controls.append(removeBtn);

        details.append(controls);

        // Warnings if any
        if (item.warnings && item.warnings.length > 0) {
          item.warnings.forEach((w) => {
            const warnEl = document.createElement('div');
            warnEl.className = `cart-item__warning ${w.code === 'PRICE_CHANGED' ? 'cart-item__warning--price' : 'cart-item__warning--stock'}`;
            const msg = document.documentElement.lang === 'bn' && w.message_bn ? w.message_bn : w.message_en;
            warnEl.textContent = `⚠️ ${msg}`;
            details.append(warnEl);
          });
        }

        itemEl.append(details);
        pItems.append(itemEl);
      });

      parcelCard.append(pItems);
      body.append(parcelCard);
    });

    container.append(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'cart-drawer__footer';

    // Coupon input
    const couponWrap = document.createElement('div');
    couponWrap.className = 'cart-drawer__coupon-wrap';

    const couponInput = document.createElement('input');
    couponInput.type = 'text';
    couponInput.className = 'form-input form-input--sm cart-drawer__coupon-input';
    couponInput.placeholder = t('cart.coupon_placeholder') || 'Enter promo/voucher code';
    couponInput.value = appliedCoupon ? appliedCoupon.code : '';
    if (appliedCoupon) couponInput.disabled = true;

    const couponBtn = Button({
      label: appliedCoupon ? (t('cart.coupon_applied') || 'Applied ✓') : (t('cart.apply_coupon') || 'Apply'),
      variant: appliedCoupon ? 'secondary' : 'ghost',
      size: 'sm',
      disabled: !!appliedCoupon,
      onClick: () => {
        const code = couponInput.value.trim().toUpperCase();
        if (!code) return;
        if (code === 'EXPLOORO50' || code === 'SAVE10') {
          appliedCoupon = { code, discount: 50 };
          toast.success(t('cart.coupon_success') || `Promo code ${code} applied (-৳50.00)`);
          renderDrawerContent();
        } else {
          toast.error(t('cart.coupon_invalid') || 'Invalid promo code');
        }
      },
    });

    couponWrap.append(couponInput, couponBtn);
    footer.append(couponWrap);

    // Summary calculations
    const subtotalNum = Number(cart.subtotal);
    const shippingNum = Number(cart.estimated_shipping);
    const discountNum = appliedCoupon ? appliedCoupon.discount : 0;
    const finalTotalNum = Math.max(0, subtotalNum + shippingNum - discountNum);

    const subRow = document.createElement('div');
    subRow.className = 'cart-drawer__summary-row';
    subRow.innerHTML = `
      <span>${t('cart.subtotal') || 'Items Subtotal'}</span>
      <span class="cart-drawer__summary-val">${formatCurrency(subtotalNum.toFixed(2))}</span>
    `;
    footer.append(subRow);

    if (discountNum > 0) {
      const discRow = document.createElement('div');
      discRow.className = 'cart-drawer__summary-row text-success';
      discRow.innerHTML = `
        <span>${t('cart.discount') || 'Discount'}</span>
        <span class="cart-drawer__summary-val">- ${formatCurrency(discountNum.toFixed(2))}</span>
      `;
      footer.append(discRow);
    }

    const shipRow = document.createElement('div');
    shipRow.className = 'cart-drawer__summary-row';
    shipRow.innerHTML = `
      <span>${t('cart.shipping_estimate', { count: parcels.length })}</span>
      <span class="cart-drawer__summary-val">${formatCurrency(shippingNum.toFixed(2))}</span>
    `;
    footer.append(shipRow);

    const shipNote = document.createElement('div');
    shipNote.className = 'cart-drawer__shipping-note';
    shipNote.textContent = t('cart.shipping_calculated_note') || '৳60/parcel standard delivery across Bangladesh';
    footer.append(shipNote);

    const totalRow = document.createElement('div');
    totalRow.className = 'cart-drawer__summary-row cart-drawer__summary-row--total';
    totalRow.innerHTML = `
      <span>${t('cart.total') || 'Estimated Total'}</span>
      <span class="cart-drawer__summary-val">${formatCurrency(finalTotalNum.toFixed(2))}</span>
    `;
    footer.append(totalRow);

    const checkoutBtn = Button({
      label: t('cart.proceed_to_checkout') || 'Proceed to Checkout',
      variant: 'primary',
      size: 'lg',
      className: 'cart-drawer__checkout-btn',
      onClick: () => {
        closeCartDrawer();
        if (navigate) navigate('/checkout');
      },
    });
    footer.append(checkoutBtn);

    container.append(footer);
  }

  renderDrawerContent();

  const drawer = Drawer({
    content: container,
    side: 'right',
    size: 'md',
    showClose: false,
    onClose: () => {
      cartStore.update({ drawerOpen: false });
    },
  });

  // Keep drawer open/close synced with cartStore
  cartStore.subscribe((state) => {
    const isCurrentlyOpen = typeof drawer.isOpen === 'function' ? drawer.isOpen() : drawer.hasAttribute('open');
    if (state.drawerOpen && !isCurrentlyOpen) {
      renderDrawerContent();
      if (typeof drawer.openDrawer === 'function') {
        drawer.openDrawer();
      } else if (typeof drawer.showModal === 'function') {
        drawer.showModal();
      }
    } else if (!state.drawerOpen && isCurrentlyOpen) {
      if (typeof drawer.closeDrawer === 'function') {
        drawer.closeDrawer();
      } else if (typeof drawer.close === 'function') {
        drawer.close();
      }
    } else if (isCurrentlyOpen) {
      renderDrawerContent();
    }
  });

  return drawer;
}
