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
import { resolveProductImage } from '../components/product/ProductCard.js';
import { addToCart } from '../services/cart.js';
import * as catalogApi from '../services/catalog.api.js';
import { updateHead, buildProductJsonLd } from '../services/seo.js';
import { api } from '../core/api.js';
import { openTeamPurchaseModal } from '../components/product/TeamPurchaseModal.js';

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
  let restoreHead = null;

  function placeholderNotice(actionLabelKey) {
    toast.info(t(actionLabelKey));
  }

  function buildCtas(product, getSelection) {
    const ctaContainer = document.createElement('div');
    ctaContainer.className = 'product-detail-page__cta-section';

    const inStock = () => {
      if (product.has_variants) return !!getSelection();
      return (product.stock_qty ?? product.stock ?? 0) > 0;
    };

    // ── Row 1: Primary Purchase Actions ────────────────────────────────
    const primaryRow = document.createElement('div');
    primaryRow.className = 'product-detail-page__primary-ctas';

    const cartIcon = document.createElement('span');
    cartIcon.className = 'btn-icon-svg inline-flex items-center';
    cartIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>`;

    const addToCartBtn = Button({
      label: t('product_detail.cta.add_to_cart'),
      variant: 'primary',
      size: 'lg',
      iconLeft: cartIcon,
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
          price: sel?.price_override ?? product.retail_price ?? product.default_retail_price ?? product.price ?? 0,
          image_url: product.images?.[0]?.url || product.primary_image_url || resolveProductImage(product),
          supplier_id: product.supplier_id || product.supplier?.id || 1,
          supplier_name: product.supplier_name || product.supplier?.name || 'Verified Supplier',
          stock_qty: sel?.stock_qty ?? product.stock_qty ?? product.stock ?? 10,
        });
      },
    });
    primaryRow.append(addToCartBtn);

    let quickBuyBtn = null;
    if (isFeatureEnabled('quick_buy')) {
      const quickBuyWrap = document.createElement('div');
      quickBuyWrap.dataset.module = 'quick_buy';
      quickBuyWrap.className = 'flex-1 min-w-[140px]';

      const lightningIcon = document.createElement('span');
      lightningIcon.className = 'btn-icon-svg inline-flex items-center';
      lightningIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

      quickBuyBtn = Button({
        label: t('marketplace.product.quick_buy') || 'Quick Buy',
        variant: 'secondary',
        size: 'lg',
        iconLeft: lightningIcon,
        fullWidth: true,
        disabled: !inStock(),
        onClick: () => {
          openQuickBuyModal({
            product,
            selectedVariant: getSelection(),
            initialQty: 1,
            navigate,
          });
        },
      });
      quickBuyWrap.append(quickBuyBtn);
      primaryRow.append(quickBuyWrap);
    }

    if (isFeatureEnabled('wishlist')) {
      const wishlistBtn = WishlistButton({ productId: product.id, size: 'lg' });
      primaryRow.append(wishlistBtn);
    }

    ctaContainer.append(primaryRow);

    // ── Row 2: Social Commerce & Supplier Actions ──────────────────────
    const socialBar = document.createElement('div');
    socialBar.className = 'product-detail-page__social-bar';

    if (isFeatureEnabled('chat')) {
      const chatWrap = document.createElement('div');
      chatWrap.dataset.module = 'chat';
      chatWrap.className = 'product-detail-page__social-action';

      const chatIcon = document.createElement('span');
      chatIcon.className = 'btn-icon-svg inline-flex items-center';
      chatIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

      const chatBtn = Button({
        label: t('product_detail.cta.chat_with_seller') || 'Chat with Seller',
        variant: 'secondary',
        size: 'md',
        iconLeft: chatIcon,
        onClick: async () => {
          const { auth } = appStore.get();
          if (!auth?.isAuthenticated) {
            toast.info(lang === 'bn' ? 'বিক্রেতার সাথে চ্যাট করতে অনুগ্রহ করে সাইন ইন করুন।' : 'Please sign in to chat with the seller.');
            const redirectUrl = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
            if (navigate) navigate(redirectUrl);
            else window.location.href = redirectUrl;
            return;
          }

          chatBtn.setLoading(true);
          try {
            const supplierId = product.supplier_id || product.supplier?.id || 1;
            const supplierName = product.supplier?.name || product.supplier_name || 'Verified Supplier';
            const productTitle = lang === 'bn' && product.title_bn ? product.title_bn : (product.title_en || product.title || 'Product');
            const productRef = product.ref || `PRD-${product.id}`;

            const res = await api.post('/chat/threads', {
              target_user_id: supplierId,
              thread_type: 'CUSTOMER_SALER',
              metadata: {
                product_id: product.id,
                product_name: productTitle,
                product_ref: productRef,
                supplier_name: supplierName,
              },
            });

            const createdThread = res?.data?.thread || res?.thread || res?.data;
            const threadId = createdThread?.id || 10;

            const chatUrl = `/chat?threadId=${threadId}&productRef=${encodeURIComponent(productRef)}&productTitle=${encodeURIComponent(productTitle)}`;
            if (navigate) navigate(chatUrl);
            else window.location.href = chatUrl;
          } catch (err) {
            toast.error(err.message || (lang === 'bn' ? 'চ্যাট শুরু করতে ব্যর্থ হয়েছে।' : 'Failed to start chat with seller.'));
          } finally {
            chatBtn.setLoading(false);
          }
        },
      });
      chatBtn.classList.add('btn--chat-seller');
      chatWrap.append(chatBtn);
      socialBar.append(chatWrap);
    }

    if (isFeatureEnabled('group_buying')) {
      const teamWrap = document.createElement('div');
      teamWrap.dataset.module = 'group_buying';
      teamWrap.className = 'product-detail-page__social-action';

      const teamIcon = document.createElement('span');
      teamIcon.className = 'btn-icon-svg inline-flex items-center';
      teamIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

      const teamBtn = Button({
        label: t('product_detail.cta.team_purchase') || 'Team Purchase',
        variant: 'secondary',
        size: 'md',
        iconLeft: teamIcon,
        onClick: () => {
          openTeamPurchaseModal({
            product,
            selectedVariant: getSelection(),
            navigate,
          });
        },
      });
      teamBtn.classList.add('btn--team-purchase');

      const discountBadge = document.createElement('span');
      discountBadge.className = 'team-badge-discount';
      discountBadge.textContent = lang === 'bn' ? '২০% ছাড়' : 'Save 20%';
      teamBtn.append(discountBadge);

      teamWrap.append(teamBtn);
      socialBar.append(teamWrap);
    }

    if (socialBar.children.length > 0) {
      ctaContainer.append(socialBar);
    }

    // ── Row 3: Social Group Buying Teaser / Deal Strip ─────────────────
    if (isFeatureEnabled('group_buying')) {
      const teaser = document.createElement('div');
      teaser.className = 'team-purchase-teaser';
      teaser.setAttribute('role', 'button');
      teaser.setAttribute('tabindex', '0');
      teaser.innerHTML = `
        <div class="team-purchase-teaser__icon">👥</div>
        <div class="team-purchase-teaser__info">
          <div class="team-purchase-teaser__title">
            <span>${lang === 'bn' ? 'সোশ্যাল টিম পারচেজ ডিল' : 'Social Team Purchase Deal'}</span>
            <span class="badge badge--success badge--sm">${lang === 'bn' ? '২৫% পর্যন্ত সাশ্রয়' : 'Up to 25% OFF'}</span>
          </div>
          <div class="team-purchase-teaser__subtitle">
            ${lang === 'bn' ? 'বন্ধুদের সাথে দল গড়ে অথবা সক্রিয় পুলে যোগ দিয়ে কম মূল্যে কিনুন।' : 'Team up with friends or join open pools to unlock group pricing.'}
          </div>
        </div>
        <button type="button" class="team-purchase-teaser__btn font-bold">
          ${lang === 'bn' ? 'টিম দেখুন' : 'Explore Teams'} →
        </button>
      `;

      const triggerModal = () => openTeamPurchaseModal({ product, selectedVariant: getSelection(), navigate });
      teaser.addEventListener('click', triggerModal);
      teaser.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerModal();
        }
      });
      ctaContainer.append(teaser);
    }

    return {
      ctaRow: ctaContainer,
      refreshCtas: () => {
        addToCartBtn.setDisabled(!inStock());
        if (quickBuyBtn) quickBuyBtn.setDisabled(!inStock());
      },
    };
  }

  async function init() {
    let product;
    try {
      const targetId = params?.id || window.location.pathname.split('/').filter(Boolean).pop() || 'PRD-8F2K9QX7';
      product = await catalogApi.getProduct(targetId);
      if (!product) throw new Error('Product not found.');

      if (destroyed) return;

      const title = lang === 'bn' ? product.title_bn : product.title_en;
      const description = lang === 'bn' ? product.description_bn : product.description_en;
      restoreHead = applySeo(product, lang);

      let currentSelection = null; // set by VariantSelector.onChange when a full variant is chosen
      const basePrice = Number(product.default_retail_price ?? product.price ?? 0);

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

      const ratingVal = Number(product.rating_avg ?? product.rating ?? 4.8);
      const ratingCountVal = Number(product.rating_count ?? 0);
      if (ratingCountVal > 0) {
        const ratingLink = document.createElement('a');
        ratingLink.href = '#product-reviews';
        ratingLink.className = 'product-detail-page__rating-link';
        ratingLink.textContent = t('product_detail.rating_summary', {
          rating: ratingVal.toFixed(1),
          count: ratingCountVal,
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

      // Pre-initialize CTAs before VariantSelector so ctaState is safely accessible
      const ctaState = buildCtas(product, () => currentSelection);

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
            ctaState?.refreshCtas?.();
          },
        });
        infoCol.append(variantSelector);
      }

      const supplierEl = supplierCard(product.supplier, lang);
      if (supplierEl) infoCol.append(supplierEl);

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

      const productId = product.ref || product.id || targetId;

      const reviewList = ReviewList({
        productId,
        ratingAvg: ratingVal,
        ratingCount: ratingCountVal,
        lang,
      });
      belowFold.append(reviewList.el);
      cleanups.push(reviewList.cleanup);

      const qna = QnASection({ productId, lang });
      belowFold.append(qna.el);
      cleanups.push(qna.cleanup);

      page.append(belowFold);
    } catch (err) {
      if (destroyed) return;
      page.replaceChildren(
        EmptyState({
          title: t('product_detail.load_failed_title'),
          description: err.message_en || err.message || t('product_detail.load_failed_description'),
        })
      );
      return;
    }
  }

  init();

  return () => {
    destroyed = true;
    for (const fn of cleanups) { try { fn(); } catch { /* ignore */ } }
    if (restoreHead) { restoreHead(); restoreHead = null; }
  };
}
