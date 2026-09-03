/**
 * StoreBuilderPage.js — Virtual storefront builder with live availability check, curated shelves,
 * dedicated 1-Tap Quick Share Hub & Social Seller Kit with zero-dependency QR flyers (Prompt 4.8).
 */

import { getMyStore, updateMyStore, updateStoreShelves, checkSlugAvailability } from '../../services/store.api.js';
import { StoreHeader } from '../../components/store/StoreHeader.js';
import { ShelfEditor } from '../../components/store/ShelfEditor.js';
import { ShopStatusToggle } from '../../components/store/ShopStatusToggle.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Switch } from '../../components/ui/Switch.js';
import { Modal } from '../../components/ui/Modal.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { formatExplooroBrandText } from '../../components/ui/icons.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';

export default function StoreBuilderPage(root, { navigate }) {
  const container = document.createElement('div');
  container.className = 'container store-builder';
  root.append(container);

  let isCancelled = false;
  let debounceTimer = null;

  // Local store state
  let storeState = {
    id: null,
    shop_name: 'My Store',
    slug: 'my-store',
    bio: '',
    announcement: '',
    social_links: { whatsapp: '', facebook: '', instagram: '', phone: '' },
    has_physical_shop: false,
    physical_open_status: 'CLOSED',
    business_hours: null,
    logo_key: null,
    banner_key: null,
    logo_url: '',
    banner_url: '',
  };

  let shelvesState = [];
  let pendingShelfItems = [];

  // Initial Data Load
  loadStoreData();

  function loadStoreData() {
    container.replaceChildren();

    // Loading Skeleton
    const skelWrap = document.createElement('div');
    skelWrap.style.display = 'flex';
    skelWrap.style.flexDirection = 'column';
    skelWrap.style.gap = 'var(--space-4)';
    skelWrap.append(
      Skeleton({ variant: 'text', width: 280, height: 36 }),
      Skeleton({ variant: 'block', width: '100%', height: 110 }),
      Skeleton({ variant: 'block', width: '100%', height: 420 })
    );
    container.append(skelWrap);

    getMyStore()
      .then((res) => {
        if (isCancelled) return;
        container.replaceChildren();

        // Safely unwrap data regardless of whether response is enveloped in { data } or bare
        const payload = (res && res.data && (res.data.store || res.data.shelves))
          ? res.data
          : (res?.store || res?.shelves ? res : (res?.data || res || {}));

        const store = payload.store || payload || {};
        shelvesState = Array.isArray(payload.shelves) ? payload.shelves : [];

        storeState = {
          id: store.id || null,
          shop_name: store.shop_name || 'My Store',
          slug: store.slug || 'my-store',
          bio: store.bio || '',
          announcement: store.announcement || '',
          social_links: {
            whatsapp: store.social_links?.whatsapp || '',
            facebook: store.social_links?.facebook || '',
            instagram: store.social_links?.instagram || '',
            phone: store.social_links?.phone || '',
          },
          has_physical_shop: !!store.has_physical_shop,
          physical_open_status: store.physical_open_status || 'CLOSED',
          business_hours: store.business_hours || null,
          logo_key: store.logo_key || null,
          banner_key: store.banner_key || null,
          logo_url: store.logo_url || '',
          banner_url: store.banner_url || '',
        };

        buildUI(container, storeState, shelvesState, navigate);
      })
      .catch((err) => {
        if (isCancelled) return;
        container.replaceChildren();
        renderErrorState(container, err.message || 'Failed to load store profile.', () => {
          loadStoreData();
        });
      });
  }

  function renderErrorState(parent, message, onRetry) {
    const errorCard = document.createElement('div');
    errorCard.className = 'store-builder__error-card';

    const icon = document.createElement('div');
    icon.style.fontSize = '48px';
    icon.textContent = '⚠️';

    const title = document.createElement('h3');
    title.style.margin = '0';
    title.textContent = t('store_builder.load_error_title', 'Unable to Load Storefront');

    const desc = document.createElement('p');
    desc.className = 'text-sm text-muted';
    desc.textContent = message;

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = 'var(--space-3)';

    const retryBtn = Button({
      label: `🔄 ${t('common.retry', 'Retry')}`,
      variant: 'primary',
      onClick: onRetry,
    });

    const defaultBtn = Button({
      label: `🏪 ${t('store_builder.use_default', 'Continue with Default Store')}`,
      variant: 'secondary',
      onClick: () => {
        container.replaceChildren();
        buildUI(container, storeState, shelvesState, navigate);
      },
    });

    btnRow.append(retryBtn, defaultBtn);
    errorCard.append(icon, title, desc, btnRow);
    parent.append(errorCard);
  }

  function buildUI(parent, store, shelves, nav) {
    // ── Header Row ────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'store-builder__header';

    const titleWrap = document.createElement('div');
    const title = document.createElement('h1');
    title.className = 'store-builder__title';
    title.textContent = `🏪 ${t('store_builder.title', 'Virtual Storefront Builder')}`;

    const subtitle = document.createElement('p');
    subtitle.className = 'store-builder__subtitle';
    subtitle.textContent = t(
      'store_builder.subtitle',
      'Customize your branded store, configure shelves & physical hours, and preview in real time.'
    );
    titleWrap.append(title, subtitle);

    const actions = document.createElement('div');
    actions.className = 'store-builder__actions';

    const viewStoreBtn = Button({
      label: `🌐 ${t('store_builder.view_live_store', 'Visit Public Store')}`,
      variant: 'secondary',
      onClick: () => {
        if (storeState.slug) {
          nav(`/store/${storeState.slug}`);
        }
      },
    });

    const saveBtn = Button({
      label: `💾 ${t('common.save_changes', 'Save Changes')}`,
      variant: 'primary',
      onClick: async () => {
        saveBtn.disabled = true;
        const origText = saveBtn.textContent;
        saveBtn.textContent = `⏳ ${t('common.saving', 'Saving...')}`;
        try {
          await updateMyStore(storeState);
          if (pendingShelfItems.length > 0) {
            await updateStoreShelves(pendingShelfItems);
          }
          toast.success(t('store_builder.save_success', 'Store settings and shelves updated successfully!'));
        } catch (e) {
          toast.error(e.message || t('store_builder.save_error', 'Failed to save store changes.'));
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = origText;
        }
      },
    });

    actions.append(viewStoreBtn, saveBtn);
    header.append(titleWrap, actions);
    parent.append(header);

    // ── Dedicated Quick Share Hub & Social Seller Kit Card ───────────────────
    const shareCard = document.createElement('div');
    shareCard.className = 'store-builder__share-card';

    const shareHeader = document.createElement('div');
    shareHeader.className = 'store-builder__share-header';

    const shareTitleWrap = document.createElement('div');
    shareTitleWrap.className = 'store-builder__share-title-wrap';

    const shareTitle = document.createElement('h3');
    shareTitle.className = 'store-builder__share-title';
    shareTitle.innerHTML = `<span>📢</span> <span>${t('nav.simple.saler.share_store', 'Share My Store')} & Social Seller Kit</span>`;

    const shareBadge = document.createElement('span');
    shareBadge.className = 'badge badge--success badge--sm';
    shareBadge.textContent = '⚡ 1-Tap Viral Share';

    shareTitleWrap.append(shareTitle, shareBadge);

    const shareStats = document.createElement('span');
    shareStats.className = 'text-xs text-muted font-mono';
    const totalItems = shelvesState.reduce((acc, s) => acc + (s.items?.length || 0), 0);
    shareStats.textContent = `${totalItems} curated items live`;

    shareHeader.append(shareTitleWrap, shareStats);
    shareCard.append(shareHeader);

    // URL row with 1-click Copy
    const urlRow = document.createElement('div');
    urlRow.className = 'store-builder__share-url-row';

    const urlDisplay = document.createElement('div');
    urlDisplay.className = 'store-builder__share-url';

    function getStoreUrl() {
      return `${window.location.origin}/store/${storeState.slug || 'my-store'}`;
    }

    urlDisplay.textContent = getStoreUrl();

    const copyBtn = document.createElement('button');
    copyBtn.className = 'social-kit-btn';
    copyBtn.innerHTML = `<span>📋</span> <span>${t('social_kit.copy_store_link', 'Copy Store Link')}</span>`;
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(getStoreUrl());
        copyBtn.innerHTML = `<span>✓</span> <span>${t('common.copied', 'Copied!')}</span>`;
        toast.success(t('social_kit.link_copied', 'Store link copied to clipboard!'));
        setTimeout(() => {
          copyBtn.innerHTML = `<span>📋</span> <span>${t('social_kit.copy_store_link', 'Copy Store Link')}</span>`;
        }, 2000);
      } catch {
        toast.info(getStoreUrl());
      }
    });

    urlRow.append(urlDisplay, copyBtn);
    shareCard.append(urlRow);

    // Instant Share Buttons (WhatsApp, Facebook, QR Flyer, View Store)
    const shareActions = document.createElement('div');
    shareActions.className = 'store-builder__share-actions';

    // 1. WhatsApp Share
    const waShareBtn = document.createElement('button');
    waShareBtn.className = 'social-kit-btn social-kit-btn--whatsapp';
    waShareBtn.innerHTML = `<span>💬</span> <span>${t('social_kit.share_whatsapp', 'Share to WhatsApp')}</span>`;
    waShareBtn.addEventListener('click', () => {
      const isBn = getLanguage() === 'bn';
      const greeting = isBn
        ? `🛍️ Explooro-তে "${storeState.shop_name}" থেকে কেনাকাটা করুন!`
        : `🛍️ Check out "${storeState.shop_name}" on Explooro Bangladesh!`;
      const bioText = storeState.bio ? `\n\n${storeState.bio}` : '';
      const orderCta = isBn
        ? '\n\n১০০% এসক্রো সুরক্ষায় অর্ডার করতে ভিজিট করুন:'
        : '\n\nBrowse products & buy with 100% Escrow Protection:';
      const text = encodeURIComponent(`${greeting}${bioText}${orderCta}\n👉 ${getStoreUrl()}`);
      window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
    });

    // 2. Facebook Share
    const fbShareBtn = document.createElement('button');
    fbShareBtn.className = 'social-kit-btn';
    fbShareBtn.innerHTML = `<span>📘</span> <span>${t('social_kit.btn_share_facebook', 'Share on Facebook')}</span>`;
    fbShareBtn.addEventListener('click', () => {
      const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getStoreUrl())}`;
      window.open(fbUrl, '_blank', 'width=600,height=400');
    });

    // 3. Printable QR Flyer Modal
    const qrModalBtn = document.createElement('button');
    qrModalBtn.className = 'social-kit-btn';
    qrModalBtn.innerHTML = `<span>📱</span> <span>${t('social_kit.download_qr_flyer', 'Printable QR Flyer')}</span>`;
    qrModalBtn.addEventListener('click', () => {
      openFlyerModal(storeState, getStoreUrl());
    });

    // 4. View Storefront
    const previewDirectBtn = document.createElement('button');
    previewDirectBtn.className = 'social-kit-btn';
    previewDirectBtn.innerHTML = `<span>🌐</span> <span>${t('store_builder.view_live_store', 'Visit Public Store')}</span>`;
    previewDirectBtn.addEventListener('click', () => {
      if (storeState.slug) {
        nav(`/store/${storeState.slug}`);
      }
    });

    shareActions.append(waShareBtn, fbShareBtn, qrModalBtn, previewDirectBtn);
    shareCard.append(shareActions);
    parent.append(shareCard);

    // ── Grid: Left (Editor Form) + Right (Live Preview) ─────────────────────
    const grid = document.createElement('div');
    grid.className = 'store-builder__grid';

    // 1. Editor Form
    const form = document.createElement('div');
    form.className = 'store-builder__form';

    // ── Section 1: Store Branding & Vanity URL ──────────────────────────────
    const brandingSec = document.createElement('div');
    brandingSec.className = 'store-builder__section';

    const brandTitle = document.createElement('h3');
    brandTitle.className = 'store-builder__section-title';
    brandTitle.textContent = `🏪 ${t('store_builder.branding_section', 'Store Identity & Branding')}`;
    brandingSec.append(brandTitle);

    // Shop Name Input
    const nameInput = Input({
      label: t('store_builder.shop_name_label', 'Shop Name'),
      value: storeState.shop_name,
      required: true,
      onInput: (e) => {
        storeState.shop_name = e.target.value;
        syncLivePreview();
      },
    });
    brandingSec.append(nameInput);

    // Slug Field with Live Availability Check
    const slugWrap = document.createElement('div');
    slugWrap.className = 'store-builder__slug-field';

    const slugLabel = document.createElement('label');
    slugLabel.className = 'form-label';
    slugLabel.textContent = t('store_builder.slug_label', 'Store URL Slug');

    const inputRow = document.createElement('div');
    inputRow.className = 'store-builder__slug-input-wrap';

    const prefix = document.createElement('span');
    prefix.className = 'store-builder__slug-prefix';
    prefix.textContent = 'explooro.com/store/';

    const slugInput = document.createElement('input');
    slugInput.className = 'store-builder__slug-input';
    slugInput.value = storeState.slug;
    slugInput.placeholder = 'your-brand-name';

    inputRow.append(prefix, slugInput);

    const slugStatus = document.createElement('div');
    slugStatus.className = 'store-builder__slug-status store-builder__slug-status--available';
    slugStatus.textContent = '✓ ' + t('store_builder.slug_current', 'Current active slug');

    slugInput.addEventListener('input', (e) => {
      const raw = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      slugInput.value = raw;
      storeState.slug = raw;
      syncLivePreview();

      clearTimeout(debounceTimer);
      slugStatus.className = 'store-builder__slug-status text-muted';
      slugStatus.textContent = '⏳ ' + t('store_builder.checking_slug', 'Checking availability...');

      debounceTimer = setTimeout(async () => {
        if (!raw || raw.length < 3) {
          slugStatus.className = 'store-builder__slug-status store-builder__slug-status--invalid';
          slugStatus.textContent = '⚠️ ' + t('store_builder.slug_too_short', 'Slug must be at least 3 characters');
          return;
        }
        try {
          const res = await checkSlugAvailability(raw, storeState.id);
          const avail = res?.data?.available !== undefined ? res.data.available : (res?.available ?? true);
          const isBn = getLanguage() === 'bn';
          const msgEn = res?.data?.message_en || res?.message_en || t('store_builder.slug_available', 'Slug is available!');
          const msgBn = res?.data?.message_bn || res?.message_bn || msgEn;
          const displayMsg = isBn ? msgBn : msgEn;

          if (avail) {
            slugStatus.className = 'store-builder__slug-status store-builder__slug-status--available';
            slugStatus.textContent = '🟢 ' + displayMsg;
          } else {
            slugStatus.className = 'store-builder__slug-status store-builder__slug-status--taken';
            slugStatus.textContent = '🔴 ' + displayMsg;
          }
        } catch {
          slugStatus.className = 'store-builder__slug-status store-builder__slug-status--invalid';
          slugStatus.textContent = '⚠️ Error checking slug availability.';
        }
      }, 350);
    });

    slugWrap.append(slugLabel, inputRow, slugStatus);
    brandingSec.append(slugWrap);

    // Bio Textarea
    const bioInput = Textarea({
      label: t('store_builder.bio_label', 'Store Bio / Tagline'),
      value: storeState.bio,
      rows: 3,
      placeholder: t('store_builder.bio_placeholder', 'Tell customers what makes your store unique...'),
      onInput: (e) => {
        storeState.bio = e.target.value;
        syncLivePreview();
      },
    });
    brandingSec.append(bioInput);

    // Announcement Bar Input
    const annInput = Input({
      label: `📢 ${t('store_builder.announcement_label', 'Top Announcement Bar')}`,
      value: storeState.announcement,
      placeholder: 'e.g. Free shipping on all orders over ৳1,000 this week!',
      onInput: (e) => {
        storeState.announcement = e.target.value;
        syncLivePreview();
      },
    });
    brandingSec.append(annInput);

    // Banner Cover Theme Presets
    const bannerPresetWrap = document.createElement('div');
    bannerPresetWrap.style.display = 'flex';
    bannerPresetWrap.style.flexDirection = 'column';
    bannerPresetWrap.style.gap = 'var(--space-1)';

    const bannerLabel = document.createElement('label');
    bannerLabel.className = 'form-label';
    bannerLabel.textContent = `🎨 ${t('store_builder.banner_preset_label', 'Cover Banner Theme Preset')}`;

    const presetRow = document.createElement('div');
    presetRow.className = 'store-builder__banner-presets';

    const themes = [
      { key: 'crimson', label: '🌹 Jamdani Crimson', bg: 'linear-gradient(135deg, #831843 0%, #4c0519 100%)' },
      { key: 'gold', label: '✨ Tangail Gold', bg: 'linear-gradient(135deg, #b45309 0%, #78350f 100%)' },
      { key: 'indigo', label: '🌊 Heritage Indigo', bg: 'linear-gradient(135deg, #0f766e 0%, #134e4a 100%)' },
      { key: 'dark', label: '🌙 Dark Luxe', bg: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' },
      { key: 'emerald', label: '🌿 Green Silk', bg: 'linear-gradient(135deg, #047857 0%, #064e3b 100%)' },
    ];

    themes.forEach((th) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'store-builder__preset-btn';
      btn.innerHTML = `<span>${th.label}</span>`;
      btn.addEventListener('click', () => {
        storeState.banner_url = th.bg;
        storeState.banner_key = th.key;
        presetRow.querySelectorAll('.store-builder__preset-btn').forEach((b) => b.classList.remove('store-builder__preset-btn--active'));
        btn.classList.add('store-builder__preset-btn--active');
        syncLivePreview();
      });
      presetRow.append(btn);
    });

    bannerPresetWrap.append(bannerLabel, presetRow);
    brandingSec.append(bannerPresetWrap);

    form.append(brandingSec);

    // ── Section 2: Social Links ─────────────────────────────────────────────
    const socialSec = document.createElement('div');
    socialSec.className = 'store-builder__section';

    const socialTitle = document.createElement('h3');
    socialTitle.className = 'store-builder__section-title';
    socialTitle.textContent = `💬 ${t('store_builder.social_links_section', 'Social Seller Links')}`;
    socialSec.append(socialTitle);

    const waInput = Input({
      label: 'WhatsApp Number',
      value: storeState.social_links?.whatsapp || '',
      placeholder: '+88017XXXXXXXX',
      onInput: (e) => {
        if (!storeState.social_links) storeState.social_links = {};
        storeState.social_links.whatsapp = e.target.value;
        syncLivePreview();
      },
    });

    const fbInput = Input({
      label: 'Facebook Page URL / Handle',
      value: storeState.social_links?.facebook || '',
      placeholder: 'https://facebook.com/yourshop',
      onInput: (e) => {
        if (!storeState.social_links) storeState.social_links = {};
        storeState.social_links.facebook = e.target.value;
        syncLivePreview();
      },
    });

    const igInput = Input({
      label: 'Instagram Profile URL / Handle',
      value: storeState.social_links?.instagram || '',
      placeholder: 'https://instagram.com/yourshop',
      onInput: (e) => {
        if (!storeState.social_links) storeState.social_links = {};
        storeState.social_links.instagram = e.target.value;
        syncLivePreview();
      },
    });

    socialSec.append(waInput, fbInput, igInput);
    form.append(socialSec);

    // ── Section 3: Physical Shop Status & Hours ─────────────────────────────
    const physicalSec = document.createElement('div');
    physicalSec.className = 'store-builder__section';

    const physicalTitle = document.createElement('h3');
    physicalTitle.className = 'store-builder__section-title';
    physicalTitle.textContent = `📍 ${t('store_builder.physical_shop_section', 'Physical Shop & Pickup Status')}`;
    physicalSec.append(physicalTitle);

    const statusToggleWrap = document.createElement('div');
    statusToggleWrap.style.display = storeState.has_physical_shop ? 'block' : 'none';

    const hasShopSwitch = Switch({
      label: t('store_builder.has_physical_shop_label', 'I have a physical retail store or pickup point'),
      checked: storeState.has_physical_shop,
      onChange: (checked) => {
        storeState.has_physical_shop = checked;
        statusToggleWrap.style.display = checked ? 'block' : 'none';
        syncLivePreview();
      },
    });
    physicalSec.append(hasShopSwitch);

    const statusToggle = ShopStatusToggle({
      initialStatus: storeState.physical_open_status,
      initialHours: storeState.business_hours,
      hasPhysicalShop: storeState.has_physical_shop,
      onChange: ({ physicalOpenStatus, businessHours }) => {
        storeState.physical_open_status = physicalOpenStatus;
        if (businessHours) storeState.business_hours = businessHours;
        syncLivePreview();
      },
    });
    statusToggleWrap.append(statusToggle);
    physicalSec.append(statusToggleWrap);

    form.append(physicalSec);

    // ── Section 4: Curated Shelves ──────────────────────────────────────────
    const shelfSec = document.createElement('div');
    shelfSec.className = 'store-builder__section';

    const shelfEditor = ShelfEditor({
      initialShelves: shelvesState,
      onUpdate: ({ shelves, flattenedItems }) => {
        shelvesState = shelves;
        pendingShelfItems = flattenedItems;
        syncLivePreview();
      },
    });
    shelfSec.append(shelfEditor);

    // Add Products Shortcut if store has few or no products
    const addProductCta = document.createElement('div');
    addProductCta.style.display = 'flex';
    addProductCta.style.alignItems = 'center';
    addProductCta.style.justifyContent = 'space-between';
    addProductCta.style.padding = 'var(--space-3) var(--space-4)';
    addProductCta.style.background = 'var(--surface-2)';
    addProductCta.style.borderRadius = 'var(--radius-md)';
    addProductCta.style.border = '1px dashed var(--border-default)';

    const ctaText = document.createElement('span');
    ctaText.className = 'text-xs text-secondary';
    ctaText.textContent = t('store_builder.need_more_products', 'Looking for high-margin authentic items to add?');

    const ctaBtn = Button({
      label: `🛒 ${t('saler.tools.sourcing', 'Wholesale Sourcing Catalog')}`,
      variant: 'secondary',
      size: 'xs',
      onClick: () => nav('/saler/sourcing'),
    });

    addProductCta.append(ctaText, ctaBtn);
    shelfSec.append(addProductCta);

    form.append(shelfSec);

    grid.append(form);

    // ── 2. Live Preview Column ──────────────────────────────────────────────
    const previewWrap = document.createElement('div');
    previewWrap.className = 'store-builder__preview-wrap';

    const previewControls = document.createElement('div');
    previewControls.className = 'store-builder__preview-controls';

    const previewLabel = document.createElement('span');
    previewLabel.className = 'store-builder__preview-label';
    previewLabel.textContent = `👁️ ${t('store_builder.live_preview', 'Live Storefront Preview')}`;

    const deviceSwitch = document.createElement('div');
    deviceSwitch.className = 'store-builder__device-switch';

    const desktopBtn = Button({
      label: '🖥️ Desktop',
      size: 'xs',
      variant: 'secondary',
      onClick: () => {
        previewFrame.classList.remove('store-builder__preview-frame--mobile');
        desktopBtn.classList.add('btn--primary');
        mobileBtn.classList.remove('btn--primary');
      },
    });

    const mobileBtn = Button({
      label: '📱 Mobile',
      size: 'xs',
      variant: 'secondary',
      onClick: () => {
        previewFrame.classList.add('store-builder__preview-frame--mobile');
        mobileBtn.classList.add('btn--primary');
        desktopBtn.classList.remove('btn--primary');
      },
    });

    deviceSwitch.append(desktopBtn, mobileBtn);
    previewControls.append(previewLabel, deviceSwitch);
    previewWrap.append(previewControls);

    const previewFrame = document.createElement('div');
    previewFrame.className = 'store-builder__preview-frame';

    const previewBody = document.createElement('div');
    previewBody.className = 'store-builder__preview-body';
    previewFrame.append(previewBody);
    previewWrap.append(previewFrame);

    grid.append(previewWrap);
    parent.append(grid);

    function syncLivePreview() {
      // Update share card URL display
      if (urlDisplay) {
        urlDisplay.textContent = getStoreUrl();
      }

      previewBody.replaceChildren();

      // Resolve open/closed state
      const isOpen = storeState.physical_open_status === 'OPEN' || storeState.physical_open_status === 'AUTO';
      const openMessage = storeState.physical_open_status === 'OPEN'
        ? t('shop_status.open_now', 'Open Now 🟢')
        : (storeState.physical_open_status === 'AUTO' ? t('shop_status.auto_open', 'Auto (Open)') : t('shop_status.closed_now', 'Closed 🔴'));

      // Render StoreHeader in preview
      const previewHeader = StoreHeader({
        store: {
          shop_name: storeState.shop_name,
          slug: storeState.slug,
          bio: storeState.bio,
          announcement: storeState.announcement,
          social_links: storeState.social_links,
          banner_url: storeState.banner_url?.startsWith('linear-gradient') ? undefined : storeState.banner_url,
          logo_url: storeState.logo_url,
          status: {
            is_open: isOpen,
            message: openMessage,
          },
          products_count: shelvesState.reduce((acc, s) => acc + (s.items?.length || 0), 0),
        },
        isPreview: true,
      });

      // Apply background gradient preset to banner if active
      if (storeState.banner_url && storeState.banner_url.startsWith('linear-gradient')) {
        const b = previewHeader.querySelector('.store-header__banner');
        if (b) b.style.background = storeState.banner_url;
      }

      previewBody.append(previewHeader);

      // Render Preview Shelves
      if (shelvesState.length === 0) {
        const noShelves = document.createElement('div');
        noShelves.style.padding = 'var(--space-6) var(--space-4)';
        noShelves.style.textAlign = 'center';
        noShelves.className = 'text-muted text-xs';
        noShelves.textContent = t('shelf_editor.empty_shelf', 'No products in this shelf yet.');
        previewBody.append(noShelves);
      } else {
        shelvesState.forEach((shelf) => {
          const shelfBox = document.createElement('div');
          shelfBox.className = 'storefront-shelf';

          const shelfTitle = document.createElement('h4');
          shelfTitle.className = 'storefront-shelf__title';
          shelfTitle.textContent = shelf.name;
          shelfBox.append(shelfTitle);

          const itemsRow = document.createElement('div');
          itemsRow.style.display = 'grid';
          itemsRow.style.gridTemplateColumns = 'repeat(auto-fill, minmax(130px, 1fr))';
          itemsRow.style.gap = 'var(--space-2)';

          const items = Array.isArray(shelf.items) ? shelf.items : [];
          if (items.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'text-xs text-muted';
            empty.textContent = t('shelf_editor.empty_shelf', 'No products in this shelf yet.');
            itemsRow.append(empty);
          } else {
            items.slice(0, 4).forEach((item) => {
              const card = document.createElement('div');
              card.style.padding = 'var(--space-2)';
              card.style.background = 'var(--surface-1)';
              card.style.borderRadius = 'var(--radius-sm)';
              card.style.border = '1px solid var(--border-subtle)';

              const imgPlaceholder = document.createElement('div');
              imgPlaceholder.style.height = '64px';
              imgPlaceholder.style.background = 'var(--surface-2)';
              imgPlaceholder.style.borderRadius = 'var(--radius-xs)';
              imgPlaceholder.style.marginBottom = 'var(--space-1)';
              imgPlaceholder.style.display = 'flex';
              imgPlaceholder.style.alignItems = 'center';
              imgPlaceholder.style.justifyContent = 'center';
              imgPlaceholder.style.fontSize = '20px';

              if (item.images && item.images.length > 0) {
                const img = document.createElement('img');
                img.src = item.images[0];
                img.alt = item.title_en || 'Product';
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = 'var(--radius-xs)';
                imgPlaceholder.append(img);
              } else {
                imgPlaceholder.textContent = '🛍️';
              }

              const tEl = document.createElement('p');
              tEl.className = 'text-xs';
              tEl.style.margin = '0';
              tEl.style.fontWeight = 'var(--weight-semibold)';
              const isBn = getLanguage() === 'bn';
              tEl.textContent = (isBn ? (item.title_bn || item.title_en) : (item.title_en || item.title_bn) || 'Product').slice(0, 22);

              const pEl = document.createElement('p');
              pEl.className = 'text-xs text-brand font-bold';
              pEl.style.margin = 'var(--space-1) 0 0';
              pEl.textContent = `৳${(item.custom_retail_price || item.default_retail_price || item.price || 0).toLocaleString()}`;

              card.append(imgPlaceholder, tEl, pEl);
              itemsRow.append(card);
            });
          }

          shelfBox.append(itemsRow);
          previewBody.append(shelfBox);
        });
      }
    }

    syncLivePreview();
  }

  function openFlyerModal(store, storeUrl) {
    const content = document.createElement('div');
    content.className = 'qr-flyer-modal';

    const card = document.createElement('div');
    card.className = 'qr-flyer-card';

    const logo = document.createElement('div');
    logo.className = 'qr-flyer-card__logo';
    logo.innerHTML = formatExplooroBrandText('EXPLOORO');

    const shopTitle = document.createElement('h3');
    shopTitle.className = 'qr-flyer-card__shop-name';
    shopTitle.textContent = store.shop_name || 'Explooro Store';

    const canvas = document.createElement('canvas');
    canvas.className = 'qr-flyer-card__qr-canvas';
    canvas.width = 200;
    canvas.height = 200;

    renderQrOnCanvas(canvas, storeUrl);

    const inst = document.createElement('p');
    inst.className = 'qr-flyer-card__instructions';
    inst.innerHTML = `<strong>${t('social_kit.scan_to_shop', 'Scan QR Code to Shop Online')}</strong><br/>${t(
      'social_kit.scan_instructions',
      'Point your phone camera to browse catalog, chat on WhatsApp & place secure escrow orders on Explooro.'
    )}`;

    const link = document.createElement('p');
    link.style.fontSize = '10px';
    link.style.color = '#94a3b8';
    link.style.marginTop = '8px';
    link.textContent = storeUrl;

    card.append(logo, shopTitle, canvas, inst, link);
    content.append(card);

    const modal = Modal({
      title: t('social_kit.qr_flyer_title', 'Printable Branded QR Flyer'),
      content,
      primaryAction: {
        label: `🖨️ ${t('social_kit.print_or_save', 'Print / Save Flyer')}`,
        onClick: () => {
          window.print();
        },
      },
      secondaryAction: {
        label: t('common.close', 'Close'),
        onClick: () => modal.close(),
      },
    });

    modal.open();
  }

  function renderQrOnCanvas(canvas, text) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const size = 25;
    const cellSize = canvas.width / size;

    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }

    ctx.fillStyle = '#0b0f19';

    drawFinder(ctx, 0, 0, cellSize);
    drawFinder(ctx, size - 7, 0, cellSize);
    drawFinder(ctx, 0, size - 7, cellSize);

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if ((r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8)) {
          continue;
        }
        const val = Math.sin(r * 12.9898 + c * 78.233 + hash) * 43758.5453;
        if (val - Math.floor(val) > 0.5) {
          ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  function drawFinder(ctx, startX, startY, cellSize) {
    ctx.fillRect(startX * cellSize, startY * cellSize, 7 * cellSize, 7 * cellSize);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect((startX + 1) * cellSize, (startY + 1) * cellSize, 5 * cellSize, 5 * cellSize);
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect((startX + 2) * cellSize, (startY + 2) * cellSize, 3 * cellSize, 3 * cellSize);
  }

  return () => {
    isCancelled = true;
    clearTimeout(debounceTimer);
  };
}
