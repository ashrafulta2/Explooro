/**
 * CouponCard.js — Customer Coupon Voucher Ticket Component.
 *
 * Implements a perforated ticket-style voucher card with high-contrast typography,
 * 1-click copy code, countdown/expiry badges, minimum spend rules, and terms modal trigger.
 */

import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';

export function CouponCard({
  coupon,
  onShopClick,
  onTermsClick,
} = {}) {
  const isBn = getLanguage() === 'bn';
  const card = document.createElement('div');
  card.className = `coupon-card ${!coupon.is_active || coupon.is_used ? 'coupon-card--disabled' : ''}`;
  card.dataset.couponId = coupon.id;

  const discountType = coupon.discount_type || 'PERCENT';
  const discountVal = Number(coupon.discount_value) || 0;
  const minSpend = Number(coupon.min_spend_amount || coupon.min_spend || 0);
  const maxDiscount = Number(coupon.max_discount_amount || coupon.max_discount || 0);
  const scopeType = coupon.scope_type || 'PLATFORM';

  // Format Discount Label
  let discountLabel = '';
  let discountSublabel = '';
  if (discountType === 'PERCENT') {
    discountLabel = `${discountVal}%`;
    discountSublabel = isBn ? 'ছাড়' : 'OFF';
  } else if (discountType === 'FREE_SHIPPING') {
    discountLabel = '🚚';
    discountSublabel = isBn ? 'ফ্রি ডেলিভারি' : 'FREE SHIPPING';
  } else {
    discountLabel = `৳${discountVal}`;
    discountSublabel = isBn ? 'ছাড়' : 'OFF';
  }

  // Calculate Expiry Status
  const now = new Date();
  const expiryDate = coupon.expires_at ? new Date(coupon.expires_at) : null;
  const diffDays = expiryDate ? Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)) : null;
  const isExpired = diffDays !== null && diffDays < 0;

  let expiryBadge = '';
  if (coupon.is_used) {
    expiryBadge = `<span class="coupon-badge coupon-badge--used">${t('customer_coupons.used')}</span>`;
  } else if (isExpired || !coupon.is_active) {
    expiryBadge = `<span class="coupon-badge coupon-badge--expired">${t('customer_coupons.expired')}</span>`;
  } else if (diffDays === 0) {
    expiryBadge = `<span class="coupon-badge coupon-badge--urgent">⚡ ${t('customer_coupons.expires_today')}</span>`;
  } else if (diffDays !== null && diffDays <= 3) {
    expiryBadge = `<span class="coupon-badge coupon-badge--warning">⏳ ${t('customer_coupons.expires_in', { days: diffDays })}</span>`;
  } else if (expiryDate) {
    const formattedDate = expiryDate.toLocaleDateString(isBn ? 'bn-BD' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    expiryBadge = `<span class="coupon-badge coupon-badge--neutral">📅 ${t('customer_coupons.valid_till', { date: formattedDate })}</span>`;
  }

  // Scope label
  let scopeBadge = '';
  if (scopeType === 'PLATFORM') {
    scopeBadge = `<span class="coupon-scope-badge coupon-scope-badge--platform">🌐 ${t('customer_coupons.scope_platform')}</span>`;
  } else if (scopeType === 'CATEGORY') {
    scopeBadge = `<span class="coupon-scope-badge coupon-scope-badge--category">🏷️ ${coupon.category_name || t('customer_coupons.scope_category')}</span>`;
  } else if (scopeType === 'SUPPLIER') {
    scopeBadge = `<span class="coupon-scope-badge coupon-scope-badge--supplier">🏭 ${coupon.funder_name || coupon.supplier_name || t('customer_coupons.scope_supplier')}</span>`;
  } else if (scopeType === 'SALER') {
    scopeBadge = `<span class="coupon-scope-badge coupon-scope-badge--saler">🏪 ${coupon.store_name || t('customer_coupons.scope_saler')}</span>`;
  }

  card.innerHTML = `
    <!-- Perforated Stub Left Side -->
    <div class="coupon-card__stub">
      <div class="coupon-card__discount-val">${discountLabel}</div>
      <div class="coupon-card__discount-sub">${discountSublabel}</div>
    </div>

    <!-- Perforation Line -->
    <div class="coupon-card__perforation">
      <div class="coupon-card__notch coupon-card__notch--top"></div>
      <div class="coupon-card__dash-line"></div>
      <div class="coupon-card__notch coupon-card__notch--bottom"></div>
    </div>

    <!-- Main Content Area -->
    <div class="coupon-card__body">
      <div class="coupon-card__header">
        <div class="coupon-card__scope-wrap">
          ${scopeBadge}
          ${expiryBadge}
        </div>
      </div>

      <div class="coupon-card__details">
        <div class="coupon-card__code-row">
          <div class="coupon-card__code-pill font-mono" title="${coupon.code}">
            🎟️ ${coupon.code}
          </div>
          <button type="button" class="coupon-card__copy-btn btn btn--secondary btn--sm" data-action="copy">
            📋 ${t('customer_coupons.btn_copy_code')}
          </button>
        </div>

        <div class="coupon-card__rules text-xs text-muted">
          ${minSpend > 0 ? `<span>• ${t('customer_coupons.min_spend', { amount: formatCurrency(minSpend) })}</span>` : ''}
          ${maxDiscount > 0 ? `<span>• ${t('customer_coupons.max_discount', { amount: formatCurrency(maxDiscount) })}</span>` : ''}
        </div>
      </div>

      <div class="coupon-card__footer">
        <button type="button" class="coupon-card__terms-btn text-xs text-primary hover:underline" data-action="terms">
          ℹ️ ${t('customer_coupons.btn_view_terms')}
        </button>

        ${coupon.is_active && !coupon.is_used && !isExpired ? `
          <button type="button" class="coupon-card__shop-btn btn btn--primary btn--sm" data-action="shop">
            🛍️ ${t('customer_coupons.btn_shop_now')}
          </button>
        ` : ''}
      </div>
    </div>
  `;

  // Attach Event Listeners
  const copyBtn = card.querySelector('[data-action="copy"]');
  copyBtn?.addEventListener('click', async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(coupon.code);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = coupon.code;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      toast.success(t('customer_coupons.code_copied', { code: coupon.code }));
      copyBtn.textContent = isBn ? '✓ কপি হয়েছে' : '✓ Copied!';
      setTimeout(() => {
        if (copyBtn) copyBtn.textContent = `📋 ${t('customer_coupons.btn_copy_code')}`;
      }, 2000);
    } catch (e) {
      toast.info(coupon.code);
    }
  });

  const termsBtn = card.querySelector('[data-action="terms"]');
  termsBtn?.addEventListener('click', () => {
    if (typeof onTermsClick === 'function') onTermsClick(coupon);
  });

  const shopBtn = card.querySelector('[data-action="shop"]');
  shopBtn?.addEventListener('click', () => {
    if (typeof onShopClick === 'function') onShopClick(coupon);
  });

  return card;
}
