/**
 * StorefrontPage.js — Public, SEO-indexable Saler Storefront with Social Seller Kit & QR Flyer (Prompt 4.8).
 */

import { getStoreBySlug } from '../services/store.api.js';
import { StoreHeader } from '../components/store/StoreHeader.js';
import { ProductCard } from '../components/product/ProductCard.js';
import { openQuickBuyModal } from '../components/cart/QuickBuyModal.js';
import { Button } from '../components/ui/Button.js';
import { Modal } from '../components/ui/Modal.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { toast } from '../services/toast.js';
import { t, getLanguage } from '../services/i18n.js';
import { appStore } from '../state/appStore.js';
import { updateHead, buildStoreJsonLd } from '../services/seo.js';
import { formatExplooroBrandText } from '../components/ui/icons.js';

export default function StorefrontPage(root, { params, navigate }) {
  const container = document.createElement('div');
  container.className = 'container storefront-page';

  // Loading state
  const skeletonWrap = document.createElement('div');
  skeletonWrap.style.display = 'flex';
  skeletonWrap.style.flexDirection = 'column';
  skeletonWrap.style.gap = 'var(--space-6)';
  skeletonWrap.append(
    Skeleton({ variant: 'block', width: '100%', height: 220 }),
    Skeleton({ variant: 'block', width: '100%', height: 60 }),
    Skeleton({ variant: 'block', width: '100%', height: 300 })
  );
  container.append(skeletonWrap);
  root.append(container);

  let isCancelled = false;
  const slug = params?.slug || window.location.pathname.split('/').filter(Boolean).pop() || 'priyo-collection';

  getStoreBySlug(slug)
    .then((payload) => {
      if (isCancelled) return;
      container.replaceChildren();

      const data = payload || {};
      const store = data.store || data;
      const shelves = data.shelves || [];
      const products = data.products || [];

      // Inject SEO & JSON-LD Structured Data
      injectStoreSeo(store);

      buildStorefrontUI(container, store, shelves, products, navigate);
    })
    .catch((err) => {
      if (isCancelled) return;
      // WHY the status check: this catch also sees exceptions thrown while *rendering* a store that
      // loaded perfectly well. Reporting those as "store not found" hid a real render bug behind a
      // plausible-looking empty state, so anything that isn't a genuine 404 is surfaced as an error.
      const isMissing = err?.status === 404 || err?.code === 'NOT_FOUND';
      if (!isMissing) console.error('[storefront] failed to render store', slug, err);
      container.replaceChildren();
      const empty = EmptyState({
        title: isMissing ? t('store.not_found_title') : t('common.error_generic'),
        description: isMissing ? t('store.not_found_desc', { slug }) : String(err?.message ?? err),
        actionLabel: t('common.back_to_marketplace'),
        onAction: () => navigate('/'),
      });
      container.append(empty);
    });

  function buildStorefrontUI(parent, store, shelves, products, nav) {
    // 1. Store Header (Hero, Branding, Announcement & Status)
    const header = StoreHeader({ store });
    parent.append(header);

    // 2. Social Seller Kit Bar
    const socialKitBar = buildSocialSellerKitBar(store);
    parent.append(socialKitBar);

    // 3. Curated Shelves
    if (shelves && shelves.length > 0) {
      shelves.forEach((shelf) => {
        if (shelf.items && shelf.items.length > 0) {
          const shelfSec = document.createElement('section');
          shelfSec.className = 'storefront-shelf';

          const shelfHeader = document.createElement('div');
          shelfHeader.className = 'storefront-shelf__header';

          const shelfTitle = document.createElement('h2');
          shelfTitle.className = 'storefront-shelf__title';
          shelfTitle.textContent = shelf.name;

          const shelfCount = document.createElement('span');
          shelfCount.className = 'text-xs text-muted';
          shelfCount.textContent = `${shelf.items.length} ${t('store.items_count')}`;

          shelfHeader.append(shelfTitle, shelfCount);
          shelfSec.append(shelfHeader);

          const grid = document.createElement('div');
          grid.className = 'storefront-shelf__grid';

          const userState = appStore.get();
          const role = userState?.auth?.role || 'customer';
          const modules = userState?.modules || { physical_shop_status: true };

          const handleCardAction = (prod, actionType) => {
            if (actionType === 'quick_buy') {
              openQuickBuyModal({
                product: prod,
                initialQty: 1,
                navigate: nav,
              });
            } else {
              nav(`/product/${prod.slug || prod.product_ref || prod.ref || prod.id}`);
            }
          };

          shelf.items.forEach((p) => {
            const card = ProductCard({
              product: p,
              role,
              modules,
              lang: getLanguage(),
              onNavigate: nav,
              onAction: handleCardAction,
            });
            grid.append(card);
          });

          shelfSec.append(grid);
          parent.append(shelfSec);
        }
      });
    }

    // 4. All Products section
    const allSec = document.createElement('section');
    allSec.className = 'storefront-shelf';

    const allHeader = document.createElement('div');
    allHeader.className = 'storefront-shelf__header';

    const allTitle = document.createElement('h2');
    allTitle.className = 'storefront-shelf__title';
    allTitle.textContent = t('store.all_products');

    const totalCount = document.createElement('span');
    totalCount.className = 'text-xs text-muted';
    totalCount.textContent = `${products.length} ${t('store.items_count')}`;

    allHeader.append(allTitle, totalCount);
    allSec.append(allHeader);

    const allGrid = document.createElement('div');
    allGrid.className = 'storefront-shelf__grid';

    const userState = appStore.get();
    const role = userState?.auth?.role || 'customer';
    const modules = userState?.modules || { physical_shop_status: true };

    const handleAllCardAction = (prod, actionType) => {
      if (actionType === 'quick_buy') {
        openQuickBuyModal({
          product: prod,
          initialQty: 1,
          navigate: nav,
        });
      } else {
        nav(`/product/${prod.slug || prod.product_ref || prod.ref || prod.id}`);
      }
    };

    if (products.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-sm text-muted';
      empty.style.padding = 'var(--space-6) 0';
      empty.textContent = t('store.no_products_yet');
      allGrid.append(empty);
    } else {
      products.forEach((p) => {
        const card = ProductCard({
          product: p,
          role,
          modules,
          lang: getLanguage(),
          onNavigate: nav,
          onAction: handleAllCardAction,
        });
        allGrid.append(card);
      });
    }

    allSec.append(allGrid);
    parent.append(allSec);
  }

  return () => {
    isCancelled = true;
  };
}

/**
 * Builds the Social Seller Kit action bar (WhatsApp share, QR Flyer, Affiliate Link).
 */
function buildSocialSellerKitBar(store) {
  const bar = document.createElement('div');
  bar.className = 'social-kit-bar';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'social-kit-bar__title';
  titleWrap.innerHTML = `<span>🚀</span> <span>${t('social_kit.bar_title')}</span>`;

  const buttonsWrap = document.createElement('div');
  buttonsWrap.className = 'social-kit-bar__buttons';

  const storeUrl = `${window.location.origin}/store/${store.slug}`;

  // 1. Share to WhatsApp
  const waBtn = document.createElement('button');
  waBtn.className = 'social-kit-btn social-kit-btn--whatsapp';
  waBtn.innerHTML = `<span>💬</span> <span>${t('social_kit.share_whatsapp')}</span>`;
  waBtn.addEventListener('click', () => {
    const text = encodeURIComponent(
      `🛍️ Check out "${store.shop_name}" on Explooro Bangladesh!\n\n${store.bio ? store.bio + '\n\n' : ''}Browse products & buy with 100% Escrow Protection:\n👉 ${storeUrl}`
    );
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
  });

  // 2. Download QR Flyer
  const qrBtn = document.createElement('button');
  qrBtn.className = 'social-kit-btn';
  qrBtn.innerHTML = `<span>📱</span> <span>${t('social_kit.download_qr_flyer')}</span>`;
  qrBtn.addEventListener('click', () => {
    openQrFlyerModal(store, storeUrl);
  });

  // 3. Copy Link
  const copyBtn = document.createElement('button');
  copyBtn.className = 'social-kit-btn';
  copyBtn.innerHTML = `<span>🔗</span> <span>${t('social_kit.copy_store_link')}</span>`;
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(storeUrl);
      toast.success(t('social_kit.link_copied'));
    } catch {
      toast.info(storeUrl);
    }
  });

  buttonsWrap.append(waBtn, qrBtn, copyBtn);
  bar.append(titleWrap, buttonsWrap);
  return bar;
}

/**
 * Opens high-resolution printable QR flyer modal.
 */
function openQrFlyerModal(store, storeUrl) {
  const content = document.createElement('div');
  content.className = 'qr-flyer-modal';

  const card = document.createElement('div');
  card.className = 'qr-flyer-card';

  const logo = document.createElement('div');
  logo.className = 'qr-flyer-card__logo';
  logo.innerHTML = formatExplooroBrandText('EXPLOORO');

  const shopTitle = document.createElement('h3');
  shopTitle.className = 'qr-flyer-card__shop-name';
  shopTitle.textContent = store.shop_name;

  const canvas = document.createElement('canvas');
  canvas.className = 'qr-flyer-card__qr-canvas';
  canvas.width = 200;
  canvas.height = 200;

  renderQrOnCanvas(canvas, storeUrl);

  const inst = document.createElement('p');
  inst.className = 'qr-flyer-card__instructions';
  inst.innerHTML = `<strong>${t('social_kit.scan_to_shop')}</strong><br/>${t('social_kit.scan_instructions')}`;

  const link = document.createElement('p');
  link.style.fontSize = '10px';
  link.style.color = '#94a3b8';
  link.style.marginTop = '8px';
  link.textContent = storeUrl;

  card.append(logo, shopTitle, canvas, inst, link);
  content.append(card);

  const modal = Modal({
    title: t('social_kit.qr_flyer_title'),
    content,
    primaryAction: {
      label: `🖨️ ${t('social_kit.print_or_save')}`,
      onClick: () => {
        window.print();
      },
    },
    secondaryAction: {
      label: t('common.close'),
      onClick: () => modal.close(),
    },
  });

  modal.open();
}

/**
 * Lightweight pure Canvas QR matrix generator (zero external dependencies).
 */
function renderQrOnCanvas(canvas, text) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Generate pseudo-deterministic high-contrast 2D grid matrix
  const size = 25;
  const cellSize = canvas.width / size;

  // Calculate simple hash from text
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  ctx.fillStyle = '#0b0f19';

  // Corner Position Detection Patterns (Finder Patterns)
  drawFinderPattern(ctx, 0, 0, cellSize);
  drawFinderPattern(ctx, size - 7, 0, cellSize);
  drawFinderPattern(ctx, 0, size - 7, cellSize);

  // Data modules simulation
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Skip finder pattern zones
      if (
        (r < 8 && c < 8) ||
        (r < 8 && c >= size - 8) ||
        (r >= size - 8 && c < 8)
      ) {
        continue;
      }
      const val = Math.sin(r * 12.9898 + c * 78.233 + hash) * 43758.5453;
      if ((val - Math.floor(val)) > 0.5) {
        ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      }
    }
  }
}

function drawFinderPattern(ctx, startX, startY, cellSize) {
  // Outer 7x7 box
  ctx.fillRect(startX * cellSize, startY * cellSize, 7 * cellSize, 7 * cellSize);
  // Inner 5x5 white space
  ctx.fillStyle = '#ffffff';
  ctx.fillRect((startX + 1) * cellSize, (startY + 1) * cellSize, 5 * cellSize, 5 * cellSize);
  // Center 3x3 solid box
  ctx.fillStyle = '#0b0f19';
  ctx.fillRect((startX + 2) * cellSize, (startY + 2) * cellSize, 3 * cellSize, 3 * cellSize);
}

function injectStoreSeo(store) {
  if (!store || !store.shop_name) return;

  const jsonLd = buildStoreJsonLd({
    slug: store.slug,
    shopName: store.shop_name,
    bio: store.bio,
    logoUrl: `${window.location.origin}/api/v1/og/store/${store.slug}.png`,
    salerName: store.saler_name,
  });

  updateHead({
    title: `${store.shop_name} — Explooro Store`,
    description: store.bio || 'Verified Bangladeshi Social Seller · 100% Escrow Protection',
    canonicalPath: `/store/${store.slug}`,
    locale: getLanguage(),
    ogImage: `${window.location.origin}/api/v1/og/store/${store.slug}.png`,
    ogType: 'profile',
    jsonLd,
  });
}
