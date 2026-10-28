/**
 * AddToStoreDrawer.ts — 1-click Add to Virtual Store drawer (Prompt 4.7).
 *
 * WHY no price field: since migration 085 the supplier sets every price and the partner's share of
 * each sale goes to the monthly partner reward pool, so a partner chooses only the collection. The
 * drawer shows what one sale adds to that pool instead of a per-sale profit.
 */
import { Drawer } from '../ui/Drawer.ts';
import type { DrawerElement } from '../ui/Drawer.ts';
import { Button } from '../ui/Button.ts';
import { FormField } from '../ui/FormField.ts';
import { Select } from '../ui/Select.ts';
import { toast } from '../../services/toast.ts';
import { addToSalerStore } from '../../services/catalog.api.ts';
import { formatCurrency } from '../../services/format.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { resolveProductImage } from '../product/ProductCard.ts';

/** A product as the sourcing catalog, the product page or a store item carries it. */
export interface StoreProduct {
  id?: number | string;
  ref?: string;
  title?: string;
  title_en?: string;
  title_bn?: string;
  price?: number | string;
  default_retail_price?: number | string;
  stock?: number;
  stock_qty?: number;
  partner_profit?: number | string | null;
  pricing?: { retail_price?: number | string; saler_earning?: number | string };
  sourcing_opportunity?: { pool_contribution?: number | string };
  [field: string]: unknown;
}

/** The drawer, plus the entry point callers use. */
export interface AddToStoreDrawerElement extends DrawerElement {
  openForProduct(product: StoreProduct, trigger?: Element | null): void;
}

const COLLECTIONS = [
  { value: 'General', label_en: 'General', label_bn: 'সাধারণ' },
  { value: 'Featured', label_en: 'Featured', label_bn: 'বিশেষ কালেকশন' },
  { value: 'Trending', label_en: 'Trending', label_bn: 'জনপ্রিয়' },
  { value: 'New Arrival', label_en: 'New Arrivals', label_bn: 'নতুন আগমন' },
];

/**
 * What one sale of this product adds to the partner reward pool, from whichever shape the caller has.
 */
export function poolContributionOf(product: StoreProduct | null | undefined): number | null {
  const raw = product?.sourcing_opportunity?.pool_contribution
    ?? product?.partner_profit
    ?? product?.pricing?.saler_earning;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Creates the Add to Store Drawer instance. `onSuccess` is called with the added store item.
 */
export function AddToStoreDrawer({ onSuccess = null }: { onSuccess?: ((item: unknown) => void) | null } = {}): AddToStoreDrawerElement {
  let activeProduct: StoreProduct | null = null;
  let isSubmitting = false;

  const contentWrap = document.createElement('div');
  contentWrap.className = 'add-store-form';

  const drawer = Drawer({
    title: t('sourcing.drawer.title'),
    description: t('sourcing.drawer.description'),
    content: contentWrap,
    side: 'right',
    size: 'md',
  }) as AddToStoreDrawerElement;

  function row(label: string, value: string, highlight = false) {
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

  drawer.openForProduct = (product: StoreProduct, triggerEl: Element | null = null) => {
    activeProduct = product;
    renderContent();
    drawer.openDrawer(triggerEl);
  };

  return drawer;
}
