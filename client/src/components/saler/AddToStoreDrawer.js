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

    // Product Preview Box
    const previewBox = document.createElement('div');
    previewBox.className = 'add-store-product-preview';

    const imgBox = document.createElement('div');
    imgBox.className = 'add-store-product-preview__img';
    imgBox.textContent = title ? title.slice(0, 2).toUpperCase() : 'PR';

    const infoBox = document.createElement('div');
    infoBox.className = 'add-store-product-preview__info';

    const pTitle = document.createElement('h4');
    pTitle.className = 'add-store-product-preview__title';
    pTitle.textContent = title;

    const pMeta = document.createElement('span');
    pMeta.className = 'add-store-product-preview__meta';
    pMeta.textContent = `${t('sourcing.drawer.wholesale_cost')}: ${formatCurrency(wholesaleCost)} • ${t('sourcing.drawer.stock')}: ${activeProduct.stock ?? activeProduct.stock_qty ?? 0}`;

    infoBox.append(pTitle, pMeta);
    previewBox.append(imgBox, infoBox);

    // Custom Price Input
    let customPrice = initialPrice;

    const priceField = FormField({
      label: t('sourcing.drawer.custom_price_label'),
      hint: `${t('sourcing.drawer.min_price_hint')}: ${formatCurrency(wholesaleCost)}`,
      required: true,
      control: Input({
        type: 'number',
        name: 'custom_retail_price',
        value: initialPrice.toString(),
        min: wholesaleCost.toString(),
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

    const wholesaleRow = document.createElement('div');
    wholesaleRow.className = 'add-store-calc-row';
    wholesaleRow.innerHTML = `<span>${t('sourcing.calc.wholesale_cost')}</span><strong>${formatCurrency(wholesaleCost)}</strong>`;

    const netMarginRow = document.createElement('div');
    netMarginRow.className = 'add-store-calc-row';
    netMarginRow.innerHTML = `<span>${t('sourcing.calc.net_retail_margin')}</span><span id="drawer-net-margin">—</span>`;

    const profitRow = document.createElement('div');
    profitRow.className = 'add-store-calc-row add-store-calc-row--highlight';
    profitRow.innerHTML = `<span>${t('sourcing.drawer.your_profit_per_sale')}</span><span id="drawer-saler-profit">—</span>`;

    const errorMsg = document.createElement('div');
    errorMsg.className = 'profit-calc__error';
    errorMsg.style.display = 'none';

    calcBox.append(wholesaleRow, netMarginRow, profitRow, errorMsg);

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
        if (isNaN(enteredVal) || enteredVal < wholesaleCost) {
          toast.error(t('sourcing.drawer.error_min_price'));
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
      if (isNaN(enteredPrice) || enteredPrice < wholesaleCost) {
        errorMsg.textContent = `⚠️ ${t('sourcing.drawer.error_min_price')} (${formatCurrency(wholesaleCost)})`;
        errorMsg.style.display = 'flex';
        calcBox.querySelector('#drawer-net-margin').textContent = '—';
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
          productId: activeProduct.ref || activeProduct.id,
        });

        calcBox.querySelector('#drawer-net-margin').textContent = formatCurrency(preview.net_retail_margin);
        calcBox.querySelector('#drawer-saler-profit').textContent = `${formatCurrency(preview.saler_earning)} (${preview.saler_margin_pct}%)`;
      } catch (err) {
        errorMsg.textContent = `⚠️ ${pickMessage(err) || err?.message || t('sourcing.calc.error_invalid_price')}`;
        errorMsg.style.display = 'flex';
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
