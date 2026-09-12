/**
 * AddToStoreDrawer.js — 1-click Add to Virtual Store drawer with custom retail price override
 * and minimum margin validation (Prompt 4.7).
 */
import { Drawer } from '../ui/Drawer.js';
import { Button } from '../ui/Button.js';
import { FormField } from '../ui/FormField.js';
import { Input } from '../ui/Input.js';
import { Select } from '../ui/Select.js';
import { toast } from '../../services/toast.js';
import { addToSalerStore, previewPricing } from '../../services/catalog.api.js';
import { pickMessage } from '../../core/api.js';
import { formatCurrency } from '../../services/format.js';
import { t, getLanguage } from '../../services/i18n.js';
import { resolveProductImage } from '../product/ProductCard.js';

const COLLECTIONS = [
  { value: 'General', label_en: 'General', label_bn: 'সাধারণ' },
  { value: 'Featured', label_en: 'Featured', label_bn: 'বিশেষ কালেকশন' },
  { value: 'Trending', label_en: 'Trending', label_bn: 'জনপ্রিয়' },
  { value: 'New Arrival', label_en: 'New Arrivals', label_bn: 'নতুন আগমন' },
];

/**
 * Creates the Add to Store Drawer instance.
 *
 * @param {object} props
 * @param {Function} [props.onSuccess] Callback when item is successfully added to store
 * @returns {HTMLDialogElement & { openForProduct: Function }}
 */
export function AddToStoreDrawer({ onSuccess = null } = {}) {
  let activeProduct = null;
  let debounceTimer = null;
  let isSubmitting = false;

  const contentWrap = document.createElement('div');
  contentWrap.className = 'add-store-form';

  const drawer = Drawer({
    title: t('sourcing.drawer.title'),
    description: t('sourcing.drawer.description'),
    content: contentWrap,
    side: 'right',
    size: 'md',
  });

  function renderContent() {
    contentWrap.innerHTML = '';
    if (!activeProduct) return;

    const isBn = getLanguage() === 'bn';
    const title = (isBn && activeProduct.title_bn) ? activeProduct.title_bn : (activeProduct.title_en || activeProduct.title);
    const initialPrice = parseFloat(activeProduct.price || activeProduct.default_retail_price || 0);
    const baseCost = activeProduct.pricing?.base_cost ?? activeProduct.base_cost ?? (initialPrice * 0.7);
    const wholesaleMargin = activeProduct.pricing?.wholesale_margin ?? activeProduct.wholesale_margin ?? 0;
    const wholesaleCost = activeProduct.pricing?.wholesale_cost ?? (baseCost + wholesaleMargin);
    const defaultRetailPrice = activeProduct.pricing?.default_retail_price ?? initialPrice;
    const minRetailPrice = activeProduct.pricing?.min_retail_price ?? Math.round(wholesaleCost * 1.1);

    // Product Preview Box (Confidential wholesale: shows Suggested Retail and Min Selling Price)
    const previewBox = document.createElement('div');
    previewBox.className = 'add-store-product-preview';

    const imgBox = document.createElement('div');
    imgBox.className = 'add-store-product-preview__img';

    const previewImageUrl = resolveProductImage(activeProduct);
    if (previewImageUrl) {
      const img = document.createElement('img');
      img.src = previewImageUrl;
      img.alt = title || '';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        imgBox.textContent = title ? title.slice(0, 2).toUpperCase() : 'PR';
      }, { once: true });
      imgBox.append(img);
    } else {
      imgBox.textContent = title ? title.slice(0, 2).toUpperCase() : 'PR';
    }

    const infoBox = document.createElement('div');
    infoBox.className = 'add-store-product-preview__info';

    const pTitle = document.createElement('h4');
    pTitle.className = 'add-store-product-preview__title';
    pTitle.textContent = title;

    const pMeta = document.createElement('span');
    pMeta.className = 'add-store-product-preview__meta';
    pMeta.textContent = `${t('sourcing.drawer.suggested_retail')}: ${formatCurrency(defaultRetailPrice)} • ${t('sourcing.drawer.min_price')}: ${formatCurrency(minRetailPrice)} • ${t('sourcing.drawer.stock')}: ${activeProduct.stock ?? activeProduct.stock_qty ?? 0}`;

    infoBox.append(pTitle, pMeta);
    previewBox.append(imgBox, infoBox);

    // Custom Price Input
    const priceField = FormField({
      label: t('sourcing.drawer.custom_price_label'),
      hint: `${t('sourcing.drawer.min_price_hint')}: ${formatCurrency(minRetailPrice)}`,
      required: true,
      control: Input({
        type: 'number',
        name: 'custom_retail_price',
        value: defaultRetailPrice.toString(),
        min: minRetailPrice.toString(),
        step: '10',
      }),
    });

    const priceInput = priceField.querySelector('input');

    // Collection Selector
    const collectionField = FormField({
      label: t('sourcing.drawer.collection_label'),
      control: Select({
        name: 'collection_name',
        options: COLLECTIONS.map((c) => ({
          value: c.value,
          label: isBn ? c.label_bn : c.label_en,
        })),
        value: 'General',
      }),
    });

    // Dynamic Live Profit Calculation Box
    const calcBox = document.createElement('div');
    calcBox.className = 'add-store-calc-preview';

    const defaultRetailRow = document.createElement('div');
    defaultRetailRow.className = 'add-store-calc-row';
    defaultRetailRow.innerHTML = `<span>${t('sourcing.drawer.suggested_retail')}</span><strong>${formatCurrency(defaultRetailPrice)}</strong>`;

    const minPriceRow = document.createElement('div');
    minPriceRow.className = 'add-store-calc-row';
    minPriceRow.innerHTML = `<span>${t('sourcing.drawer.min_price')}</span><strong>${formatCurrency(minRetailPrice)}</strong>`;

    const profitRow = document.createElement('div');
    profitRow.className = 'add-store-calc-row add-store-calc-row--highlight';
    profitRow.innerHTML = `<span>${t('sourcing.drawer.your_profit_per_sale')}</span><span id="drawer-saler-profit">—</span>`;

    const statusNotice = document.createElement('div');
    statusNotice.className = 'profit-calc__status profit-calc__status--standard';
    statusNotice.style.fontSize = '11px';
    statusNotice.style.display = 'none';

    const errorMsg = document.createElement('div');
    errorMsg.className = 'profit-calc__error';
    errorMsg.style.display = 'none';

    calcBox.append(defaultRetailRow, minPriceRow, profitRow, statusNotice, errorMsg);

    // Action Buttons
    const actions = document.createElement('div');
    actions.className = 'add-store-actions';

    const cancelBtn = Button({
      label: t('common.cancel'),
      variant: 'secondary',
      onClick: () => drawer.closeDrawer(false),
    });

    const submitBtn = Button({
      label: t('sourcing.drawer.btn_confirm_add'),
      variant: 'primary',
      onClick: async () => {
        if (isSubmitting) return;
        const enteredVal = parseFloat(priceInput.value);
        if (isNaN(enteredVal) || enteredVal < minRetailPrice) {
          toast.error(`${t('sourcing.drawer.error_min_price')} (${formatCurrency(minRetailPrice)})`);
          return;
        }

        const sel = collectionField.querySelector('select');
        const collection = sel ? sel.value : 'General';

        isSubmitting = true;
        submitBtn.setLoading(true);

        try {
          const item = await addToSalerStore({
            productId: activeProduct.ref || activeProduct.id,
            customRetailPrice: enteredVal,
            collectionName: collection,
          });

          toast.success(t('sourcing.drawer.add_success'));
          if (typeof onSuccess === 'function') {
            onSuccess(item);
          }
          drawer.closeDrawer(true);
        } catch (err) {
          const msg = (isBn && err?.message_bn) ? err.message_bn : (err?.message || err?.message_en || t('sourcing.drawer.add_failed'));
          toast.error(msg);
        } finally {
          isSubmitting = false;
          submitBtn.setLoading(false);
        }
      },
    });

    actions.append(cancelBtn, submitBtn);

    async function updateCalculations() {
      const enteredPrice = parseFloat(priceInput.value);
      if (isNaN(enteredPrice) || enteredPrice < minRetailPrice) {
        errorMsg.textContent = `⚠️ ${t('sourcing.drawer.error_min_price')} (${formatCurrency(minRetailPrice)})`;
        errorMsg.style.display = 'flex';
        statusNotice.style.display = 'none';
        calcBox.querySelector('#drawer-saler-profit').textContent = '—';
        submitBtn.disabled = true;
        return;
      }

      errorMsg.style.display = 'none';
      submitBtn.disabled = false;

      try {
        const preview = await previewPricing({
          baseCost,
          wholesaleMargin,
          retailPrice: enteredPrice,
          defaultRetailPrice,
          productId: activeProduct.ref || activeProduct.id,
          mode: 'tiered',
        });

        calcBox.querySelector('#drawer-saler-profit').textContent = `${formatCurrency(preview.saler_earning)} (${preview.saler_margin_pct}%)`;

        // Dynamic notice feedback
        if (preview.price_status === 'DISCOUNTED') {
          statusNotice.className = 'profit-calc__status profit-calc__status--discount';
          statusNotice.textContent = `🏷️ ${t('sourcing.drawer.discount_notice')}`;
          statusNotice.style.display = 'flex';
        } else if (preview.price_status === 'BOOSTED') {
          statusNotice.className = 'profit-calc__status profit-calc__status--boost';
          statusNotice.textContent = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 3.81-2 24.36 24.36 0 0 1 5.9-2c3.55-1 6-4 6-4s-3 2.45-4 6a24.36 24.36 0 0 1-2 5.9A22 22 0 0 1 15 12z"></path><path d="M9 11l.01-.01"></path></svg> ${t('sourcing.drawer.markup_notice')}`;
          statusNotice.style.display = 'flex';
        } else {
          statusNotice.style.display = 'none';
        }
      } catch (err) {
        errorMsg.textContent = `⚠️ ${pickMessage(err) || err?.message || t('sourcing.calc.error_below_min')}`;
        errorMsg.style.display = 'flex';
        statusNotice.style.display = 'none';
        submitBtn.disabled = true;
      }
    }

    priceInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateCalculations, 150);
    });

    // Initial calculation
    updateCalculations();

    contentWrap.append(previewBox, priceField, collectionField, calcBox, actions);
  }

  drawer.openForProduct = (product, triggerEl = null) => {
    activeProduct = product;
    renderContent();
    drawer.openDrawer(triggerEl);
  };

  return drawer;
}
