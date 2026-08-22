/**
 * StoreBuilderPage.js — Virtual storefront builder with live availability check, curated shelves & live preview (Prompt 4.8).
 */

import { getMyStore, updateMyStore, updateStoreShelves, checkSlugAvailability } from '../../services/store.api.js';
import { StoreHeader } from '../../components/store/StoreHeader.js';
import { ShelfEditor } from '../../components/store/ShelfEditor.js';
import { ShopStatusToggle } from '../../components/store/ShopStatusToggle.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Switch } from '../../components/ui/Switch.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';

export default function StoreBuilderPage(root, { navigate }) {
  const container = document.createElement('div');
  container.className = 'container store-builder';

  // Loading Skeleton
  container.append(
    Skeleton({ variant: 'text', width: 280, height: 32 }),
    Skeleton({ variant: 'block', width: '100%', height: 400 })
  );
  root.append(container);

  let isCancelled = false;
  let debounceTimer = null;

  // Local state
  let storeState = {
    shop_name: '',
    slug: '',
    bio: '',
    announcement: '',
    social_links: { whatsapp: '', facebook: '', instagram: '', phone: '' },
    has_physical_shop: false,
    physical_open_status: 'CLOSED',
    business_hours: null,
  };

  let shelvesState = [];
  let pendingShelfItems = [];

  getMyStore()
    .then(({ data }) => {
      if (isCancelled) return;
      container.replaceChildren();

      const store = data.store || {};
      shelvesState = data.shelves || [];

      storeState = {
        id: store.id,
        shop_name: store.shop_name || 'My Store',
        slug: store.slug || '',
        bio: store.bio || '',
        announcement: store.announcement || '',
        social_links: store.social_links || { whatsapp: '', facebook: '', instagram: '', phone: '' },
        has_physical_shop: !!store.has_physical_shop,
        physical_open_status: store.physical_open_status || 'CLOSED',
        business_hours: store.business_hours || null,
        logo_key: store.logo_key,
        banner_key: store.banner_key,
      };

      buildUI(container, storeState, shelvesState, navigate);
    })
    .catch((err) => {
      if (isCancelled) return;
      container.replaceChildren();
      toast.error(err.message || 'Failed to load store profile.');
    });

  function buildUI(parent, store, shelves, nav) {
    // ── Header Row ────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'store-builder__header';

    const titleWrap = document.createElement('div');
    const title = document.createElement('h1');
    title.className = 'store-builder__title';
    title.textContent = t('store_builder.title');

    const subtitle = document.createElement('p');
    subtitle.className = 'store-builder__subtitle';
    subtitle.textContent = t('store_builder.subtitle');
    titleWrap.append(title, subtitle);

    const actions = document.createElement('div');
    actions.className = 'store-builder__actions';

    const viewStoreBtn = Button({
      label: `🌐 ${t('store_builder.view_live_store')}`,
      variant: 'secondary',
      onClick: () => {
        if (storeState.slug) {
          nav(`/store/${storeState.slug}`);
        }
      },
    });

    const saveBtn = Button({
      label: `💾 ${t('common.save_changes')}`,
      variant: 'primary',
      onClick: async () => {
        saveBtn.disabled = true;
        try {
          await updateMyStore(storeState);
          if (pendingShelfItems.length > 0) {
            await updateStoreShelves(pendingShelfItems);
          }
          toast.success(t('store_builder.save_success'));
        } catch (e) {
          toast.error(e.message || t('store_builder.save_error'));
        } finally {
          saveBtn.disabled = false;
        }
      },
    });

    actions.append(viewStoreBtn, saveBtn);
    header.append(titleWrap, actions);
    parent.append(header);

    // ── Grid: Left (Editor) + Right (Live Preview) ─────────────────────────
    const grid = document.createElement('div');
    grid.className = 'store-builder__grid';

    // 1. Editor Form
    const form = document.createElement('div');
    form.className = 'store-builder__form';

    // Section 1: Store Branding & URL
    const brandingSec = document.createElement('div');
    brandingSec.className = 'store-builder__section';

    const brandTitle = document.createElement('h3');
    brandTitle.className = 'store-builder__section-title';
    brandTitle.textContent = `🏪 ${t('store_builder.branding_section')}`;
    brandingSec.append(brandTitle);

    // Shop Name Input
    const nameInput = Input({
      label: t('store_builder.shop_name_label'),
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
    slugLabel.textContent = t('store_builder.slug_label');

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
    slugStatus.textContent = '✓ ' + t('store_builder.slug_current');

    slugInput.addEventListener('input', (e) => {
      const raw = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      slugInput.value = raw;
      storeState.slug = raw;
      syncLivePreview();

      clearTimeout(debounceTimer);
      slugStatus.className = 'store-builder__slug-status text-muted';
      slugStatus.textContent = '⏳ ' + t('store_builder.checking_slug');

      debounceTimer = setTimeout(async () => {
        if (!raw || raw.length < 3) {
          slugStatus.className = 'store-builder__slug-status store-builder__slug-status--invalid';
          slugStatus.textContent = '⚠️ ' + t('store_builder.slug_too_short');
          return;
        }
        try {
          const res = await checkSlugAvailability(raw, storeState.id);
          const avail = res.data?.available;
          if (avail) {
            slugStatus.className = 'store-builder__slug-status store-builder__slug-status--available';
            slugStatus.textContent = '🟢 ' + (res.data?.message_en || t('store_builder.slug_available'));
          } else {
            slugStatus.className = 'store-builder__slug-status store-builder__slug-status--taken';
            slugStatus.textContent = '🔴 ' + (res.data?.message_en || t('store_builder.slug_unavailable'));
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
      label: t('store_builder.bio_label'),
      value: storeState.bio,
      rows: 3,
      placeholder: t('store_builder.bio_placeholder'),
      onInput: (e) => {
        storeState.bio = e.target.value;
        syncLivePreview();
      },
    });
    brandingSec.append(bioInput);

    // Announcement Bar Input
    const annInput = Input({
      label: `📢 ${t('store_builder.announcement_label')}`,
      value: storeState.announcement,
      placeholder: 'e.g. Free shipping on all orders over ৳1,000 this week!',
      onInput: (e) => {
        storeState.announcement = e.target.value;
        syncLivePreview();
      },
    });
    brandingSec.append(annInput);

    form.append(brandingSec);

    // Section 2: Social Links
    const socialSec = document.createElement('div');
    socialSec.className = 'store-builder__section';

    const socialTitle = document.createElement('h3');
    socialTitle.className = 'store-builder__section-title';
    socialTitle.textContent = `💬 ${t('store_builder.social_links_section')}`;
    socialSec.append(socialTitle);

    const waInput = Input({
      label: 'WhatsApp Number',
      value: storeState.social_links?.whatsapp || '',
      placeholder: '+88017XXXXXXXX',
      onInput: (e) => {
        storeState.social_links.whatsapp = e.target.value;
        syncLivePreview();
      },
    });

    const fbInput = Input({
      label: 'Facebook Page URL / Handle',
      value: storeState.social_links?.facebook || '',
      placeholder: 'https://facebook.com/yourshop',
      onInput: (e) => {
        storeState.social_links.facebook = e.target.value;
        syncLivePreview();
      },
    });

    const igInput = Input({
      label: 'Instagram Profile URL / Handle',
      value: storeState.social_links?.instagram || '',
      placeholder: 'https://instagram.com/yourshop',
      onInput: (e) => {
        storeState.social_links.instagram = e.target.value;
        syncLivePreview();
      },
    });

    socialSec.append(waInput, fbInput, igInput);
    form.append(socialSec);

    // Section 3: Physical Shop Status & Hours
    const physicalSec = document.createElement('div');
    physicalSec.className = 'store-builder__section';

    const physicalTitle = document.createElement('h3');
    physicalTitle.className = 'store-builder__section-title';
    physicalTitle.textContent = `📍 ${t('store_builder.physical_shop_section')}`;
    physicalSec.append(physicalTitle);

    const hasShopSwitch = Switch({
      label: t('store_builder.has_physical_shop_label'),
      checked: storeState.has_physical_shop,
      onChange: (checked) => {
        storeState.has_physical_shop = checked;
        statusToggleWrap.style.display = checked ? 'block' : 'none';
        syncLivePreview();
      },
    });
    physicalSec.append(hasShopSwitch);

    const statusToggleWrap = document.createElement('div');
    statusToggleWrap.style.display = storeState.has_physical_shop ? 'block' : 'none';

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

    // Section 4: Curated Shelves
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
    form.append(shelfSec);

    grid.append(form);

    // 2. Live Preview Column
    const previewWrap = document.createElement('div');
    previewWrap.className = 'store-builder__preview-wrap';

    const previewControls = document.createElement('div');
    previewControls.className = 'store-builder__preview-controls';

    const previewLabel = document.createElement('span');
    previewLabel.className = 'store-builder__preview-label';
    previewLabel.textContent = `👁️ ${t('store_builder.live_preview')}`;

    const deviceSwitch = document.createElement('div');
    deviceSwitch.className = 'store-builder__device-switch';

    const desktopBtn = Button({
      label: '🖥️ Desktop',
      size: 'xs',
      variant: 'secondary',
      onClick: () => {
        previewFrame.classList.remove('store-builder__preview-frame--mobile');
      },
    });

    const mobileBtn = Button({
      label: '📱 Mobile',
      size: 'xs',
      variant: 'secondary',
      onClick: () => {
        previewFrame.classList.add('store-builder__preview-frame--mobile');
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
      previewBody.replaceChildren();

      // Render StoreHeader in preview
      const previewHeader = StoreHeader({
        store: {
          shop_name: storeState.shop_name,
          slug: storeState.slug,
          bio: storeState.bio,
          announcement: storeState.announcement,
          social_links: storeState.social_links,
          status: {
            is_open: storeState.physical_open_status === 'OPEN' || storeState.physical_open_status === 'AUTO',
            message: storeState.physical_open_status === 'OPEN' ? 'Open Now 🟢' : 'Closed 🔴',
          },
          products_count: shelvesState.reduce((acc, s) => acc + (s.items?.length || 0), 0),
        },
        isPreview: true,
      });
      previewBody.append(previewHeader);

      // Render Preview Shelves
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

        if (shelf.items.length === 0) {
          const empty = document.createElement('p');
          empty.className = 'text-xs text-muted';
          empty.textContent = t('shelf_editor.empty_shelf');
          itemsRow.append(empty);
        } else {
          shelf.items.slice(0, 4).forEach((item) => {
            const card = document.createElement('div');
            card.style.padding = 'var(--space-2)';
            card.style.background = 'var(--surface-1)';
            card.style.borderRadius = 'var(--radius-sm)';
            card.style.border = '1px solid var(--border-subtle)';

            const imgPlaceholder = document.createElement('div');
            imgPlaceholder.style.height = '60px';
            imgPlaceholder.style.background = 'var(--surface-2)';
            imgPlaceholder.style.borderRadius = 'var(--radius-xs)';
            imgPlaceholder.style.marginBottom = 'var(--space-1)';

            const tEl = document.createElement('p');
            tEl.className = 'text-xs';
            tEl.style.margin = '0';
            tEl.style.fontWeight = 'var(--weight-semibold)';
            tEl.textContent = (item.title_en || item.title_bn || 'Product').slice(0, 20);

            card.append(imgPlaceholder, tEl);
            itemsRow.append(card);
          });
        }

        shelfBox.append(itemsRow);
        previewBody.append(shelfBox);
      });
    }

    syncLivePreview();
  }

  return () => {
    isCancelled = true;
    clearTimeout(debounceTimer);
  };
}
