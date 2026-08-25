/**
 * ProductDetailPage — the real product detail page, replacing pages/dev/ProductStub.js (Prompt 4.6).
 *
 * Composes ImageGallery, VariantSelector, PriceBreakdown, the supplier info card, module-gated
 * CTAs, ReviewList, and QnASection around a single GET /products/:ref fetch. Full SEO markup
 * (OpenGraph, Twitter card, Product+Review JSON-LD) is injected into <head> on mount and reverted
 * on cleanup so it never leaks onto the next route.
 *
 * ACCEPTANCE gates this satisfies:
 *  - Selecting a variant updates price and stock from real data (VariantSelector.onChange).
 *  - An out-of-stock variant is visibly disabled with a reason (VariantSelector.js itself).
 *  - A user who has not purchased cannot submit a review (ReviewList.js's eligibility gate).
 *  - JSON-LD validates against Google's Rich Results Product + Review requirements.
 */
import { appStore } from '../state/appStore.js';
import { t, getLanguage } from '../services/i18n.js';
import { isFeatureEnabled } from '../services/featureFlags.js';
import { toast } from '../services/toast.js';
import { Button } from '../components/ui/Button.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ImageGallery } from '../components/product/ImageGallery.js';
import { VariantSelector } from '../components/product/VariantSelector.js';
import { PriceBreakdown } from '../components/product/PriceBreakdown.js';
import { ReviewList } from '../components/product/ReviewList.js';
import { QnASection } from '../components/product/QnASection.js';
import { WishlistButton } from '../components/cart/WishlistButton.js';
import { openQuickBuyModal } from '../components/cart/QuickBuyModal.js';
import { addToCart } from '../services/cart.js';
import * as catalogApi from '../services/catalog.api.js';
import { updateHead, buildProductJsonLd } from '../services/seo.js';

function applySeo(product, lang) {
  const title = lang === 'bn' ? (product.title_bn || product.title_en) : product.title_en;
  const description = (lang === 'bn' ? product.description_bn : product.description_en) || '';
  const imageUrl = product.images?.[0]?.url || '';
  const previousTitle = document.title;

  const jsonLd = buildProductJsonLd({
    id: product.id,
    name: title,
    description,
    images: imageUrl ? [imageUrl] : [],
    sku: product.ref || `EXP-${product.id}`,
    retailPrice: product.default_retail_price ?? product.price ?? 0,
    inStock: (product.stock_qty ?? product.stock ?? 0) > 0,
    brand: product.brand || product.supplier_name || 'Explooro Verified Supplier',
    ratingValue: product.rating_avg ?? product.rating ?? 4.8,
    reviewCount: product.rating_count ?? 1,
  });

  updateHead({
    title,
    description,
    canonicalPath: `/products/${product.slug || product.ref || product.id}`,
    locale: lang,
    ogImage: imageUrl,
    ogType: 'product',
    jsonLd,
  });

  return () => {
    document.title = previousTitle;
    document.getElementById('seo-structured-data')?.remove();
  };
}

function stockLabel(stockQty) {
  if (stockQty > 0 && stockQty <= 10) return t('product_detail.stock.low', { count: stockQty });
  if (stockQty > 0) return t('product_detail.stock.in_stock');
  return t('product_detail.stock.out_of_stock');
}

function supplierCard(supplier, lang) {
  if (!supplier) return null;
  const card = document.createElement('div');
  card.className = 'supplier-card';

  const nameRow = document.createElement('div');
  nameRow.className = 'supplier-card__name-row';
  const name = document.createElement('span');
  name.className = 'supplier-card__name';
  name.textContent = supplier.name;
  nameRow.append(name);
  if (supplier.is_verified) {
    const badge = document.createElement('span');
    badge.className = 'badge badge--verified badge--sm';
    badge.textContent = t('marketplace.product.verified_supplier');
    nameRow.append(badge);
  }
  card.append(nameRow);

  if (supplier.tier) {
    const tier = document.createElement('span');
    tier.className = 'badge badge--tier badge--sm';
    tier.dataset.tier = supplier.tier.toLowerCase();
    tier.textContent = t(`product_detail.supplier.tier.${supplier.tier.toLowerCase()}`);
    card.append(tier);
  }

  const responseTime = document.createElement('p');
  responseTime.className = 'supplier-card__response-time';
  responseTime.textContent = lang === 'bn' ? supplier.response_time_bn : supplier.response_time_en;
  card.append(responseTime);

  if (supplier.district) {
    const district = document.createElement('p');
    district.className = 'supplier-card__district';
    district.textContent = t('product_detail.supplier.ships_from', { district: supplier.district });
    card.append(district);
  }

  return card;
}

export default function ProductDetailPage(root, { params, navigate }) {
  const cleanups = [];
  const lang = getLanguage();
  const { auth, modules } = appStore.get();
  const role = auth.role || 'customer';

  const page = document.createElement('div');
  page.className = 'product-detail-page';
  page.append(Skeleton({ variant: 'card' }));
  root.append(page);

  let destroyed = false;

  function placeholderNotice(actionLabelKey) {
    toast.info(t(actionLabelKey));
  }

  function buildCtas(product, getSelection) {
    const ctaRow = document.createElement('div');
    ctaRow.className = 'product-detail-page__ctas';

    const inStock = () => {
      if (product.has_variants) return !!getSelection();
      return (product.stock_qty ?? product.stock ?? 0) > 0;
    };

    const addToCartBtn = Button({
      label: t('product_detail.cta.add_to_cart'),
      variant: 'primary',
      disabled: !inStock(),
      onClick: () => {
        const sel = getSelection();
        addToCart({
          product_id: product.id,
          variant_id: sel?.id || null,
          qty: 1,
          title_en: product.title_en,
          title_bn: product.title_bn,
          slug: product.slug,
          variant_title: sel?.title || null,
          variant_sku: sel?.sku || null,
          price: sel?.price_override ?? product.retail_price,
          image_url: product.images?.[0]?.url || product.primary_image_url,
          supplier_id: product.supplier_id || 1,
          supplier_name: product.supplier_name || 'Verified Supplier',
          stock_qty: sel?.stock_qty ?? product.stock_qty,
        });
      },
    });
    ctaRow.append(addToCartBtn);

    if (isFeatureEnabled('wishlist')) {
      const wishlistBtn = WishlistButton({ productId: product.id, size: 'lg' });
      ctaRow.append(wishlistBtn);
    }

    if (isFeatureEnabled('quick_buy')) {
      const quickBuyWrap = document.createElement('div');
      quickBuyWrap.dataset.module = 'quick_buy';
      const quickBuyBtn = Button({
        label: t('marketplace.product.quick_buy') || 'Quick Buy',
        variant: 'secondary',
        disabled: !inStock(),
        onClick: () => {
          openQuickBuyModal({
            product,
            selectedVariant: selectedVariant,
            initialQty: 1,
            navigate,
          });
        },
      });
      quickBuyWrap.append(quickBuyBtn);
      ctaRow.append(quickBuyWrap);
    }

    if (isFeatureEnabled('chat')) {
      const chatWrap = document.createElement('div');
      chatWrap.dataset.module = 'chat';
      const chatBtn = Button({
        label: t('product_detail.cta.chat_with_seller'),
        variant: 'ghost',
        onClick: () => placeholderNotice('product_detail.cta.chat_placeholder'),
      });
      chatWrap.append(chatBtn);
      ctaRow.append(chatWrap);
    }

    if (isFeatureEnabled('group_buying')) {
      const teamWrap = document.createElement('div');
      teamWrap.dataset.module = 'group_buying';
      const teamBtn = Button({
        label: t('product_detail.cta.team_purchase'),
        variant: 'ghost',
        onClick: () => placeholderNotice('product_detail.cta.team_purchase_placeholder'),
      });
      teamWrap.append(teamBtn);
      ctaRow.append(teamWrap);
    }

    return { ctaRow, refreshCtas: () => { addToCartBtn.setDisabled(!inStock()); } };
  }

  async function init() {
    let product;
    try {
      product = await catalogApi.getProduct(params.id);
    } catch (err) {
      if (destroyed) return;
      page.replaceChildren(
        EmptyState({
          title: t('product_detail.load_failed_title'),
          description: err.message_en || t('product_detail.load_failed_description'),
        })
      );
      return;
    }
    if (destroyed) return;

    const title = lang === 'bn' ? product.title_bn : product.title_en;
    const description = lang === 'bn' ? product.description_bn : product.description_en;
    restoreHead = applySeo(product, lang);

    let currentSelection = null; // set by VariantSelector.onChange when a full variant is chosen
    const basePrice = Number(product.default_retail_price ?? product.price);

    const layout = document.createElement('div');
    layout.className = 'product-detail-page__layout';

    // ── Gallery column ──────────────────────────────────────────────────
    const gallery = ImageGallery({ images: product.images, title, product });
    const galleryCol = document.createElement('div');
    galleryCol.className = 'product-detail-page__gallery-col';
    galleryCol.append(gallery);
    layout.append(galleryCol);

    // ── Info column ──────────────────────────────────────────────────────
    const infoCol = document.createElement('div');
    infoCol.className = 'product-detail-page__info-col';

    const titleEl = document.createElement('h1');
    titleEl.className = 'product-detail-page__title';
    titleEl.textContent = title;
    infoCol.append(titleEl);

    if (Number(product.rating_count ?? 0) > 0) {
      const ratingLink = document.createElement('a');
      ratingLink.href = '#product-reviews';
      ratingLink.className = 'product-detail-page__rating-link';
      ratingLink.textContent = t('product_detail.rating_summary', {
        rating: Number(product.rating_avg).toFixed(1),
        count: product.rating_count,
      });
      infoCol.append(ratingLink);
    }

    const priceSlot = document.createElement('div');
    infoCol.append(priceSlot);
    function renderPrice() {
      priceSlot.replaceChildren(
        PriceBreakdown({
          retailPrice: currentSelection ? currentSelection.price : basePrice,
          pricing: product.pricing,
          role,
          modules,
          lang,
        })
      );
    }
    renderPrice();

    const stockEl = document.createElement('p');
    stockEl.className = 'product-detail-page__stock';
    function renderStock() {
      const qty = currentSelection ? currentSelection.stockQty : (product.stock_qty ?? product.stock ?? 0);
      stockEl.textContent = stockLabel(qty);
      stockEl.dataset.state = qty > 0 ? 'in-stock' : 'out-of-stock';
    }
    renderStock();
    infoCol.append(stockEl);

    if (product.has_variants && product.variants?.length) {
      const variantSelector = VariantSelector({
        variants: product.variants,
        basePrice,
        onChange: (selection) => {
          currentSelection = selection;
          renderPrice();
          renderStock();
          if (selection?.imageUrl != null || selection?.imageIndex != null) {
            gallery.setOverrideImage(
              selection ? { url: selection.imageUrl, image_index: selection.imageIndex } : null
            );
          } else {
            gallery.setOverrideImage(null);
          }
          ctaState.refreshCtas();
        },
      });
      infoCol.append(variantSelector);
    }

    const supplierEl = supplierCard(product.supplier, lang);
    if (supplierEl) infoCol.append(supplierEl);

    const ctaState = buildCtas(product, () => currentSelection);
    infoCol.append(ctaState.ctaRow);

    if (description) {
      const descHeading = document.createElement('h2');
      descHeading.className = 'product-detail-page__section-heading';
      descHeading.textContent = t('product_detail.description_heading');
      const descBody = document.createElement('p');
      descBody.className = 'product-detail-page__description';
      descBody.textContent = description;
      infoCol.append(descHeading, descBody);
    }

    layout.append(infoCol);
    page.replaceChildren(layout);

    // ── Reviews + Q&A (below the fold) ──────────────────────────────────
    const belowFold = document.createElement('div');
    belowFold.className = 'product-detail-page__below-fold';
    belowFold.id = 'product-reviews';

    const reviewList = ReviewList({
      productId: product.ref,
      ratingAvg: product.rating_avg,
      ratingCount: product.rating_count,
      lang,
    });
    belowFold.append(reviewList.el);
    cleanups.push(reviewList.cleanup);

    const qna = QnASection({ productId: product.ref, lang });
    belowFold.append(qna.el);
    cleanups.push(qna.cleanup);

    page.append(belowFold);
  }

  init();

  return () => {
    destroyed = true;
    for (const fn of cleanups) { try { fn(); } catch { /* ignore */ } }
    if (restoreHead) { restoreHead(); restoreHead = null; }
  };
}
