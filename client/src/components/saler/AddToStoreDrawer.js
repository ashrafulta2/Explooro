/**
 * AddToStoreDrawer.js — 1-click Add to Virtual Store drawer (Prompt 4.7).
 *
 * WHY no price field: since migration 085 the supplier sets every price and the partner's share of
 * each sale goes to the monthly partner reward pool, so a partner chooses only the collection. The
 * drawer shows what one sale adds to that pool instead of a per-sale profit.
 */
import { Drawer } from '../ui/Drawer.js';
import { Button } from '../ui/Button.js';
import { FormField } from '../ui/FormField.js';
import { Select } from '../ui/Select.js';
import { toast } from '../../services/toast.js';
import { addToSalerStore } from '../../services/catalog.api.js';
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
 * What one sale of this product adds to the partner reward pool, from whichever shape the caller has.
 * @param {object} product
 * @returns {number|null}
 */
export function poolContributionOf(product) {
  const raw = product?.sourcing_opportunity?.pool_contribution
    ?? product?.partner_profit
    ?? product?.pricing?.saler_earning;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Creates the Add to Store Drawer instance.
 *
 * @param {object} props
 * @param {Function} [props.onSuccess] Callback when item is successfully added to store
 * @returns {HTMLDialogElement & { openForProduct: Function }}
 */
export function AddToStoreDrawer({ onSuccess = null } = {}) {
  let activeProduct = null;
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

  function row(label, value, highlight = false) {
    const el = document.createElement('div');
    el.className = highlight ? 'add-store-calc-row add-store-calc-row--highlight' : 'add-store-calc-row';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('strong');
    v.textContent = value;
    el.append(l, v);
    return el;
  }

  function renderContent() {
    contentWrap.innerHTML = '';
    if (!activeProduct) return;

    const isBn = getLanguage() === 'bn';
    const title = (isBn && activeProduct.title_bn) ? activeProduct.title_bn : (activeProduct.title_en || activeProduct.title);
    const price = Number(activeProduct.pricing?.retail_price ?? activeProduct.default_retail_price ?? activeProduct.price ?? 0);
    const contribution = poolContributionOf(activeProduct);

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
    pMeta.textContent = `${t('sourcing.drawer.price')}: ${formatCurrency(price)} • ${t('sourcing.drawer.stock')}: ${activeProduct.stock ?? activeProduct.stock_qty ?? 0}`;

    infoBox.append(pTitle, pMeta);
    previewBox.append(imgBox, infoBox);

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

    const calcBox = document.createElement('div');
    calcBox.className = 'add-store-calc-preview';
    calcBox.append(row(t('sourcing.drawer.price_locked'), formatCurrency(price)));
    if (contribution != null) {
      calcBox.append(row(t('sourcing.drawer.pool_per_sale'), formatCurrency(contribution), true));
    }
    const explainer = document.createElement('p');
    explainer.className = 'add-store-pool-note';
    explainer.textContent = t('sourcing.drawer.pool_explainer');
    calcBox.append(explainer);

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
        const sel = collectionField.querySelector('select');
        const collection = sel ? sel.value : 'General';

        isSubmitting = true;
        submitBtn.setLoading(true);

        try {
          const item = await addToSalerStore({
            productId: activeProduct.ref || activeProduct.id,
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
    contentWrap.append(previewBox, collectionField, calcBox, actions);
  }

  drawer.openForProduct = (product, triggerEl = null) => {
    activeProduct = product;
    renderContent();
    drawer.openDrawer(triggerEl);
  };

  return drawer;
}
