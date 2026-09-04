/**
 * gallery-registry.js — the explicit list /dev/gallery renders from.
 *
 * RULE FOR ALL FUTURE PROMPTS (Prompt 1.8 REQUIREMENT 4): any component created in Phases 2–11
 * must register itself here in the same commit — one more object in `galleryEntries`, same
 * pattern navigation.js already established for the sidebar. The gallery page itself never lists
 * components by hand; it only walks this array.
 *
 * Each entry:
 *   { id, label, group, render: () => Node }
 * `render()` builds a fresh DOM subtree showing every state of the component side by side. It is
 * called once per GalleryPage mount — components that attach live listeners (the "loading (live)"
 * button, the pending switch) are safe because the whole subtree is discarded on navigation away.
 *
 * Entries below migrate the Prompt 1.3/1.4 specimens out of main.js's temporary index-page preview
 * (PREVIEW: "Components appear in /dev/gallery (built in 1.8) — until then, render them on the
 * index page"). Content and behaviour are unchanged from that preview; only the wiring is new.
 */
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Checkbox } from '../../components/ui/Checkbox.js';
import { RadioGroup } from '../../components/ui/Radio.js';
import { Switch } from '../../components/ui/Switch.js';
import { Badge } from '../../components/ui/Badge.js';
import { Card } from '../../components/ui/Card.js';
import { Modal } from '../../components/ui/Modal.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { Table } from '../../components/ui/Table.js';
import { Tabs } from '../../components/ui/Tabs.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { Pagination } from '../../components/ui/Pagination.js';
import { Tooltip } from '../../components/ui/Tooltip.js';
import { confirmDialog, confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { toast } from '../../services/toast.js';
import { ImageUploader } from '../../components/media/ImageUploader.js';
import { openMediaLibrary } from '../../components/media/MediaLibrary.js';
import { ProductCard, ProductCardSkeleton } from '../../components/product/ProductCard.js';
import { MASTER_PRESETS } from '../../config/master-themes.js';
import { generatePalette, BRAND_STEPS, NEUTRAL_STEPS } from '../../services/colorRamp.js';
import { CategoryPills } from '../../components/product/CategoryPills.js';
import { attachSearchSuggest } from '../../components/search/SearchSuggest.js';
import { FlashSaleWidget } from '../../components/product/FlashSaleWidget.js';
import { ImageGallery } from '../../components/product/ImageGallery.js';
import { VariantSelector } from '../../components/product/VariantSelector.js';
import { PriceBreakdown } from '../../components/product/PriceBreakdown.js';
import { ReviewList } from '../../components/product/ReviewList.js';
import { QnASection } from '../../components/product/QnASection.js';
import { ProfitCalculator } from '../../components/saler/ProfitCalculator.js';
import { MarginProjection } from '../../components/saler/MarginProjection.js';
import { AddToStoreDrawer } from '../../components/saler/AddToStoreDrawer.js';
import { StoreHeader } from '../../components/store/StoreHeader.js';
import { ShelfEditor } from '../../components/store/ShelfEditor.js';
import { ShopStatusToggle } from '../../components/store/ShopStatusToggle.js';
import { WishlistButton } from '../../components/cart/WishlistButton.js';
import { CartDrawer } from '../../components/cart/CartDrawer.js';
import { openPayoutRequestModal } from '../../components/vault/PayoutRequestModal.js';
import { EvidenceTimeline } from '../../components/dispute/EvidenceTimeline.js';
import { ReviewCard } from '../../components/moderation/ReviewCard.js';
import { SponsoredSlot } from '../../components/ads/SponsoredSlot.js';
import { LiveStreamCard } from '../../components/live/LiveStreamCard.js';
import { PinnedProductOverlay } from '../../components/live/PinnedProductOverlay.js';
import { AssistantPanel } from '../../components/ai/AssistantPanel.js';
import { WarrantyCard } from '../../components/warranty/WarrantyCard.js';
import { ClaimTimeline } from '../../components/warranty/ClaimTimeline.js';
import { createBundleProfitBreakdown } from '../../components/bundle/BundleProfitBreakdown.js';
import { createMilestoneProgressStepper } from '../../components/b2b/MilestoneProgressStepper.js';
import { ShoppableReels } from '../../components/content/ShoppableReels.js';
import { GrowthAssistant } from '../../components/saler/GrowthAssistant.js';
import { BecomeSalerCta } from '../../components/customer/BecomeSalerCta.js';
import { CouponCard } from '../../components/customer/CouponCard.js';
import { CustomerReviewCard } from '../../components/customer/CustomerReviewCard.js';
import { PendingReviewCard } from '../../components/customer/PendingReviewCard.js';
import { QuestPanel } from '../../components/gamification/QuestPanel.js';

/** One labelled specimen row: a short caption beside the live rendered states. */
function specimen(title, ...nodes) {
  const row = document.createElement('div');
  row.className = 'spec';
  const label = document.createElement('p');
  label.className = 'spec__label';
  label.textContent = title;
  const body = document.createElement('div');
  body.className = 'spec__body';
  body.append(...nodes);
  row.append(label, body);
  return row;
}

/** A sub-heading inside one component's section (e.g. "variants" vs "states"). */
function subgroup(title) {
  const h = document.createElement('h3');
  h.className = 'spec__subgroup';
  h.textContent = title;
  return h;
}

function boxIcon() {
  const span = document.createElement('span');
  span.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8Z"/>' +
    '<path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>';
  return span;
}

function renderButton() {
  const wrap = document.createDocumentFragment();
  const variants = ['primary', 'secondary', 'ghost', 'danger', 'link'];

  wrap.append(subgroup('variants'));
  for (const variant of variants) {
    wrap.append(
      specimen(
        variant,
        Button({ label: 'Add to Store', variant, size: 'sm' }),
        Button({ label: 'Add to Store', variant, size: 'md' }),
        Button({ label: 'Add to Store', variant, size: 'lg' })
      )
    );
  }

  wrap.append(subgroup('states'));
  wrap.append(
    specimen(
      'states',
      Button({ label: 'Default' }),
      Button({ label: 'Disabled', disabled: true }),
      Button({ label: 'Loading', loading: true }),
      Button({ label: 'Save', variant: 'secondary', disabled: true }),
      Button({ label: 'Delete', variant: 'danger', loading: true })
    )
  );

  // Proves the loading state does not change the button's width — the acceptance criterion for
  // "width does not jump" is only meaningful if you can watch it toggle.
  const toggling = Button({ label: 'Click to toggle loading', variant: 'secondary' });
  toggling.addEventListener('click', () => {
    toggling.setLoading(true);
    setTimeout(() => toggling.setLoading(false), 1400);
  });
  wrap.append(specimen('loading (live)', toggling));

  return wrap;
}

function renderInput() {
  const wrap = document.createDocumentFragment();
  wrap.append(
    specimen('default + hint', Input({ label: 'Store name', hint: 'Shown to customers.', placeholder: 'e.g. Rahim Fashion' })),
    specimen('error', Input({ label: 'Phone', value: '017', error: 'Enter a valid 11-digit number.' })),
    specimen('success', Input({ label: 'Phone', value: '01712345678', success: true, hint: 'Verified.' })),
    specimen('prefix / suffix', Input({ label: 'Price', type: 'number', value: '1250', prefix: '৳', suffix: '.00' })),
    specimen('counter', Input({ label: 'Tagline', maxLength: 40, showCounter: true, value: 'Best cotton in Dhaka' })),
    specimen('disabled', Input({ label: 'Store ID', value: 'EXP-4821', disabled: true })),
    specimen('readonly', Input({ label: 'Referral code', value: 'RAHIM2026', readonly: true }))
  );
  return wrap;
}

function renderSelect() {
  const wrap = document.createDocumentFragment();
  wrap.append(
    specimen(
      'default',
      Select({
        label: 'District',
        placeholder: 'Choose a district',
        options: ['Dhaka', 'Chattogram', 'Khulna', 'Rajshahi', 'Sylhet'],
      })
    ),
    specimen('error', Select({ label: 'Category', options: ['Saree', 'Panjabi'], error: 'Select a category.' })),
    specimen('disabled', Select({ label: 'Warehouse', options: ['Mirpur'], value: 'Mirpur', disabled: true }))
  );
  return wrap;
}

function renderTextarea() {
  const wrap = document.createDocumentFragment();
  wrap.append(
    specimen(
      'counter + hint',
      Textarea({
        label: 'Product description',
        hint: 'Describe fabric, size, and delivery time.',
        maxLength: 180,
        showCounter: true,
        value: 'Soft cotton saree, 12 hat, comes with matching blouse piece.',
      })
    ),
    specimen('error', Textarea({ label: 'Reason', error: 'A reason is required for this action.', rows: 3 }))
  );
  return wrap;
}

function renderCheckbox() {
  const wrap = document.createDocumentFragment();
  wrap.append(
    specimen('unchecked', Checkbox({ label: 'Cash on delivery' })),
    specimen('checked + hint', Checkbox({ label: 'bKash payment', hint: 'Instant confirmation.', checked: true })),
    specimen('indeterminate', Checkbox({ label: 'Select all products', indeterminate: true })),
    specimen('disabled', Checkbox({ label: 'Bank transfer', disabled: true, checked: true }))
  );
  return wrap;
}

function renderRadio() {
  const wrap = document.createDocumentFragment();
  wrap.append(
    specimen(
      'group (arrow keys navigate)',
      RadioGroup({
        legend: 'Delivery speed',
        hint: 'Inside Dhaka only.',
        value: 'standard',
        options: [
          { value: 'standard', label: 'Standard', hint: '2–3 days · ৳60' },
          { value: 'express', label: 'Express', hint: 'Next day · ৳120' },
          { value: 'pickup', label: 'Store pickup', hint: 'Free', disabled: true },
        ],
      })
    )
  );
  return wrap;
}

function renderSwitch() {
  const wrap = document.createDocumentFragment();
  const pendingSwitch = Switch({
    label: 'Live Stream Commerce',
    hint: 'Click to see the optimistic pending state.',
    checked: false,
  });
  pendingSwitch.addEventListener('change', () => {
    pendingSwitch.setPending(true);
    // Simulates an in-flight module toggle; Prompt 3.2 wires this to the real endpoint.
    setTimeout(() => pendingSwitch.commit(), 1600);
  });
  wrap.append(
    specimen('off', Switch({ label: 'Group Buying' })),
    specimen('on', Switch({ label: 'Abandoned Cart Recovery', checked: true })),
    specimen('pending (live)', pendingSwitch),
    specimen('disabled', Switch({ label: 'B2B Escrow', disabled: true }))
  );
  return wrap;
}

function renderBadge() {
  const wrap = document.createDocumentFragment();
  wrap.append(
    specimen(
      'variants',
      Badge({ variant: 'verified' }),
      Badge({ variant: 'elite' }),
      Badge({ variant: 'status', status: 'open' }),
      Badge({ variant: 'status', status: 'closed' }),
      Badge({ variant: 'count', count: 7 }),
      Badge({ variant: 'count', count: 248 }),
      Badge({ variant: 'tier', tier: 'Gold' }),
      Badge({ variant: 'neutral', label: 'Draft' })
    )
  );
  return wrap;
}

function renderCard() {
  const wrap = document.createDocumentFragment();
  const productBody = document.createElement('p');
  productBody.className = 'text-sm text-muted';
  productBody.textContent = 'Soft cotton saree with matching blouse piece. Ships from Mirpur.';
  wrap.append(
    specimen(
      'default / interactive',
      Card({ title: 'Premium Cotton Saree', subtitle: 'Rahim Fashion', body: productBody.cloneNode(true) }),
      Card({
        title: 'Interactive card',
        subtitle: 'Hover and press me',
        body: productBody.cloneNode(true),
        interactive: true,
        onClick: () => toast.info('Card clicked'),
      })
    )
  );
  return wrap;
}

function renderSkeleton() {
  const wrap = document.createDocumentFragment();
  wrap.append(
    specimen('text', Skeleton({ variant: 'text', lines: 3 })),
    specimen('block / circle', Skeleton({ variant: 'circle' }), Skeleton({ variant: 'block', width: 180 })),
    specimen('card', Skeleton({ variant: 'card', width: 200 })),
    specimen('table-row', Skeleton({ variant: 'table-row', columns: 4 }))
  );
  return wrap;
}

function renderEmptyState() {
  const wrap = document.createDocumentFragment();
  wrap.append(
    specimen(
      'empty',
      EmptyState({
        icon: boxIcon(),
        title: 'No products yet',
        description: 'Products you add to your store will appear here.',
        action: Button({ label: 'Add product' }),
      })
    ),
    specimen(
      'first run',
      EmptyState({
        variant: 'firstRun',
        icon: boxIcon(),
        title: 'Add your first product and start earning',
        description: 'Pick from thousands of supplier products. You hold no stock.',
        action: Button({ label: 'Browse catalogue' }),
        secondaryAction: Button({ label: 'How it works', variant: 'ghost' }),
      })
    )
  );
  return wrap;
}

function renderTable() {
  const wrap = document.createDocumentFragment();
  const columns = [
    { key: 'name', label: 'Product', sortable: true },
    { key: 'supplier', label: 'Supplier' },
    { key: 'price', label: 'Price', sortable: true, align: 'end', numeric: true },
    {
      key: 'status',
      label: 'Status',
      render: (row) => Badge({ variant: 'status', status: row.open ? 'open' : 'closed' }),
    },
  ];
  const rows = [
    { id: 1, name: 'প্রিমিয়াম কটন শাড়ি', supplier: 'Rahim Fashion', price: '৳ 1,250.00', open: true },
    { id: 2, name: 'Panjabi — Eid Edition', supplier: 'Dhaka Textiles', price: '৳ 2,400.00', open: true },
    { id: 3, name: 'Kids Winter Jacket', supplier: 'Chattogram Kids', price: '৳ 1,850.00', open: false },
  ];

  let sortState = { key: 'name', dir: 'asc' };
  const dataTable = Table({
    columns,
    rows,
    selectable: true,
    caption: 'Catalogue',
    sort: sortState,
    onSortChange: (next) => {
      sortState = next;
      dataTable.setSort(next);
      toast.info(`Sort: ${next.key} ${next.dir}`);
    },
    onSelectionChange: (ids) => {
      selectionOut.textContent = ids.length ? `selected: ${ids.join(', ')}` : 'selected: none';
    },
  });
  const selectionOut = document.createElement('p');
  selectionOut.className = 'text-xs text-muted';
  selectionOut.textContent = 'selected: none';

  wrap.append(specimen('data + selection + sort', dataTable), specimen('', selectionOut));

  // Proves the null-vs-empty distinction the component is built around.
  wrap.append(
    specimen('loading (rows = null)', Table({ columns, rows: null, skeletonRows: 3, caption: 'Loading' })),
    specimen(
      'empty (rows = [])',
      Table({
        columns,
        rows: [],
        caption: 'Empty',
        emptyState: EmptyState({
          compact: true,
          icon: boxIcon(),
          title: 'No products match these filters',
          description: 'Try clearing a filter or widening your search.',
          action: Button({ label: 'Clear filters', variant: 'secondary', size: 'sm' }),
        }),
      })
    ),
    specimen('compact density', Table({ columns, rows, density: 'compact' }))
  );
  return wrap;
}

function renderTabs() {
  const wrap = document.createDocumentFragment();
  function tabPanel(text) {
    const p = document.createElement('p');
    p.className = 'text-sm';
    p.textContent = text;
    return p;
  }
  wrap.append(
    specimen(
      'arrow keys navigate',
      Tabs({
        tabs: [
          { id: 'overview', label: 'Overview', panel: tabPanel('Store performance for the last 30 days.') },
          { id: 'orders', label: 'Orders', badge: '12', panel: tabPanel('12 orders awaiting dispatch.') },
          { id: 'payouts', label: 'Payouts', panel: tabPanel('Next escrow release in 3 days.') },
          { id: 'archived', label: 'Archived', disabled: true, panel: tabPanel('Archived.') },
        ],
      })
    )
  );
  return wrap;
}

function renderPagination() {
  const wrap = document.createDocumentFragment();
  wrap.append(
    specimen(
      'offset',
      Pagination({
        mode: 'offset',
        page: 6,
        totalPages: 20,
        totalItems: 397,
        pageSize: 20,
        onChange: ({ page }) => toast.info(`Go to page ${page}`),
      })
    ),
    specimen(
      'cursor',
      Pagination({
        mode: 'cursor',
        hasPrev: true,
        hasNext: true,
        onChange: ({ direction }) => toast.info(`Cursor: ${direction}`),
      })
    )
  );
  return wrap;
}

function renderModalDrawer(detached) {
  const wrap = document.createDocumentFragment();

  const demoModalContent = document.createElement('p');
  demoModalContent.className = 'text-sm';
  demoModalContent.textContent =
    'Tab moves only between the controls inside this dialog — focus cannot escape to the page behind it. Escape closes, and focus returns to the button that opened it.';
  const demoModal = Modal({
    title: 'Focus trap demo',
    description: 'Try Tab, Shift+Tab, and Escape.',
    content: demoModalContent,
    footer: (() => {
      const f = document.createDocumentFragment();
      f.append(
        Button({ label: 'Cancel', variant: 'secondary', onClick: () => demoModal.closeModal(false) }),
        Button({ label: 'Save', onClick: () => { demoModal.closeModal(true); toast.success('Saved'); } })
      );
      return f;
    })(),
  });
  document.body.append(demoModal);
  detached.push(demoModal);
  const openModalBtn = Button({ label: 'Open modal', variant: 'secondary' });
  openModalBtn.addEventListener('click', () => demoModal.openModal(openModalBtn));

  function drawerBody(text) {
    const p = document.createElement('p');
    p.className = 'text-sm';
    p.textContent = text;
    return p;
  }
  const rightDrawer = Drawer({
    title: 'Filters',
    side: 'right',
    content: drawerBody('Slides in from the right edge it lives on, per the Origin Rule.'),
  });
  const bottomSheet = Drawer({
    title: 'Mobile sheet',
    description: 'Drag the sheet downward to dismiss it.',
    side: 'bottom',
    content: drawerBody('Drag me down — a fast flick or a drag past 25% dismisses; anything less springs back.'),
  });
  document.body.append(rightDrawer, bottomSheet);
  detached.push(rightDrawer, bottomSheet);

  const openRight = Button({ label: 'Open right drawer', variant: 'secondary' });
  openRight.addEventListener('click', () => rightDrawer.openDrawer(openRight));
  const openSheet = Button({ label: 'Open bottom sheet', variant: 'secondary' });
  openSheet.addEventListener('click', () => bottomSheet.openDrawer(openSheet));

  wrap.append(specimen('overlays', openModalBtn, openRight, openSheet));
  return wrap;
}

function renderConfirmDialog() {
  const wrap = document.createDocumentFragment();

  const confirmPlain = Button({ label: 'Confirm (plain)', variant: 'secondary' });
  confirmPlain.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Remove from your store?',
      description: 'This product will no longer appear in your storefront.',
      confirmLabel: 'Remove',
      variant: 'danger',
      trigger: confirmPlain,
    });
    toast[ok ? 'success' : 'info'](ok ? 'Removed' : 'Cancelled');
  });

  const confirmType = Button({ label: 'Confirm (type to confirm)', variant: 'danger' });
  confirmType.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete store',
      description: 'This cannot be undone. All products and history will be lost.',
      confirmLabel: 'Delete store',
      variant: 'danger',
      typeToConfirm: 'Rahim Fashion',
      trigger: confirmType,
    });
    toast[ok ? 'success' : 'info'](ok ? 'Store deleted' : 'Cancelled');
  });

  const confirmReason = Button({ label: 'Confirm (reason required)', variant: 'secondary' });
  confirmReason.addEventListener('click', async () => {
    const { confirmed, reason } = await confirmDialogWithReason({
      title: 'Disable Live Stream Commerce',
      description: 'Salers will lose access to this module immediately.',
      confirmLabel: 'Disable module',
      reasonRequired: true,
      reasonLabel: 'Reason (recorded in the audit log)',
      trigger: confirmReason,
    });
    toast[confirmed ? 'success' : 'info'](confirmed ? `Disabled — "${reason}"` : 'Cancelled');
  });

  wrap.append(specimen('modes', confirmPlain, confirmType, confirmReason));
  return wrap;
}

function renderToast() {
  const wrap = document.createDocumentFragment();
  const buttons = ['success', 'error', 'warning', 'info'].map((variant) => {
    const b = Button({ label: variant, variant: 'secondary', size: 'sm' });
    b.addEventListener('click', () =>
      toast[variant](
        {
          success: 'Product added to your store',
          error: 'Payment failed — please try another method',
          warning: 'Stock is running low on 3 products',
          info: 'Escrow releases in 3 days',
        }[variant]
      )
    );
    return b;
  });
  const flood = Button({ label: 'Fire 6 (max 3 visible, rest queue)', variant: 'secondary', size: 'sm' });
  flood.addEventListener('click', () => {
    for (let i = 1; i <= 6; i += 1) toast.info(`Queued notification ${i}`);
  });
  wrap.append(specimen('variants', ...buttons, flood));
  return wrap;
}

function renderTooltip() {
  const wrap = document.createDocumentFragment();
  const tipBtn = Button({ label: 'Hover or focus me', variant: 'secondary' });
  Tooltip({ trigger: tipBtn, content: 'Escrow releases 3 days after delivery confirmation.' });
  const tipBtn2 = Button({ label: 'Tooltip below', variant: 'ghost' });
  Tooltip({ trigger: tipBtn2, content: 'Placed below, and flipped automatically near a viewport edge.', placement: 'bottom' });
  wrap.append(specimen('hover intent 120ms', tipBtn, tipBtn2));
  return wrap;
}

function renderImageUploader() {
  const wrap = document.createDocumentFragment();

  const uploader = ImageUploader({
    purpose: 'PRODUCT',
    aspectRatio: '1:1',
    maxFiles: 6,
    initialImages: [
      {
        id: 1,
        ref: 'MED-DEMO-001',
        url: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400',
        width: 800,
        height: 800,
      },
    ],
  });

  const libBtn = Button({
    label: 'Open Media Library Modal',
    variant: 'secondary',
    size: 'sm',
    onClick: (e) => openMediaLibrary({ purpose: 'PRODUCT', trigger: e.target }),
  });

  wrap.append(
    specimen('drag-drop / camera / paste / reorder', uploader),
    specimen('media library browser', libBtn)
  );
  return wrap;
}

// ── Prompt 4.5 — Product Discovery specimens ─────────────────────────────

const DEMO_MODULES = {
  flash_sale: true, sourcing: true, physical_shop_status: true,
};
const DEMO_PRODUCTS = [
  { ref: 'PRD-DEMO1', title_en: 'Premium Cotton Saree', title_bn: 'প্রিমিয়াম কটন শাড়ি',
    price: '1250.00', district: 'Dhaka', stock: 42, rating: '4.5', rating_count: 128,
    supplier_tier: 'verified', margin_pct: 18, image_index: 0, is_flash_sale: true,
    store_open: true, is_verified_supplier: true,
    image_url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=80' },
  { ref: 'PRD-DEMO2', title_en: 'Eid Special Panjabi', title_bn: 'ঈদ স্পেশাল পাঞ্জাবি',
    price: '2400.00', district: 'Chattogram', stock: 0, rating: '4.2', rating_count: 74,
    supplier_tier: 'standard', margin_pct: 14, image_index: 1, is_flash_sale: false,
    store_open: false, is_verified_supplier: false,
    image_url: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=500&auto=format&fit=crop&q=80' },
  { ref: 'PRD-DEMO3', title_en: 'Wireless Earbuds', title_bn: 'ওয়্যারলেস ইয়ারবাড',
    price: '1800.00', district: 'Dhaka', stock: 55, rating: '4.3', rating_count: 189,
    supplier_tier: 'elite', margin_pct: 22, image_index: 8, is_flash_sale: true,
    store_open: true, is_verified_supplier: true,
    image_url: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500&auto=format&fit=crop&q=80' },
];

function renderProductCard() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('ProductCard — customer role (all states)'));
  for (const product of DEMO_PRODUCTS) {
    const label = `${product.title_en} (stock: ${product.stock})`;
    wrap.append(specimen(label,
      ProductCard({ product, role: 'customer', modules: DEMO_MODULES, lang: 'en', size: 'full', onNavigate: () => {} })
    ));
  }
  wrap.append(subgroup('ProductCard — saler role (margin badges visible)'));
  for (const product of DEMO_PRODUCTS) {
    wrap.append(specimen(product.title_en,
      ProductCard({ product, role: 'saler', modules: DEMO_MODULES, lang: 'en', size: 'full', onNavigate: () => {} })
    ));
  }
  wrap.append(subgroup('ProductCard — Bengali language'));
  wrap.append(specimen('bn locale',
    ProductCard({ product: DEMO_PRODUCTS[0], role: 'customer', modules: DEMO_MODULES, lang: 'bn', size: 'full', onNavigate: () => {} })
  ));
  wrap.append(subgroup('ProductCard — compact (flash sale row size)'));
  wrap.append(specimen('compact',
    ProductCard({ product: DEMO_PRODUCTS[0], role: 'customer', modules: DEMO_MODULES, lang: 'en', size: 'compact', onNavigate: () => {} })
  ));
  wrap.append(subgroup('ProductCardSkeleton — loading placeholder'));
  wrap.append(specimen('skeleton (full)', ProductCardSkeleton()));
  wrap.append(specimen('skeleton (compact)', ProductCardSkeleton({ size: 'compact' })));
  return wrap;
}

function renderCategoryPills() {
  const wrap = document.createDocumentFragment();
  const cats = [
    { id: 'Clothing', label_en: 'Clothing', label_bn: 'পোশাক' },
    { id: 'Electronics', label_en: 'Electronics', label_bn: 'ইলেকট্রনিক্স' },
    { id: 'Bags', label_en: 'Bags', label_bn: 'ব্যাগ' },
    { id: 'Jewellery', label_en: 'Jewellery', label_bn: 'গহনা' },
    { id: 'Food & Grocery', label_en: 'Food & Grocery', label_bn: 'খাদ্য ও মুদিখানা' },
  ];
  wrap.append(subgroup('CategoryPills — none selected'));
  wrap.append(specimen('default', CategoryPills({ categories: cats, selected: 'all', lang: 'en', onChange: () => {} })));
  wrap.append(subgroup('CategoryPills — one selected'));
  wrap.append(specimen('Clothing selected', CategoryPills({ categories: cats, selected: 'Clothing', lang: 'en', onChange: () => {} })));
  wrap.append(subgroup('CategoryPills — Bengali labels'));
  wrap.append(specimen('bn locale', CategoryPills({ categories: cats, selected: 'all', lang: 'bn', onChange: () => {} })));
  return wrap;
}

function renderSearchSuggest() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('SearchSuggest — type “saree”, “shari”, or “bag” (min 2 chars)'));

  const form = document.createElement('form');
  form.setAttribute('role', 'search');
  form.className = 'topbar__product-search';
  form.style.position = 'relative';
  form.style.maxWidth = '440px';

  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.className = 'topbar__product-search-btn';
  btn.setAttribute('aria-label', 'Search');
  btn.textContent = '🔍';

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'topbar__product-search-input';
  input.placeholder = 'Search products, brands, categories…';
  input.autocomplete = 'off';

  form.append(btn, input);
  form.addEventListener('submit', (e) => e.preventDefault());
  attachSearchSuggest({ form, input, navigate: (path) => toast.info(`navigate → ${path}`) });

  wrap.append(specimen('typeahead dropdown', form));
  return wrap;
}

function renderFlashSaleWidget() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('FlashSaleWidget — 4h countdown with demo products'));
  const { el } = FlashSaleWidget({
    products: DEMO_PRODUCTS,
    endsAt: Date.now() + 4 * 60 * 60 * 1000,
    role: 'customer', modules: DEMO_MODULES, lang: 'en', onNavigate: () => {}, onAction: () => {},
  });
  wrap.append(specimen('flash sale widget', el));
  return wrap;
}

// ── Prompt 4.6 — Product Detail specimens ────────────────────────────────

const DEMO_VARIANTS = [
  { id: 'v1', sku: 'PANJ-MRN-M', attributes: { size: 'M' }, price_delta: 0, stock_qty: 12, is_active: true, image_url: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=500&auto=format&fit=crop&q=80', image_index: 0 },
  { id: 'v2', sku: 'PANJ-MRN-L', attributes: { size: 'L' }, price_delta: 0, stock_qty: 8, is_active: true, image_url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=80', image_index: 1 },
  { id: 'v3', sku: 'PANJ-MRN-XL', attributes: { size: 'XL' }, price_delta: 50, stock_qty: 0, is_active: true, image_url: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=500&auto=format&fit=crop&q=80', image_index: 2 },
];
const DEMO_IMAGES = [
  { id: 'img1', url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=80', is_primary: true, image_index: 0 },
  { id: 'img2', url: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=500&auto=format&fit=crop&q=80', is_primary: false, image_index: 1 },
  { id: 'img3', url: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=500&auto=format&fit=crop&q=80', is_primary: false, image_index: 2 },
];
const DEMO_PRICING = {
  base_cost: 1100, wholesale_margin: 150, wholesale_cost: 1250, retail_price: 1650,
  net_retail_margin: 400, saler_earning: 160, platform_earning: 240,
  saler_split_pct: 40, platform_split_pct: 60,
};

function renderImageGallery() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('ImageGallery — placeholder slides (no real photography in dev fixtures)'));
  wrap.append(specimen('3 images, keyboard/swipe navigable', ImageGallery({ images: DEMO_IMAGES, title: 'Premium Cotton Saree' })));
  return wrap;
}

function renderVariantSelector() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('VariantSelector — one combination (XL) is out of stock, disabled with a reason'));
  wrap.append(specimen('size selector', VariantSelector({ variants: DEMO_VARIANTS, basePrice: 1650, onChange: () => {} })));
  return wrap;
}

function renderPriceBreakdown() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('PriceBreakdown — customer view (retail price only)'));
  wrap.append(specimen('customer', PriceBreakdown({ retailPrice: 1650, pricing: DEMO_PRICING, role: 'customer', modules: DEMO_MODULES, lang: 'en' })));
  wrap.append(subgroup('PriceBreakdown — saler view (full margin breakdown, sourcing module on)'));
  wrap.append(specimen('saler', PriceBreakdown({ retailPrice: 1650, pricing: DEMO_PRICING, role: 'saler', modules: DEMO_MODULES, lang: 'en' })));
  return wrap;
}

function renderReviewList() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('ReviewList — live against the mock catalog (PRD-8F2K9QX7 has seeded reviews)'));
  const { el } = ReviewList({ productId: 'PRD-8F2K9QX7', ratingAvg: 4.5, ratingCount: 128, lang: 'en' });
  wrap.append(specimen('reviews, distribution, sort/filter, pagination', el));
  return wrap;
}

function renderQnASection() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('QnASection — live against the mock catalog (same product as ReviewList above)'));
  const { el } = QnASection({ productId: 'PRD-8F2K9QX7', lang: 'en' });
  wrap.append(specimen('questions, answers, upvote', el));
  return wrap;
}

// ── Prompt 4.7 — Sourcing & Profit Calculator specimens ───────────────────

function renderProfitCalculator() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('ProfitCalculator — Base 500 / Wholesale 0 / Retail 700 (Saler ৳80.00 / Platform ৳120.00)'));
  const calc = ProfitCalculator({ initialBaseCost: 500, initialWholesaleMargin: 0, initialRetailPrice: 700 });
  wrap.append(specimen('interactive slider calculator', calc));
  return wrap;
}

function renderMarginProjection() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('MarginProjection — Zero-dependency SVG earnings projection chart'));
  const proj = MarginProjection({ unitProfit: 80, initialVolume: 50 });
  wrap.append(specimen('volume curve with milestones', proj));
  return wrap;
}

function renderAddToStoreDrawer(detachedNodes) {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('AddToStoreDrawer — Custom retail price override & margin validation'));
  const drawer = AddToStoreDrawer();
  detachedNodes.push(drawer);
  const btn = Button({
    label: 'Open AddToStoreDrawer Demo',
    variant: 'primary',
    onClick: (e) => {
      drawer.openForProduct(DEMO_PRODUCTS[0], e.currentTarget);
    },
  });
  wrap.append(specimen('drawer trigger', btn));
  return wrap;
}

function renderStoreHeader() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('StoreHeader — Hero banner, avatar, announcement, bio, stats & open status'));
  const header = StoreHeader({
    store: {
      shop_name: 'Priyo Collection',
      slug: 'priyo-collection',
      bio: 'Authentic Bangladeshi Handloom, Sarees & Traditional Wear · Direct from weavers.',
      announcement: '🎉 Special Offer: 20% OFF on all Jamdani Sarees this week!',
      social_links: {
        whatsapp: '+8801711223344',
        facebook: 'priyocollectionbd',
        instagram: 'priyocollection.official',
        phone: '+8801711223344',
      },
      status: { is_open: true, message: 'Open Now 🟢' },
      products_count: 24,
    },
  });
  wrap.append(specimen('storefront header preview', header));
  return wrap;
}

function renderShelfEditor() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('ShelfEditor — Curated collections, shelves reordering & item management'));
  const editor = ShelfEditor({
    initialShelves: [
      {
        name: 'Featured Handloom',
        items: DEMO_PRODUCTS.slice(0, 3).map((p, idx) => ({
          product_id: p.id,
          title_en: p.title_en,
          title_bn: p.title_bn,
          default_retail_price: p.price,
          display_order: idx,
        })),
      },
    ],
  });
  wrap.append(specimen('shelf editor manager', editor));
  return wrap;
}

function renderShopStatusToggle() {
  const wrap = document.createDocumentFragment();
  wrap.append(subgroup('ShopStatusToggle — Physical shop Open / Closed / Auto modes with business hours'));
  const toggle = ShopStatusToggle({
    initialStatus: 'AUTO',
    hasPhysicalShop: true,
  });
  wrap.append(specimen('interactive status toggle', toggle));
  return wrap;
}

function renderWishlistButton() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('WishlistButton — Heart toggle with active state and tooltips'));

  const btn1 = WishlistButton({ productId: 101, size: 'md' });
  const btn2 = WishlistButton({ productId: 102, size: 'lg' });

  wrap.append(
    specimen(
      'interactive heart buttons',
      btn1,
      btn2
    )
  );
  return wrap;
}

function renderCartDrawer(detachedNodes) {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('CartDrawer — Side drawer with multi-supplier parcel splitting & live revalidation'));

  const openBtn = Button({
    label: 'Open Cart Drawer Preview',
    variant: 'primary',
    onClick: () => {
      drawer.open();
    },
  });

  const drawer = CartDrawer();
  detachedNodes.push(drawer);

  wrap.append(specimen('trigger button', openBtn));
  return wrap;
}

function renderPayoutModal() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('PayoutRequestModal — Seller/Supplier wallet withdrawal request modal (Prompt 6.3)'));

  const openBtn = Button({
    label: 'Open Withdrawal Modal Preview',
    variant: 'primary',
    onClick: () => {
      openPayoutRequestModal({
        availableBalance: 8450.00,
        onSuccess: (payout) => {
          toast.success(`Withdrawal request ${payout.ref} created!`);
        },
      });
    },
  });

  wrap.append(specimen('modal trigger', openBtn));
  return wrap;
}

function renderCodRecon() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('COD 3-Way Reconciliation & Aging Matrix (Prompt 6.4)'));

  const card = document.createElement('div');
  card.className = 'card p-4';
  card.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <h4 class="font-bold">Steadfast Courier Settlement Batch</h4>
        <div class="text-xs text-secondary font-mono">BATCH-STEADFAST-K79W2</div>
      </div>
      <span class="badge badge--success">✓ Matched (0.00)</span>
    </div>
  `;
  wrap.append(specimen('reconciliation row preview', card));
  return wrap;
}

function renderVaultOverview() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('Balance Summary & Escrow Timeline (Prompt 6.5)'));

  const card = document.createElement('div');
  card.className = 'card p-4';
  card.innerHTML = `
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div class="p-3 bg-secondary rounded">
        <div class="text-xs text-secondary">AVAILABLE</div>
        <div class="text-lg font-bold text-success">৳12,500.00</div>
      </div>
      <div class="p-3 bg-secondary rounded">
        <div class="text-xs text-secondary">PENDING ESCROW</div>
        <div class="text-lg font-bold text-warning">৳4,200.00</div>
      </div>
    </div>
    <div class="text-xs text-secondary font-mono">⏱️ Escrow Clearance: 02d 14h 32m (Order #SUB-701)</div>
  `;
  wrap.append(specimen('vault specimen preview', card));
  return wrap;
}

function renderProfitSplitsSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('Super Admin Profit Split Governance & Margin Simulator'));

  const card = document.createElement('div');
  card.className = 'card p-4 flex flex-col gap-3';
  card.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="font-bold text-base">🍰 Platform Profit Split Baseline</span>
      <span class="badge badge--danger text-xs font-bold">CRITICAL GOVERNANCE</span>
    </div>
    <div class="split-visual-bar">
      <div class="split-visual-bar__supplier" style="width: 65%;">Wholesale 65%</div>
      <div class="split-visual-bar__saler" style="width: 15%;">Saler 15%</div>
      <div class="split-visual-bar__platform" style="width: 20%;">Platform 20%</div>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div class="p-2 bg-surface-2 rounded">Default: <strong>40% Saler / 60% Platform</strong></div>
      <div class="p-2 bg-surface-2 rounded">Elite Boost: <strong class="text-success">+5.0% Commission</strong></div>
    </div>
  `;
  wrap.append(specimen('profit splits preview', card));
  return wrap;
}

function renderSubscriptionsSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('Super Admin Merchant Subscriptions & Fee Engine'));

  const card = document.createElement('div');
  card.className = 'card p-4 flex flex-col gap-3';
  card.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="font-bold text-base">🔁 Merchant Subscription Tiers</span>
      <span class="badge badge--brand text-xs font-bold">COMMERCE</span>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div class="p-2 border rounded">
        <strong>Free Starter</strong>
        <div class="text-sm font-bold text-primary mt-1">৳0 / mo</div>
        <div class="text-secondary text-2xs">100 listings included</div>
      </div>
      <div class="p-2 border border-brand rounded bg-surface-2">
        <strong class="text-brand">Saler Pro</strong>
        <div class="text-sm font-bold text-primary mt-1">৳999 / mo</div>
        <div class="text-secondary text-2xs">1,000 listings + 2% split boost</div>
      </div>
    </div>
  `;
  wrap.append(specimen('subscriptions preview', card));
  return wrap;
}

/**
 * Builds the registry. Overlay-based entries (Modal/Drawer) attach nodes to `document.body`
 * rather than the returned section — `detachedNodes` collects every one of them so GalleryPage
 * can remove them on navigation away, the same lifecycle contract core/router.js's `cleanup`
 * expects of every page module.
 */
export function buildGalleryEntries(detachedNodes) {
  return [
    { id: 'button', label: 'Button', group: 'Actions & Forms', render: renderButton },
    { id: 'input', label: 'Input', group: 'Actions & Forms', render: renderInput },
    { id: 'select', label: 'Select', group: 'Actions & Forms', render: renderSelect },
    { id: 'textarea', label: 'Textarea', group: 'Actions & Forms', render: renderTextarea },
    { id: 'checkbox', label: 'Checkbox', group: 'Actions & Forms', render: renderCheckbox },
    { id: 'radio', label: 'Radio', group: 'Actions & Forms', render: renderRadio },
    { id: 'switch', label: 'Switch', group: 'Actions & Forms', render: renderSwitch },
    { id: 'image-uploader', label: 'Image Uploader & Library', group: 'Actions & Forms', render: renderImageUploader },
    { id: 'badge', label: 'Badge', group: 'Actions & Forms', render: renderBadge },
    { id: 'card', label: 'Card', group: 'Surfaces & Feedback', render: renderCard },
    { id: 'skeleton', label: 'Skeleton', group: 'Surfaces & Feedback', render: renderSkeleton },
    { id: 'empty-state', label: 'EmptyState', group: 'Surfaces & Feedback', render: renderEmptyState },
    { id: 'table', label: 'Table', group: 'Surfaces & Feedback', render: renderTable },
    { id: 'tabs', label: 'Tabs', group: 'Surfaces & Feedback', render: renderTabs },
    { id: 'pagination', label: 'Pagination', group: 'Surfaces & Feedback', render: renderPagination },
    { id: 'modal-drawer', label: 'Modal / Drawer', group: 'Overlays', render: () => renderModalDrawer(detachedNodes) },
    { id: 'confirm-dialog', label: 'ConfirmDialog', group: 'Overlays', render: renderConfirmDialog },
    { id: 'toast', label: 'Toast', group: 'Overlays', render: renderToast },
    { id: 'tooltip', label: 'Tooltip', group: 'Overlays', render: renderTooltip },
    // Prompt 4.5 — Product Discovery
    { id: 'product-card', label: 'ProductCard', group: 'Product Discovery', render: renderProductCard },
    { id: 'category-pills', label: 'CategoryPills', group: 'Product Discovery', render: renderCategoryPills },
    { id: 'search-suggest', label: 'SearchSuggest (typeahead)', group: 'Product Discovery', render: renderSearchSuggest },
    { id: 'flash-sale-widget', label: 'FlashSaleWidget', group: 'Product Discovery', render: renderFlashSaleWidget },
    // Prompt 4.6 — Product Detail
    { id: 'image-gallery', label: 'ImageGallery', group: 'Product Detail', render: renderImageGallery },
    { id: 'variant-selector', label: 'VariantSelector', group: 'Product Detail', render: renderVariantSelector },
    { id: 'price-breakdown', label: 'PriceBreakdown', group: 'Product Detail', render: renderPriceBreakdown },
    { id: 'review-list', label: 'ReviewList', group: 'Product Detail', render: renderReviewList },
    { id: 'qna-section', label: 'QnASection', group: 'Product Detail', render: renderQnASection },
    // Prompt 4.7 — Sourcing & Profit Calculator
    { id: 'profit-calculator', label: 'ProfitCalculator', group: 'Saler Sourcing & Profit', render: renderProfitCalculator },
    { id: 'margin-projection', label: 'MarginProjection', group: 'Saler Sourcing & Profit', render: renderMarginProjection },
    { id: 'add-to-store-drawer', label: 'AddToStoreDrawer', group: 'Saler Sourcing & Profit', render: () => renderAddToStoreDrawer(detachedNodes) },
    // Prompt 4.8 — Virtual Storefront & Builder
    { id: 'store-header', label: 'StoreHeader', group: 'Virtual Storefront', render: renderStoreHeader },
    { id: 'shelf-editor', label: 'ShelfEditor', group: 'Virtual Storefront', render: renderShelfEditor },
    { id: 'shop-status-toggle', label: 'ShopStatusToggle', group: 'Virtual Storefront', render: renderShopStatusToggle },
    // Prompt 5.1 — Cart & Wishlist
    { id: 'wishlist-button', label: 'WishlistButton', group: 'Cart & Wishlist', render: renderWishlistButton },
    { id: 'cart-drawer', label: 'CartDrawer', group: 'Cart & Wishlist', render: () => renderCartDrawer(detachedNodes) },
    // Prompt 6.3 — Vault & Payouts
    { id: 'payout-modal', label: 'PayoutRequestModal', group: 'Vault & Payouts', render: renderPayoutModal },
    // Prompt 6.4 — COD Reconciliation
    { id: 'cod-recon', label: 'CodReconciliation', group: 'Vault & Payouts', render: renderCodRecon },
    // Prompt 6.5 — Earner Vault & Finance
    { id: 'vault-overview', label: 'VaultOverview', group: 'Vault & Payouts', render: renderVaultOverview },
    // Super Admin Profit Splits & Merchant Subscriptions
    { id: 'profit-splits-page', label: 'ProfitSplitsPage', group: 'Vault & Payouts', render: renderProfitSplitsSpecimen },
    { id: 'subscriptions-page', label: 'SubscriptionsPage', group: 'Vault & Payouts', render: renderSubscriptionsSpecimen },
    // Prompt 7.1 — 3PL Logistics & Live Map
    { id: 'live-tracking-map', label: 'LiveTrackingMap', group: 'Order & Logistics', render: renderLiveTrackingMapSpecimen },
    // Prompt 7.2 — Return & Refund Engine
    { id: 'returns-queue', label: 'ReturnsQueue', group: 'Order & Logistics', render: renderReturnsSpecimen },
    // Prompt 7.3 — Dispute Arbitration & Evidence Timeline
    { id: 'evidence-timeline', label: 'EvidenceTimeline', group: 'Order & Logistics', render: renderEvidenceTimelineSpecimen },
    // Prompt 7.4 — Product Approval & Content Moderation Pipeline
    { id: 'review-card', label: 'ReviewCard', group: 'Trust & Moderation', render: renderReviewCardSpecimen },
    // Prompt 7.5 — KYC Verification & Trust Tiers
    { id: 'kyc-verification', label: 'KycVerification', group: 'Trust & Moderation', render: renderKycSpecimen },
    // Prompt 7.6 — Moderator Dashboard
    { id: 'moderator-dashboard', label: 'ModeratorDashboard', group: 'Trust & Moderation', render: renderModeratorDashboardSpecimen },
    // Prompt 8.2 — Unified Notification Center & What's New
    { id: 'notification-center', label: 'NotificationCenter', group: 'Communication & Live', render: renderNotificationCenterSpecimen },
    { id: 'whats-new-modal', label: 'WhatsNewModal', group: 'Communication & Live', render: renderWhatsNewSpecimen },
    // Prompt 8.3 — WhatsApp & Messenger Unified Inbox
    { id: 'unified-inbox', label: 'UnifiedInbox', group: 'Communication & Live', render: renderUnifiedInboxSpecimen },
    // Prompt 8.4 — Real-Time Chat Interface
    { id: 'chat-interface', label: 'ChatInterface', group: 'Communication & Live', render: renderChatInterfaceSpecimen },
    // Prompt 9.1 — Sponsored Ads Engine
    { id: 'sponsored-slot', label: 'SponsoredSlot', group: 'Growth & Monetization', render: renderSponsoredSlotSpecimen },
    // Prompt 9.2 — Coupons, Vouchers & Flash Sales
    { id: 'campaign-manager', label: 'CampaignManager', group: 'Growth & Monetization', render: renderCampaignManagerSpecimen },
    { id: 'coupon-card', label: 'CouponCard', group: 'Growth & Monetization', render: renderCouponCardSpecimen },
    // Prompt 9.3 — Multi-Tier Referral & Network Growth
    { id: 'referral-hub', label: 'ReferralHub', group: 'Growth & Monetization', render: renderReferralHubSpecimen },
    // Prompt 9.4 — Loyalty Coins, Quests & Leaderboards
    { id: 'loyalty-coins', label: 'LoyaltyCoins', group: 'Growth & Monetization', render: renderLoyaltyCoinsSpecimen },
    { id: 'quest-panel', label: 'QuestPanel', group: 'Growth & Monetization', render: renderQuestPanelSpecimen },
    { id: 'leaderboard-widget', label: 'LeaderboardWidget', group: 'Growth & Monetization', render: renderLeaderboardWidgetSpecimen },
    // Prompt 9.5 — Social Group Buying
    { id: 'team-purchase', label: 'TeamPurchase', group: 'Growth & Monetization', render: renderTeamPurchaseSpecimen },
    // Prompt 9.6 — Abandoned Cart Recovery
    { id: 'cart-insights', label: 'CartInsights', group: 'Growth & Monetization', render: renderCartInsightsSpecimen },
    // Prompt 9.7 — Social Seller Kit
    { id: 'social-seller-kit', label: 'SocialSellerKit', group: 'Growth & Monetization', render: renderSocialSellerKitSpecimen },
    // Prompt 10.1 — Live Stream Commerce
    { id: 'live-stream-card', label: 'LiveStreamCard', group: 'Communication & Live', render: renderLiveStreamCardSpecimen },
    { id: 'pinned-product-overlay', label: 'PinnedProductOverlay', group: 'Communication & Live', render: renderPinnedProductOverlaySpecimen },
    // Live Moderation Console (/moderator/live)
    { id: 'live-moderation-console', label: 'LiveModerationConsole', group: 'Trust & Moderation', render: renderLiveModerationSpecimen },
    // Prompt 10.2 — AI Service Layer & Conversational Assistants
    { id: 'assistant-panel-concierge', label: 'AssistantPanel (Concierge)', group: 'AI & Intelligence', render: renderAssistantPanelConciergeSpecimen },
    { id: 'assistant-panel-sourcing', label: 'AssistantPanel (Sourcing)', group: 'AI & Intelligence', render: renderAssistantPanelSourcingSpecimen },
    // Prompt 10.4 — Digital Warranty & Claims Engine
    { id: 'warranty-card', label: 'WarrantyCard', group: 'Trust & Protection', render: renderWarrantyCardSpecimen },
    { id: 'claim-timeline', label: 'ClaimTimeline', group: 'Trust & Protection', render: renderClaimTimelineSpecimen },
    // Prompt 10.5 — Cross-Seller Bundling & Surge Pricing
    { id: 'bundle-profit-breakdown', label: 'BundleProfitBreakdown', group: 'Saler Sourcing & Profit', render: renderBundleBreakdownSpecimen },
    // Prompt 10.6 — B2B Wholesale Escrow & Milestone Settlement
    { id: 'b2b-milestone-stepper', label: 'MilestoneProgressStepper', group: 'Vault & Payouts', render: renderB2bMilestoneStepperSpecimen },
    // Prompt 10.8 — Content Commerce & Shoppable Reels
    { id: 'shoppable-reels', label: 'ShoppableReels', group: 'Communication & Live', render: renderShoppableReelsSpecimen },
    // Prompt 11.1 — Supplier / Manufacturer Dashboard & Operational Widgets
    { id: 'supplier-dashboard-widgets', label: 'SupplierDashboardWidgets', group: 'Commerce & Catalog', render: renderSupplierDashboardWidgetsSpecimen },
    { id: 'supplier-orders-to-pack', label: 'SupplierOrdersToPack', group: 'Commerce & Catalog', render: renderSupplierOrdersSpecimen },
    { id: 'supplier-help-center', label: 'SupplierHelpCenter', group: 'Commerce & Catalog', render: renderSupplierHelpSpecimen },
    { id: 'supplier-shipments-tracking', label: 'SupplierShipmentsTracking', group: 'Commerce & Catalog', render: renderSupplierShipmentsSpecimen },
    { id: 'supplier-wholesale-inquiries', label: 'SupplierWholesaleInquiries', group: 'Commerce & Catalog', render: renderSupplierInquiriesSpecimen },
    { id: 'supplier-store-status', label: 'SupplierStoreStatus', group: 'Commerce & Catalog', render: renderSupplierStoreStatusSpecimen },
    // Prompt 11.2 — Saler Prescriptive AI Growth Assistant
    { id: 'growth-assistant', label: 'GrowthAssistant', group: 'Saler Sourcing & Profit', render: renderGrowthAssistantSpecimen },
    // Catalog & Products Governance
    { id: 'catalog-products-governance', label: 'CatalogProductsGovernance', group: 'Commerce & Catalog', render: renderCatalogProductsSpecimen },
    // Prompt 11.3 — Followed Stores & Product Drops Feed
    { id: 'following-feed', label: 'FollowingFeed', group: 'Commerce & Catalog', render: renderFollowingFeedSpecimen },
    // Customer Reviews & UGC Hub
    { id: 'customer-review-card', label: 'CustomerReviewCard', group: 'Trust & Protection', render: renderCustomerReviewCardSpecimen },
    { id: 'pending-review-card', label: 'PendingReviewCard', group: 'Trust & Protection', render: renderPendingReviewCardSpecimen },
    // Customer Saved Delivery Addresses Book
    { id: 'customer-address-card', label: 'CustomerAddressCard', group: 'Commerce & Catalog', render: renderCustomerAddressCardSpecimen },
    // Master Colour engine (services/colorRamp.js) — the generated ramps behind Theme Studio
    { id: 'master-palette', label: 'MasterPalette', group: 'Foundations', render: renderMasterPaletteSpecimen },
  ];
}

function renderEvidenceTimelineSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('Evidence Timeline & Dispute Trail (Prompt 7.3)'));

  const sampleEvents = [
    {
      id: 'event-1',
      type: 'ORDER_PLACED',
      category: 'COMMERCE',
      title: 'Order Placed & Escrow Locked',
      actor: 'Rahim Customer',
      actor_role: 'CUSTOMER',
      created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
      metadata: { sub_order_ref: 'SO-9921', disputed_amount: '৳2,400.00' },
    },
    {
      id: 'event-2',
      type: 'COURIER_EVENT',
      category: 'LOGISTICS',
      title: 'Courier: DELIVERED',
      actor: 'Steadfast Courier',
      actor_role: 'COURIER',
      created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      metadata: { tracking_note: 'Delivered to customer doorstep' },
    },
    {
      id: 'event-3',
      type: 'DISPUTE_OPENED',
      category: 'DISPUTE',
      title: 'Dispute Thread Initiated (DSP-8821)',
      actor: 'Rahim Customer',
      actor_role: 'CUSTOMER',
      created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
      body: 'Item fabric is torn and color does not match description photos.',
      attachments: ['/demo-product-1.jpg'],
    },
    {
      id: 'event-4',
      type: 'INTERNAL_NOTE',
      category: 'COMMUNICATION',
      title: 'Moderator Private Note',
      actor: 'Nabila Moderator',
      actor_role: 'MODERATOR',
      created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      body: 'Supplier has 3 previous fabric defect complaints. Recommending full refund.',
      is_internal: true,
    },
  ];

  const timelineEl = EvidenceTimeline({ timeline: sampleEvents, disputeRef: 'DSP-8821' });
  wrap.append(specimen('evidence timeline preview', timelineEl));
  return wrap;
}

function renderReturnsSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('Return Request & Moderation Claim (Prompt 7.2)'));

  const card = document.createElement('div');
  card.className = 'card p-4';
  card.innerHTML = `
    <div class="flex justify-between items-start mb-2">
      <div>
        <strong class="font-mono">RET-K89X24</strong>
        <span class="badge badge--warning ml-2">PICKUP_SCHEDULED</span>
      </div>
      <strong class="text-success font-mono">৳1,500.00</strong>
    </div>
    <div class="text-xs text-secondary mb-2">Reason: <strong>DEFECTIVE</strong> • Reverse Tracking: <span class="font-mono">REV-TRK-771</span></div>
    <div class="text-xs text-secondary">Customer Trust Score: <span class="badge badge--success">92</span></div>
  `;
  wrap.append(specimen('return request specimen', card));
  return wrap;
}

function renderLiveTrackingMapSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('Live 3PL Courier GPS Tracking Map (Prompt 7.1)'));

  const card = document.createElement('div');
  card.className = 'card p-4';
  card.innerHTML = `
    <div class="live-map-viewport mb-3">
      <div class="live-map-tiles" style="background: var(--surface-2);">
        <div class="courier-pin" title="Dhaka Transit Hub">
          <div class="courier-pin__pulse"></div>
          <div class="courier-pin__icon">🛵</div>
          <div class="courier-pin__label font-mono">Dhaka Sorting Center (Tejgaon)</div>
        </div>
      </div>
    </div>
    <div class="text-xs text-secondary font-mono">📍 Lat: 23.7594, Lng: 90.3925 (Mock Courier TRK-MOCK-8821)</div>
  `;
  wrap.append(specimen('live map tracking specimen', card));
  return wrap;
}

function renderReviewCardSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('Product & Content Review Card (Prompt 7.4)'));

  const sampleItem = {
    id: 1,
    ref: 'MOD-9A2K7L',
    item_type: 'PRODUCT_NEW',
    status: 'PENDING',
    submitter_name: 'Anisul Textile Mills',
    submitter_role: 'SUPPLIER',
    created_at: new Date().toISOString(),
    auto_flags: [
      {
        code: 'PROHIBITED_KEYWORD_EN',
        severity: 'HIGH',
        label_en: 'Contains prohibited term: "replica"',
      },
    ],
    payload_snapshot_json: {
      title_en: 'Exclusive Jamdani Saree (Replica Silk)',
      title_bn: 'এক্সক্লুসিভ জামদানি শাড়ি',
      category_name: 'Fashion / Traditional',
      brand: 'Deshi Handloom',
      default_retail_price: '3200.00',
      base_cost: '2100.00',
      wholesale_margin: '400.00',
      stock_qty: 45,
      description_en: 'Handcrafted Jamdani saree with fine silver zari border.',
      images: ['/demo-saree-1.jpg', '/demo-saree-2.jpg'],
    },
  };

  const cardNode = ReviewCard({
    item: sampleItem,
    currentUserId: 1,
  });

  wrap.append(specimen('review card preview', cardNode));
  return wrap;
}

function renderKycSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('KYC Verification & Blue-Tick Status (Prompt 7.5)'));

  const card = document.createElement('div');
  card.className = 'card p-4 space-y-3';
  card.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="font-bold text-sm">Akram Fabrics Ltd.</span>
        <span class="badge badge--emerald text-xs">✓ Blue-Tick Verified</span>
      </div>
      <span class="badge badge--indigo">ELITE_PARTNER (92 pts)</span>
    </div>
    <div class="text-xs text-secondary">NID: <span class="font-mono">********9218</span> • Trade License: <span class="font-mono">TRAD/DNCC/08219</span></div>
    <div class="flex gap-2">
      <span class="badge badge--xs">1.5x Search Boost</span>
      <span class="badge badge--xs">+5% Margin Bonus</span>
      <span class="badge badge--xs">৳200,000/day Limit</span>
    </div>
  `;

  wrap.append(specimen('kyc status preview', card));
  return wrap;
}

function renderModeratorDashboardSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Moderator Workload & SLA Monitor (Prompt 7.6)'));

  const kpiGrid = document.createElement('div');
  kpiGrid.className = 'grid grid-cols-4 gap-3 text-xs';
  kpiGrid.innerHTML = `
    <div class="card p-3 border-l-4 border-primary">
      <span class="text-secondary block text-xxs">My Queue</span>
      <span class="text-xl font-bold">12</span>
    </div>
    <div class="card p-3 border-l-4 border-amber">
      <span class="text-secondary block text-xxs">Unassigned</span>
      <span class="text-xl font-bold">48</span>
    </div>
    <div class="card p-3 border-l-4 border-rose">
      <span class="text-secondary block text-xxs">SLA At-Risk</span>
      <span class="text-xl font-bold text-rose">3</span>
    </div>
    <div class="card p-3 border-l-4 border-emerald">
      <span class="text-secondary block text-xxs">Resolved Today</span>
      <span class="text-xl font-bold text-emerald">29</span>
    </div>
  `;

  wrap.append(specimen('workload kpis preview', kpiGrid));
  return wrap;
}

function renderLiveModerationSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Live Moderation Console — chat monitor states (/moderator/live)'));

  // The three states a moderator distinguishes at a glance: clean chat, an advisory flag, and a
  // message already taken down. Everything else on the page is chrome around this distinction.
  const feed = document.createElement('ul');
  feed.style.cssText = 'margin:0;padding:0;display:flex;flex-direction:column;gap:8px;';
  feed.innerHTML = `
    <li style="list-style:none;padding:10px 12px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--surface-1);">
      <strong style="font-size:12px;">Shopper_Dhaka_99</strong>
      <p style="margin:4px 0 0;font-size:13px;">Apu eta ki khati cotton? Dam koto pordbe?</p>
    </li>
    <li style="list-style:none;padding:10px 12px;border:1px solid var(--danger);border-radius:var(--radius-md);background:var(--surface-1);">
      <strong style="font-size:12px;">WholesaleBroker_BD</strong>
      <span style="font-size:10px;font-weight:800;padding:1px 6px;border-radius:4px;background:var(--danger-bg);color:var(--danger);">&#9888; Flagged</span>
      <p style="margin:4px 0 0;font-size:13px;">Direct kotha bolen &mdash; 01711998877, WhatsApp e cheaper dibo.</p>
      <span style="font-size:10px;font-family:monospace;font-weight:800;color:var(--danger);">EXTERNAL_CONTACT_LEAK</span>
    </li>
    <li style="list-style:none;padding:10px 12px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--surface-2);opacity:0.72;">
      <strong style="font-size:12px;">Rakib_Hasan_01</strong>
      <span style="font-size:10px;font-weight:800;padding:1px 6px;border-radius:4px;background:var(--surface-3);color:var(--text-muted);">Removed</span>
      <p style="margin:4px 0 0;font-size:13px;text-decoration:line-through;color:var(--text-muted);">Eta to first copy replica.</p>
      <span style="font-size:11px;color:var(--text-muted);">Removed by Dev Moderator &mdash; Unsubstantiated counterfeit claim</span>
    </li>
  `;

  const signals = document.createElement('div');
  signals.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
  signals.innerHTML = `
    <span style="padding:4px 10px;border-radius:var(--radius-md);background:var(--surface-2);border:1px solid var(--border-subtle);font-size:12px;font-weight:600;">Viewers <strong>142</strong></span>
    <span style="padding:4px 10px;border-radius:var(--radius-md);background:var(--danger-bg);color:var(--danger);border:1px solid var(--danger-border);font-size:12px;font-weight:600;">Flagged messages <strong>2</strong></span>
    <span style="padding:4px 10px;border-radius:var(--radius-md);background:var(--warning-bg);color:var(--warning);border:1px solid var(--warning-border);font-size:12px;font-weight:600;">Muted <strong>1</strong></span>
  `;

  // The preview stage, in the two states worth eyeballing: observing a running broadcast, and
  // reviewing the recording of one that has already been cut. The observer notice is part of the
  // specimen because it is the load-bearing part — a moderator who thinks the host can see them
  // watches differently.
  const previewLive = document.createElement('div');
  previewLive.style.cssText =
    'border:1px solid var(--border-subtle);border-radius:var(--radius-lg);overflow:hidden;background:var(--surface-2);';
  previewLive.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;">
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;">
        <span class="pulse-dot"></span>Broadcast preview
        <span style="font-size:11px;font-weight:800;padding:2px 7px;border-radius:999px;background:var(--danger);color:#fff;">LIVE</span>
        <span style="font-size:11px;font-weight:600;color:var(--text-muted);">142 watching</span>
      </div>
      <span style="font-size:12px;font-weight:600;color:var(--text-secondary);">Audio only (data saver)</span>
    </div>
    <div style="position:relative;width:100%;aspect-ratio:16/9;max-height:220px;background:#090d16;display:flex;align-items:center;justify-content:center;">
      <div class="mock-presenter-canvas">
        <div class="mock-presenter-avatar">&#128248;</div>
        <div class="mock-stream-wave"><span></span><span></span><span></span><span></span><span></span></div>
        <div style="font-size:13px;font-weight:700;">Observing the live feed&hellip;</div>
      </div>
    </div>
    <div style="padding:9px 12px;background:var(--info-bg);border-top:1px solid var(--border-subtle);font-size:11px;line-height:1.55;color:var(--text-secondary);">
      <strong style="color:var(--text-primary);">&#128065; Hidden observer.</strong>
      The host and viewers cannot see that you joined, and you cannot post in this chat. Every action
      you take &mdash; mute, removal, termination &mdash; is logged and visible to them.
    </div>
  `;

  const previewRecording = document.createElement('div');
  previewRecording.style.cssText =
    'position:relative;width:100%;aspect-ratio:16/9;max-height:220px;background:#090d16;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-lg);overflow:hidden;';
  previewRecording.innerHTML = `
    <div class="mock-presenter-canvas">
      <div style="font-size:34px;line-height:1;">&#127902;</div>
      <div style="font-size:14px;font-weight:700;">Recording</div>
      <div style="font-size:12px;opacity:0.75;max-width:420px;line-height:1.5;">This broadcast has ended. Review the recording before acting on any report about it.</div>
      <div style="font-size:11px;opacity:0.75;">Duration: 60m &middot; Recorded: Aug 30, 2026</div>
    </div>
  `;

  wrap.append(
    specimen('triage signals', signals),
    specimen('broadcast preview: observing a LIVE stream', previewLive),
    specimen('broadcast preview: recording of an ended stream', previewRecording),
    specimen('chat monitor: clean / flagged / removed', feed)
  );
  return wrap;
}

function renderNotificationCenterSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Unified Notification Center (Prompt 8.2)'));

  const previewBox = document.createElement('div');
  previewBox.className = 'card p-4 space-y-3';
  previewBox.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="font-bold text-sm">In-App Notification Feed</span>
        <span class="badge badge--primary text-xs">2 Unread</span>
      </div>
      <button class="btn btn--ghost btn--sm">Mark all as read</button>
    </div>
    <div class="space-y-2 text-xs">
      <div class="p-2 border rounded flex items-start gap-2 bg-base">
        <span class="text-lg">📦</span>
        <div>
          <div class="font-semibold">Order Confirmed</div>
          <div class="text-secondary">Order #SO-9128 placed successfully for ৳3,200.00.</div>
        </div>
      </div>
      <div class="p-2 border rounded flex items-start gap-2 bg-base">
        <span class="text-lg">💰</span>
        <div>
          <div class="font-semibold">Payout Disbursed</div>
          <div class="text-secondary">Payout of ৳15,000.00 has been sent to your bKash account.</div>
        </div>
      </div>
    </div>
  `;

  wrap.append(specimen('notification feed preview', previewBox));
  return wrap;
}

function renderWhatsNewSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup("What's New Release Notes (Prompt 8.2)"));

  const previewBox = document.createElement('div');
  previewBox.className = 'card p-4 space-y-3';
  previewBox.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="badge badge--indigo">v2.4.0 Release</span>
      <span class="font-bold text-sm">Real-Time Chat & Multi-Channel Notifications</span>
    </div>
    <p class="text-xs text-secondary">Discover real-time messaging, debounced offline SMS fallback, and granular notification preferences.</p>
  `;

  wrap.append(specimen("what's new card preview", previewBox));
  return wrap;
}

function renderUnifiedInboxSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('WhatsApp & Messenger Unified Inbox (Prompt 8.3)'));

  const previewBox = document.createElement('div');
  previewBox.className = 'card p-4 space-y-3';
  previewBox.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="font-bold text-sm">Customer +8801712345678</span>
        <span class="badge badge--emerald text-xs">🟢 WhatsApp</span>
        <span class="badge badge--primary text-xs">24h Window Active</span>
      </div>
      <span class="text-xs text-secondary">Ref: THR-WA-99A1</span>
    </div>
    <div class="p-3 border rounded bg-base space-y-2">
      <div class="text-xs text-secondary font-semibold">Interactive WhatsApp Product Card:</div>
      <div class="p-2 border rounded bg-surface">
        <div class="font-bold text-xs">Soft Silk Saree (৳2,400.00)</div>
        <div class="text-xxs text-secondary">1-Tap Checkout Link Generated: /checkout/wa/tok_99182</div>
        <button class="btn btn--primary btn--xs mt-1">Buy Now / অর্ডার করুন ⚡</button>
      </div>
    </div>
  `;

  wrap.append(specimen('unified conversation card preview', previewBox));
  return wrap;
}

function renderChatInterfaceSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Real-Time Chat & Mobile Optimistic UI (Prompt 8.4)'));

  const previewBox = document.createElement('div');
  previewBox.className = 'card p-4 space-y-3';
  previewBox.innerHTML = `
    <div class="flex items-center justify-between border-b pb-2">
      <div class="flex items-center gap-2">
        <span class="font-bold text-sm">Conversation with Supplier #10</span>
        <span class="badge badge--emerald text-xxs">🟢 Connected</span>
      </div>
      <span class="text-xs text-muted">Offline Queue: 0 pending</span>
    </div>
    <div class="p-3 bg-base rounded space-y-2">
      <div class="flex justify-start">
        <div class="bg-surface border p-2 rounded-lg text-xs max-w-xs shadow-xs">
          <p>Hello! Are these sarees available for wholesale delivery?</p>
          <span class="text-xxs text-muted">10:45 AM</span>
        </div>
      </div>
      <div class="flex justify-end">
        <div class="bg-primary text-primary-contrast p-2 rounded-lg text-xs max-w-xs shadow-xs">
          <p>Yes, 50 units ready for dispatch today.</p>
          <div class="flex justify-end items-center gap-1 text-xxs opacity-75">
            <span>10:46 AM</span>
            <span>✓✓</span>
          </div>
        </div>
      </div>
    </div>
  `;

  wrap.append(specimen('chat bubble stream preview', previewBox));
  return wrap;
}

function renderSponsoredSlotSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Sponsored Ads Engine & Viewability Slots (Prompt 9.1)'));

  const sampleAd = {
    campaignId: 101,
    campaignRef: 'ADC-98A2K1',
    creativeId: 201,
    title: 'Eid Handloom Jamdani Saree',
    headline: 'Exclusive Handloom Jamdani — 20% Off',
    description: 'Direct from Narayanganj artisans. Fast 2-day delivery across Bangladesh.',
    bannerImageUrl: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=80',
    callToAction: 'SHOP_NOW',
    destinationUrl: '/product/1',
    chargedCpc: 2.50,
    product: {
      default_retail_price: '3,200.00',
    },
  };

  const cardSlot = new SponsoredSlot({
    ad: sampleAd,
    variant: 'card',
    placement: 'SEARCH_RESULTS',
  });

  const bannerSlot = new SponsoredSlot({
    ad: sampleAd,
    variant: 'banner',
    placement: 'CATEGORY_BANNER',
  });

  wrap.append(
    specimen('Search Results Product Card (viewability beacon active)', cardSlot.render()),
    specimen('Category / Homepage Banner Slot', bannerSlot.render())
  );
  return wrap;
}

function renderCampaignManagerSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Campaign & Flash Sale Deals with Stock Caps & Countdown (Prompt 9.2)'));

  const sampleCard = document.createElement('div');
  sampleCard.className = 'card p-4 space-y-3';
  sampleCard.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <h4 class="font-bold text-sm">⚡ Eid Mega Flash Deal</h4>
        <div class="text-xs text-muted font-mono">FLS-8F29K1 • Narayanganj Jamdani</div>
      </div>
      <span class="badge badge-success text-xs font-semibold">Live (Ends in 03h 14m)</span>
    </div>
    <div class="grid grid-cols-2 gap-3 text-xs">
      <div>
        <span class="text-muted">Price:</span>
        <span class="line-through text-muted ml-1">৳3,200</span>
        <span class="text-success font-bold ml-1">৳1,990</span>
      </div>
      <div>
        <span class="text-muted">Stock Claimed:</span>
        <span class="font-bold ml-1">42 / 50 (84%)</span>
      </div>
    </div>
    <div class="w-full bg-border rounded-full h-1.5 overflow-hidden">
      <div class="bg-primary h-1.5 rounded-full" style="width: 84%"></div>
    </div>
  `;

  wrap.append(specimen('Flash Deal Admin / Merchandising Specimen', sampleCard));
  return wrap;
}

function renderCouponCardSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Customer Discount Voucher & Free Delivery Ticket Cards (Prompt 9.2)'));

  const samplePercentCoupon = {
    id: 1,
    code: 'EIDMUBARAK2026',
    discount_type: 'PERCENT',
    discount_value: 15,
    max_discount_amount: 1500,
    min_spend_amount: 3000,
    scope_type: 'PLATFORM',
    starts_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 86400000).toISOString(),
    is_active: true,
  };

  const sampleFreeShipCoupon = {
    id: 2,
    code: 'FREESHIPDHAKA',
    discount_type: 'FREE_SHIPPING',
    discount_value: 120,
    max_discount_amount: 120,
    min_spend_amount: 1000,
    scope_type: 'CATEGORY',
    category_name: 'Dhaka Delivery',
    starts_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 2 * 86400000).toISOString(), // Expiring in 2 days
    is_active: true,
  };

  const card1 = CouponCard({
    coupon: samplePercentCoupon,
    onShopClick: () => toast.info('Navigating to marketplace...'),
    onTermsClick: () => toast.info('Opened Terms & Conditions'),
  });

  const card2 = CouponCard({
    coupon: sampleFreeShipCoupon,
    onShopClick: () => toast.info('Navigating to category products...'),
    onTermsClick: () => toast.info('Opened Terms & Conditions'),
  });

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 md:grid-cols-2 gap-4';
  grid.append(card1, card2);

  wrap.append(specimen('Ticket Voucher Cards (Percentage & Free Shipping)', grid));
  return wrap;
}

function renderReferralHubSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Multi-Tier Referral Network Tree & Link Specimen (Prompt 9.3)'));

  const shareBox = document.createElement('div');
  shareBox.className = 'card p-5 space-y-4 border border-subtle bg-surface rounded-2xl shadow-xs';
  shareBox.innerHTML = `
    <div class="flex items-center justify-between border-b border-subtle pb-3">
      <div>
        <h4 class="font-bold text-base text-foreground">🤝 2-Tier Referral & Network Growth Hub</h4>
        <div class="text-xs text-muted">Tier 1: 5% direct commission • Tier 2: 2% sub-network commission • 100 Coins/invite</div>
      </div>
      <span class="badge badge--primary text-xs font-bold font-mono">REF-EXP8820</span>
    </div>

    <!-- 4 KPIs -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-xs">
      <div class="p-3 bg-surface-1 border border-subtle rounded-xl">
        <div class="text-muted text-[11px] font-bold uppercase">Total Network</div>
        <div class="font-bold text-lg text-primary font-mono mt-1">18 Referees</div>
        <div class="text-[10px] text-muted">14 Qualified</div>
      </div>
      <div class="p-3 bg-surface-1 border border-subtle rounded-xl">
        <div class="text-muted text-[11px] font-bold uppercase">Tier 1 (5%)</div>
        <div class="font-bold text-lg text-foreground font-mono mt-1">12 Direct</div>
        <div class="text-[10px] text-muted">Direct friends</div>
      </div>
      <div class="p-3 bg-surface-1 border border-subtle rounded-xl">
        <div class="text-muted text-[11px] font-bold uppercase">Tier 2 (2%)</div>
        <div class="font-bold text-lg text-warning font-mono mt-1">6 Sub-Tier</div>
        <div class="text-[10px] text-muted">Friend's network</div>
      </div>
      <div class="p-3 bg-surface-1 border border-subtle rounded-xl">
        <div class="text-muted text-[11px] font-bold uppercase">Total Earned</div>
        <div class="font-bold text-lg text-green-600 font-mono mt-1">৳8,450.00</div>
        <div class="text-[10px] text-muted">৳2,100 in escrow</div>
      </div>
    </div>

    <!-- Share row -->
    <div class="p-3 bg-surface-1 border border-subtle rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
      <div class="font-mono text-muted text-xs break-all">
        https://explooro.com/join/tanvir-deals
      </div>
      <div class="flex gap-2">
        <button class="btn btn--sm btn--primary">📋 Copy Link</button>
        <button class="btn btn--sm btn--outline">📱 QR Code</button>
      </div>
    </div>
  `;

  wrap.append(specimen('Referral Share & Multi-Tier Metrics Card', shareBox));
  return wrap;
}

function renderLoyaltyCoinsSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Loyalty Coins, Streak Calendar & Conversion Value (Prompt 9.4)'));

  const heroCard = document.createElement('div');
  heroCard.className = 'coins-hero';
  heroCard.innerHTML = `
    <div class="coins-hero__top">
      <div class="coins-hero__main">
        <div class="coins-medallion">🪙</div>
        <div class="coins-hero__info">
          <span class="coins-hero__label">Available Coins</span>
          <div class="coins-hero__balance-row">
            <span class="coins-hero__balance">1,250</span>
            <span class="coins-hero__unit">Coins</span>
          </div>
          <div class="coins-hero__cash-tag">
            <span>💰</span>
            <span>≈ ৳125.00 BDT Cash Value (100 coins = ৳10)</span>
          </div>
        </div>
      </div>
      <div class="coins-hero__stats">
        <div class="coins-stat-pill">
          <span class="coins-stat-pill__label">Total Earned</span>
          <span class="coins-stat-pill__value coins-stat-pill__value--green">+2,450</span>
        </div>
        <div class="coins-stat-pill">
          <span class="coins-stat-pill__label">Total Spent</span>
          <span class="coins-stat-pill__value">-1,200</span>
        </div>
        <div class="coins-stat-pill">
          <span class="coins-stat-pill__label">Active Streak</span>
          <span class="coins-stat-pill__value coins-stat-pill__value--amber">🔥 4 Days</span>
        </div>
      </div>
    </div>
    <div class="coins-hero__actions">
      <div class="coins-hero__rate-tip">
        <span>💡</span>
        <span>Redeem coins at checkout for ৳10 discount per 100 coins (up to 20% cart total)</span>
      </div>
      <button class="coins-hero__btn-redeem" type="button">
        <span>🛒</span>
        <span>Use Coins at Checkout</span>
      </button>
    </div>
  `;

  const streakCard = document.createElement('div');
  streakCard.className = 'coins-streak-card';
  streakCard.innerHTML = `
    <div class="coins-streak-card__header">
      <div class="coins-streak-card__title-group">
        <h3 class="coins-streak-card__title">🔥 7-Day Daily Streak Calendar</h3>
        <p class="coins-streak-card__subtitle">Check in every day without breaking streak to unlock the Day 7 Mega Reward!</p>
      </div>
      <div class="coins-streak-card__controls">
        <span class="coins-streak-badge">🔥 4 Day Streak</span>
        <button class="coins-checkin-btn" type="button">✨ Claim Today (+25 Coins)</button>
      </div>
    </div>
    <div class="coins-streak-grid">
      <div class="coins-day-node coins-day-node--claimed">
        <span class="coins-day-node__day">Day 1</span>
        <div class="coins-day-node__icon">✅</div>
        <span class="coins-day-node__reward">+10 Coins</span>
      </div>
      <div class="coins-day-node coins-day-node--claimed">
        <span class="coins-day-node__day">Day 2</span>
        <div class="coins-day-node__icon">✅</div>
        <span class="coins-day-node__reward">+15 Coins</span>
      </div>
      <div class="coins-day-node coins-day-node--claimed">
        <span class="coins-day-node__day">Day 3</span>
        <div class="coins-day-node__icon">✅</div>
        <span class="coins-day-node__reward">+20 Coins</span>
      </div>
      <div class="coins-day-node coins-day-node--today">
        <span class="coins-day-node__day">Day 4</span>
        <div class="coins-day-node__icon">🪙</div>
        <span class="coins-day-node__reward">+25 Coins</span>
      </div>
      <div class="coins-day-node coins-day-node--locked">
        <span class="coins-day-node__day">Day 5</span>
        <div class="coins-day-node__icon">🔒</div>
        <span class="coins-day-node__reward">+30 Coins</span>
      </div>
      <div class="coins-day-node coins-day-node--locked">
        <span class="coins-day-node__day">Day 6</span>
        <div class="coins-day-node__icon">🔒</div>
        <span class="coins-day-node__reward">+35 Coins</span>
      </div>
      <div class="coins-day-node coins-day-node--mega coins-day-node--locked">
        <span class="coins-day-node__day">Day 7</span>
        <div class="coins-day-node__icon">🎁</div>
        <span class="coins-day-node__reward">+50 Coins</span>
      </div>
    </div>
  `;

  wrap.append(
    specimen('Gold Coin Hero Balance Banner', heroCard),
    specimen('Interactive 7-Day Streak Calendar', streakCard)
  );
  return wrap;
}

function renderQuestPanelSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Daily & Weekly Quests & Missions (Prompt 9.4)'));

  const sampleQuests = [
    {
      id: 1,
      title_en: 'Daily Explorer Check-in',
      title_bn: 'দৈনিক এক্সপ্লোরার চেক-ইন',
      description_en: 'Open the app and claim your daily streak reward',
      cadence: 'DAILY',
      target_count: 1,
      current_count: 1,
      reward_coins: 10,
      is_completed: true,
      is_claimed: true,
    },
    {
      id: 2,
      title_en: 'Browse Trending Flash Deals',
      title_bn: 'ট্রেন্ডিং ফ্ল্যাশ ডিল এক্সপ্লোর করুন',
      description_en: 'View at least 3 products from today’s campaign sale',
      cadence: 'DAILY',
      target_count: 3,
      current_count: 3,
      reward_coins: 15,
      is_completed: true,
      is_claimed: false,
    },
    {
      id: 3,
      title_en: 'Social Group Buying Champion',
      title_bn: 'সোশ্যাল টিম পারচেজ মিশন',
      description_en: 'Start or join a group buying team with friends',
      cadence: 'WEEKLY',
      target_count: 1,
      current_count: 0,
      reward_coins: 35,
      is_completed: false,
      is_claimed: false,
    },
  ];

  const panel = new QuestPanel({
    quests: sampleQuests,
    onRewardClaimed: (claim) => toast.success(`Specimen reward claimed: +${claim.rewardCoins || 15} coins!`),
  });

  wrap.append(specimen('Quest & Mission Widget with Filters & Progress Bars', panel.getElement()));
  return wrap;
}

function renderLeaderboardWidgetSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Monthly Seller Performance Leaderboard (Prompt 9.4)'));

  const leaderCard = document.createElement('div');
  leaderCard.className = 'card p-4 space-y-3';
  leaderCard.innerHTML = `
    <div class="flex items-center justify-between border-b pb-2">
      <h4 class="font-bold text-sm">🏆 August 2026 Seller Leaderboard</h4>
      <span class="badge badge-primary text-xs">Prize Pool: ৳50,000</span>
    </div>
    <div class="grid grid-cols-3 gap-2 text-center text-xs">
      <div class="p-2 border border-warning/50 rounded bg-warning/5">
        <div class="text-xl">🥇</div>
        <div class="font-bold">Fahim Store</div>
        <div class="text-primary font-mono font-bold">৳142,500</div>
      </div>
      <div class="p-2 border border-slate-400/40 rounded bg-slate-400/5">
        <div class="text-xl">🥈</div>
        <div class="font-bold">Dhaka Crafts</div>
        <div class="text-primary font-mono font-bold">৳118,200</div>
      </div>
      <div class="p-2 border border-amber-600/40 rounded bg-amber-600/5">
        <div class="text-xl">🥉</div>
        <div class="font-bold">Bengal Loom</div>
        <div class="text-primary font-mono font-bold">৳94,800</div>
      </div>
    </div>
  `;

  wrap.append(specimen('Leaderboard Podium & Rankings', leaderCard));
  return wrap;
}

function renderTeamPurchaseSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Social Group Buying & Team Purchase Specimen (Prompt 9.5)'));

  const teamCard = document.createElement('div');
  teamCard.className = 'card p-4 space-y-3';
  teamCard.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <span class="badge badge-accent text-xs font-bold uppercase">Team Deal</span>
        <h4 class="font-bold text-sm mt-1">Premium Silk Tangail Saree</h4>
      </div>
      <div class="text-right">
        <div class="font-mono font-bold text-sm text-primary">৳1,850.00</div>
        <div class="line-through text-xs text-muted">৳2,400.00</div>
      </div>
    </div>
    <div class="p-2.5 bg-base rounded-xl flex items-center justify-between text-xs">
      <div class="flex items-center gap-2">
        <span class="font-bold">👥 2 of 3 Joined</span>
        <span class="text-muted">• 1 Spot Left!</span>
      </div>
      <span class="font-mono font-bold text-warning">⏳ 14h 22m left</span>
    </div>
    <div class="flex gap-2">
      <button class="btn btn-sm btn-primary w-full text-xs font-bold">Join Team (৳1,850)</button>
      <button class="btn btn-sm btn-success text-xs">💬 Share</button>
    </div>
  `;

  wrap.append(specimen('Team Purchase Progress & Join Card', teamCard));
  return wrap;
}

function renderCartInsightsSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Abandoned Cart Recovery & Funnel (Prompt 9.6)'));

  const insightCard = document.createElement('div');
  insightCard.className = 'card p-4 space-y-3';
  insightCard.innerHTML = `
    <div class="grid grid-cols-3 gap-2 text-center text-xs">
      <div class="p-2 bg-base rounded">
        <div class="text-muted">Recovery Rate</div>
        <div class="font-bold text-sm text-success">33.3%</div>
      </div>
      <div class="p-2 bg-base rounded">
        <div class="text-muted">Recovered Carts</div>
        <div class="font-bold text-sm text-primary">6 Carts</div>
      </div>
      <div class="p-2 bg-base rounded">
        <div class="text-muted">Recovered Value</div>
        <div class="font-bold text-sm text-accent">৳14,800</div>
      </div>
    </div>
    <div class="p-2.5 border border-warning/30 rounded-xl bg-warning/5 flex items-center justify-between text-xs">
      <div>
        <span class="font-bold">Sadia Rahman</span>
        <span class="text-muted">• ৳2,500 Cart (4.2h ago)</span>
      </div>
      <button class="btn btn-xs btn-primary font-bold">🏷️ Send 10% Offer</button>
    </div>
  `;

  wrap.append(specimen('Cart Recovery Analytics & Offer CTA', insightCard));
  return wrap;
}

function renderSocialSellerKitSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Social Seller Kit & Dynamic Flyer Builder (Prompt 9.7)'));

  const kitCard = document.createElement('div');
  kitCard.className = 'card p-4 space-y-3';
  kitCard.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-xl">🎨</span>
        <div>
          <div class="font-bold text-sm">Flyer & Tracked QR Link Studio</div>
          <div class="text-xs text-muted">1:1 Square, 9:16 Story, A4 Print Poster</div>
        </div>
      </div>
      <span class="badge badge-primary text-xs font-bold">Vector SVG / Local QR</span>
    </div>
    <div class="p-3 bg-base border border-border rounded-xl flex items-center justify-between text-xs">
      <div class="space-y-0.5">
        <div class="font-mono text-muted">https://explooro.com/s/7f9x2a</div>
        <div class="text-[11px] text-success font-semibold">142 Clicks · 18 Orders · ৳38,500 Revenue</div>
      </div>
      <div class="flex gap-1.5">
        <button class="btn btn-xs btn-primary">📋 Copy</button>
        <button class="btn btn-xs btn-success">⬇️ Flyer</button>
      </div>
    </div>
  `;

  wrap.append(specimen('Social Seller Kit & Affiliate Link Card', kitCard));
  return wrap;
}

function renderLiveStreamCardSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Live Stream Discovery Card (Prompt 10.1)'));

  const sampleLive = {
    id: 1,
    title: 'Eid Traditional Saree Mega Live Sale & Draping Tutorial',
    host_name: 'Nusrat Jahan',
    store_name: 'Bengal Loom & Craft',
    status: 'LIVE',
    viewer_count: 248,
    product_count: 8,
    cover_image: '/placeholder-product.png',
  };

  const sampleScheduled = {
    id: 2,
    title: 'Handloom Jamdani & Silk Dupatta New Drop Demo',
    host_name: 'Fahim Rahman',
    store_name: 'Dhaka Handloom Hub',
    status: 'SCHEDULED',
    viewer_count: 0,
    product_count: 12,
    cover_image: '/placeholder-product.png',
  };

  const liveCard = LiveStreamCard({
    stream: sampleLive,
    onWatchClick: () => toast.info('Navigating to Live Stream...'),
  });

  const scheduledCard = LiveStreamCard({
    stream: sampleScheduled,
    onWatchClick: () => toast.info('Reminder set!'),
  });

  const row = document.createElement('div');
  row.style.display = 'grid';
  row.style.gridTemplateColumns = 'repeat(auto-fit, minmax(280px, 1fr))';
  row.style.gap = '16px';
  row.append(liveCard, scheduledCard);

  wrap.append(specimen('Active Live & Scheduled Broadcast Cards', row));
  return wrap;
}

function renderPinnedProductOverlaySpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('In-Stream Pinned Product Card with 1-Click Buy Now (Prompt 10.1)'));

  const sampleProduct = {
    id: 101,
    title_en: 'Premium Tangail Pure Cotton Saree - Crimson Red',
    title_bn: 'প্রিমিয়াম টাঙ্গাইল সুতি শাড়ি - লাল',
    special_price: '1,250.00',
    main_image: '/placeholder-product.png',
  };

  const overlay = PinnedProductOverlay({
    product: sampleProduct,
    onBuyClick: (p) => toast.success(`Triggered In-Stream 1-Click Buy for "${p.title_en}"`),
  });

  const previewBox = document.createElement('div');
  previewBox.style.background = '#090d16';
  previewBox.style.padding = '24px';
  previewBox.style.borderRadius = '12px';
  previewBox.append(overlay);

  wrap.append(specimen('Real-Time Pinned Deal Card (< 1s Broadcast Latency)', previewBox));
  return wrap;
}

function renderAssistantPanelConciergeSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Shopping Concierge — live against the real catalog via SSE (Prompt 10.2)'));

  const frame = document.createElement('div');
  frame.style.height = '520px';
  frame.style.maxWidth = '420px';
  frame.style.border = '1px solid var(--border-subtle)';
  frame.style.borderRadius = 'var(--radius-lg)';
  frame.style.padding = '12px';
  frame.append(AssistantPanel({ agentType: 'concierge' }));

  wrap.append(specimen('Bilingual product discovery, grounded product cards, suggested prompts', frame));
  return wrap;
}

function renderAssistantPanelSourcingSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Sourcing Intelligence — margin-ranked opportunities with 1-click import (Prompt 10.2)'));

  const frame = document.createElement('div');
  frame.style.height = '520px';
  frame.style.maxWidth = '420px';
  frame.style.border = '1px solid var(--border-subtle)';
  frame.style.borderRadius = 'var(--radius-lg)';
  frame.style.padding = '12px';
  frame.append(AssistantPanel({ agentType: 'sourcing' }));

  wrap.append(specimen('High-margin, trending products ranked from the real sourcing catalog', frame));
  return wrap;
}

function renderWarrantyCardSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Digital Warranty Protection Cards with Live Countdown (Prompt 10.4)'));

  const sampleActiveCard = {
    id: 1,
    ref: 'WAR-9K2P4L8X',
    product_title_en: 'Walton 43-inch 4K Frameless Android Smart TV',
    product_title_bn: 'ওয়ালটন ৪৩ ইঞ্চি ৪কে ফ্রেমলেস অ্যান্ড্রয়েড স্মার্ট টিভি',
    brand: 'Walton',
    warranty_months: 24,
    serial_number: 'SN-SO-9921-4401-8821',
    supplier_name: 'Walton Official Store',
    supplier_shop_name: 'Walton Official Store',
    is_active: true,
    is_transferable: true,
    starts_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 420 * 24 * 3600 * 1000).toISOString(),
    remaining_days: 420,
    remaining_hours: 14,
    remaining_minutes: 25,
    progress_percent: 18,
    coverage_terms_en: '2 Years panel & certified parts replacement. Free home servicing across all districts.',
    coverage_terms_bn: '২ বছরের প্যানেল ও পার্টস রিপ্লেসমেন্ট। সারাদেশে ফ্রি হোম সার্ভিসিং।',
  };

  const sampleExpiredCard = {
    id: 2,
    ref: 'WAR-3X7T9Q1M',
    product_title_en: 'Singer 1.5 Ton Inverter Air Conditioner',
    product_title_bn: 'সিঙ্গার ১.৫ টন ইনভার্টার এয়ার কন্ডিশনার',
    brand: 'Singer',
    warranty_months: 12,
    serial_number: 'SN-SO-7712-1002-4419',
    supplier_name: 'Singer Bangladesh',
    supplier_shop_name: 'Singer Bangladesh',
    is_active: false,
    is_transferable: false,
    starts_at: new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString(),
    expires_at: new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString(),
    remaining_days: 0,
    remaining_hours: 0,
    remaining_minutes: 0,
    progress_percent: 100,
    coverage_terms_en: '1 Year official compressor warranty.',
  };

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(320px, 1fr))';
  grid.style.gap = '20px';

  grid.append(
    WarrantyCard({
      card: sampleActiveCard,
      onClaimClick: (c) => toast.info(`Opened Claim Dialog for ${c.ref}`),
      onTransferClick: (c) => toast.info(`Initiated Transfer for ${c.ref}`),
    }),
    WarrantyCard({
      card: sampleExpiredCard,
    })
  );

  wrap.append(specimen('Active & Expired Digital Warranty Cards', grid));
  return wrap;
}

function renderClaimTimelineSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Warranty Claim Stepper Timeline & Reverse Logistics (Prompt 10.4)'));

  const sampleClaim = {
    id: 101,
    ref: 'CLM-88K2P9',
    status: 'APPROVED',
    resolution: 'REPAIR',
    issue_description: 'Display backlight flickering and panel turns black intermittently.',
    preferred_resolution: 'REPAIR',
    sla_due_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    is_sla_breached: false,
    reverse_tracking_number: 'REV-CLM-88K2P9-981',
    reverse_carrier: 'Pathao Logistics',
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    evidence_media: ['/placeholder-product.png'],
  };

  wrap.append(specimen('Approved Claim with Reverse Courier Consignment', ClaimTimeline({ claim: sampleClaim })));
  return wrap;
}

function renderBundleBreakdownSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Cross-Seller Multi-Merchant Combo Profit Breakdown (Prompt 10.5)'));

  const sampleBreakdown = {
    sum_of_parts: 3000.00,
    bundle_price: 2550.00,
    discount_amount: 450.00,
    discount_pct: 15.0,
    total_wholesale_cost: 2050.00,
    total_net_margin: 500.00,
    total_saler_commission: 200.00,
    total_platform_margin: 300.00,
    saler_margin_pct: 7.84,
    saler_split_pct: 40,
    platform_split_pct: 60,
    is_multi_supplier: true,
    supplier_count: 2,
    suppliers: [
      { supplier_id: 5, supplier_name: 'Walton Apparel', item_count: 1, total_wholesale_payout: 800.00, items: [] },
      { supplier_id: 6, supplier_name: 'Apex Footwear & Textiles', item_count: 1, total_wholesale_payout: 1250.00, items: [] },
    ],
    items: [
      {
        productId: 1,
        productTitleEn: 'Walton Formal Cotton Shirt',
        productTitleBn: 'ওয়ালটন ফর্মাল সুতি শার্ট',
        qty: 1,
        originalRetailPrice: 1200.00,
        discountShare: 180.00,
        effectiveUnitPrice: 1020.00,
        baseCost: 700.00,
        wholesaleMargin: 100.00,
        wholesaleCost: 800.00,
        netRetailMargin: 220.00,
        salerCommission: 88.00,
        platformMargin: 132.00,
      },
      {
        productId: 2,
        productTitleEn: 'Apex Executive Trousers',
        productTitleBn: 'এপেক্স এক্সিকিউটিভ ট্রাউজার',
        qty: 1,
        originalRetailPrice: 1800.00,
        discountShare: 270.00,
        effectiveUnitPrice: 1530.00,
        baseCost: 1100.00,
        wholesaleMargin: 150.00,
        wholesaleCost: 1250.00,
        netRetailMargin: 280.00,
        salerCommission: 112.00,
        platformMargin: 168.00,
      },
    ],
  };

  const widget = createBundleProfitBreakdown({ breakdown: sampleBreakdown });
  wrap.append(specimen('Multi-Supplier Bundle (Walton + Apex) with Deterministic Apportionment', widget.element));
  return wrap;
}

function renderB2bMilestoneStepperSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('B2B Wholesale Escrow Staged Milestone Stepper (Prompt 10.6)'));

  const sampleMilestones = [
    {
      id: 1,
      ref: 'MLS-8812-CONF',
      sequence_no: 1,
      label_en: 'Phase 1: Fabric Sourcing & Loom Setup',
      label_bn: 'পর্যায় ১: কাপড় সংগ্রহ ও লুম সেটআপ',
      release_pct: 30.0,
      amount: 300000.00,
      evidence_required: 'NONE',
      status: 'RELEASED',
    },
    {
      id: 2,
      ref: 'MLS-8813-DISP',
      sequence_no: 2,
      label_en: 'Phase 2: Factory Inspection & Bill of Lading Dispatch',
      label_bn: 'পর্যায় ২: কারখানা পরিদর্শন ও চালান হস্তান্তর',
      release_pct: 40.0,
      amount: 400000.00,
      evidence_required: 'DISPATCH_PROOF',
      status: 'EVIDENCE_SUBMITTED',
      evidence_media_json: {
        evidence_type: 'DISPATCH_PROOF',
        notes: 'Challan #CH-9921 signed by logistics driver.',
      },
    },
    {
      id: 3,
      ref: 'MLS-8814-INSP',
      sequence_no: 3,
      label_en: 'Phase 3: Warehouse QA Inspection & Final Acceptance',
      label_bn: 'পর্যায় ৩: গুদাম গুণমান পরিদর্শন ও চূড়ান্ত গ্রহণ',
      release_pct: 30.0,
      amount: 300000.00,
      evidence_required: 'INSPECTION',
      status: 'PENDING',
    },
  ];

  const stepper = createMilestoneProgressStepper({
    milestones: sampleMilestones,
    dealStatus: 'IN_PROGRESS',
    userRole: 'supplier',
    isBuyer: true,
    isAdmin: false,
    onEvidenceClick: (m) => toast.info(`Submitted proof for ${m.ref}`),
    onReleaseClick: (m) => toast.success(`Released funds for ${m.ref}`),
  });

  wrap.append(specimen('Staged 3-Phase Escrow Release (30% / 40% / 30%) with Evidence Gating', stepper.element));
  return wrap;
}

function renderShoppableReelsSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Shoppable Video Reels Feed (Prompt 10.8)'));

  const reels = ShoppableReels({
    onBuyProduct: (prod) => toast.info(`Clicked buy for ${prod.title_en}`),
  });

  wrap.append(specimen('Vertical Feed with Pinned Product Cards, 1-Tap Checkout & Data-Saver Mode', reels.element));
  return wrap;
}

function renderSupplierDashboardWidgetsSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Supplier / Manufacturer Dashboard Widgets (Prompt 11.1)'));

  // 1. FEFO Batch Expiry Widget Card
  const batchWidget = document.createElement('div');
  batchWidget.className = 'p-4 rounded-xl border border-amber-500/40 bg-amber-500/5 max-w-sm space-y-2';
  batchWidget.innerHTML = `
    <div class="flex justify-between items-center text-xs">
      <span class="font-mono font-bold text-primary">#LOT-2026-OCT-15</span>
      <span class="badge badge--warning">⚠️ Expiring in 45d</span>
    </div>
    <div class="font-bold text-sm">Organic Mustard Oil (500ml)</div>
    <div class="text-xs text-muted font-mono">Qty: 80 units · Depot: Tejgaon Depot</div>
    <div class="pt-2 flex gap-2">
      <button class="btn btn--2xs btn--primary flex-1">⚡ 1-Click Clearance (15% Off)</button>
    </div>
  `;

  // 2. Multi-Warehouse Node Card
  const whWidget = document.createElement('div');
  whWidget.className = 'p-4 rounded-xl border border-subtle bg-surface max-w-sm space-y-2';
  whWidget.innerHTML = `
    <div class="flex justify-between items-center text-xs">
      <span class="font-mono font-bold text-primary">WH-DHK-01</span>
      <span class="badge badge--success">🟢 Active (Priority 20)</span>
    </div>
    <div class="font-bold text-sm">Tejgaon Central Depot</div>
    <div class="text-xs text-muted">📍 Plot 12, Tejgaon I/A, Dhaka</div>
    <div class="text-xs font-mono text-green-600 font-bold">14 SKUs · 450 Units Stocked</div>
  `;

  wrap.append(
    specimen('FEFO Batch Expiration Card with 1-Click Clearance Trigger', batchWidget),
    specimen('Multi-Location Warehouse Node Card with GIS Proximity Score', whWidget)
  );

  return wrap;
}

function renderSupplierOrdersSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('Supplier Orders to Pack & 1-Click Consignment Booking'));

  const orderCard = document.createElement('div');
  orderCard.className = 'supplier-order-card';
  orderCard.innerHTML = `
    <div class="supplier-order-card__header">
      <div class="supplier-order-card__ref-group">
        <span class="supplier-order-card__ref">ORD-9K2P4L</span>
        <span class="badge badge--warning text-xs font-mono">PROCESSING</span>
        <span class="badge badge--neutral text-xs font-bold">💵 Cash on Delivery (৳ 1,950.00)</span>
      </div>
      <div class="supplier-order-card__meta">
        Customer: <strong>Nusrat Jahan</strong> (01711998877) · 📍 Dhanmondi, Dhaka
      </div>
    </div>
    <div class="supplier-order-card__items-box">
      <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 700;">
        <span>📦 Items to Pack (FEFO Directives)</span>
        <span class="font-mono text-muted">Node: Tejgaon Central Depot</span>
      </div>
      <div class="supplier-order-card__item-row" style="margin-top: 6px;">
        <div>
          <strong>Miniket Premium Rice 25kg Bag</strong>
          <span class="badge badge--info text-xs font-mono" style="margin-left: 6px;">🏷️ Lot: #LOT-2026-OCT-01</span>
        </div>
        <div style="font-weight: 800; font-family: var(--font-mono); color: var(--text-brand);">Qty: 1</div>
      </div>
    </div>
    <div class="supplier-order-card__footer">
      <div style="font-size: 12px; color: var(--warning); font-weight: 700;">
        ⚠️ Courier consignment not yet booked.
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn--xs btn--outline">📄 Print Slip</button>
        <button class="btn btn--xs btn--primary">🚚 1-Click Book (Pathao)</button>
      </div>
    </div>
  `;

  wrap.append(specimen('Supplier Order to Pack with FEFO Directive & Consignment Trigger', orderCard));
  return wrap;
}

function renderSupplierHelpSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('Supplier Hub Operational Routine Checklist & Help'));

  const helpBox = document.createElement('div');
  helpBox.className = 'supplier-checklist-card';
  helpBox.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h4 style="font-weight: 800; margin: 0;">🚀 Daily Operational Routine Checklist</h4>
      <span class="badge badge--success text-xs font-mono">4/5 Completed (80%)</span>
    </div>
    <div class="supplier-checklist-item supplier-checklist-item--done" style="margin-top: 8px;">
      <input type="checkbox" checked />
      <div>
        <div style="font-weight: 700; font-size: 13px;">1. Register & Price Your Products</div>
        <div style="font-size: 11px; color: var(--text-secondary);">Set competitive wholesale margins for Saler storefronts.</div>
      </div>
    </div>
  `;

  wrap.append(specimen('Supplier Onboarding & Daily Routine Checklist Card', helpBox));
  return wrap;
}

function renderSupplierShipmentsSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('Supplier Courier Shipments & 3PL Pipeline'));

  const card = document.createElement('div');
  card.className = 'supplier-shipment-card';
  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span class="supplier-order-card__ref">STF-88992102</span>
      <span class="badge badge--success text-xs font-mono">DELIVERED</span>
    </div>
    <div style="font-size: 13px; font-weight: 700;">Dhaka to Chittagong Express Consignment</div>
    <div class="supplier-timeline-stepper" style="margin-top: 8px;">
      <div class="supplier-timeline-step supplier-timeline-step--active"><div class="supplier-timeline-step__dot"></div><span>Picked Up</span></div>
      <div class="supplier-timeline-step supplier-timeline-step--active"><div class="supplier-timeline-step__dot"></div><span>Hub Sorting</span></div>
      <div class="supplier-timeline-step supplier-timeline-step--active"><div class="supplier-timeline-step__dot"></div><span>Delivered</span></div>
    </div>
  `;
  wrap.append(specimen('3PL Parcel Shipment Tracking Stepper', card));
  return wrap;
}

function renderSupplierInquiriesSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('Wholesale Quotation Request & Negotiation'));

  const inq = document.createElement('div');
  inq.className = 'supplier-inquiry-card';
  inq.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span class="supplier-order-card__ref">INQ-101</span>
      <span class="badge badge--warning text-xs font-mono">AWAITING QUOTE</span>
    </div>
    <div style="font-size: 13px; font-weight: 700;">Jamdani Saree Bulk Wholesale (MOQ: 150)</div>
    <p style="font-size: 12px; color: var(--text-secondary); margin: 4px 0;">Looking to purchase 150 units for Eid campaign.</p>
  `;
  wrap.append(specimen('Wholesale B2B Inquiry Card with MOQ Request', inq));
  return wrap;
}

function renderSupplierStoreStatusSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section';
  wrap.append(subgroup('Physical Factory Showroom Walk-in Status'));

  const box = document.createElement('div');
  box.className = 'supplier-store-status-card';
  box.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h4 style="margin: 0; font-weight: 800;">Showroom Walk-in Status</h4>
      <span class="badge badge--success text-xs font-bold">🟢 Open for Visitors</span>
    </div>
    <div style="font-size: 12px; color: var(--text-secondary);">Tejgaon Industrial Area Showroom (09:00 AM - 08:00 PM)</div>
  `;
  wrap.append(specimen('Physical Store & Showroom Walk-in Availability', box));
  return wrap;
}

function renderGrowthAssistantSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Prescriptive AI Growth Assistant with 1-Click Actions (Prompt 11.2)'));

  const sampleRecs = [
    {
      id: 'rec_demo_1',
      type: 'PRICE_OPPORTUNITY',
      title: 'Jamdani Silk Saree (Red & Gold)',
      message: 'Lower price by ৳120 to match peer seller volume.',
      recommendation: 'Matching the top-seller price of ৳4,800 is projected to increase order volume by 2.4x.',
      action: {
        type: 'QUICK_PRICE_MATCH',
        label_en: '⚡ Match Price (৳4,800)',
        url: '/saler/store-builder',
      },
    },
    {
      id: 'rec_demo_2',
      type: 'HERO_PRODUCT',
      title: 'Pure Mustard Oil (Cold Pressed)',
      message: 'Top-selling hero product with 32% margin.',
      recommendation: 'Bundle this with Organic Honey to create a high-converting healthy living grocery combo.',
      action: {
        type: 'CREATE_BUNDLE',
        label_en: '🎁 Build Bundle Combo',
        url: '/saler/bundles',
      },
    },
  ];

  const assistant = GrowthAssistant({ recommendations: sampleRecs });
  wrap.append(specimen('Live Advice Cards with Directly Executable 1-Click Triggers', assistant.element));
  return wrap;
}

function renderBecomeSalerCtaSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('1-Click Zero-Paperwork Saler Upgrade Component (Prompt 11.3)'));

  const cta = BecomeSalerCta({
    onUpgradeSuccess: () => toast.success('Mock upgrade triggered!'),
    onNavigate: (url) => toast.info(`Navigating to ${url}`),
  });

  wrap.append(specimen('1-Click Upgrade Hero Card with Benefits & Live Trigger', cta.element));
  return wrap;
}

function renderCatalogProductsSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Platform Catalog & Products Governance (Admin/Supplier)'));

  const preview = document.createElement('div');
  preview.className = 'catalog-stats';
  preview.innerHTML = `
    <div class="catalog-stat-card">
      <span class="catalog-stat-card__label">Total Products</span>
      <span class="catalog-stat-card__value">62</span>
      <span class="catalog-stat-card__meta">12 Active Categories</span>
    </div>
    <div class="catalog-stat-card">
      <span class="catalog-stat-card__label">In-Stock & Live</span>
      <span class="catalog-stat-card__value">58</span>
      <span class="catalog-stat-card__meta catalog-stat-card__meta--success">94% Available</span>
    </div>
    <div class="catalog-stat-card">
      <span class="catalog-stat-card__label">Low Stock (≤ 10)</span>
      <span class="catalog-stat-card__value">6</span>
      <span class="catalog-stat-card__meta catalog-stat-card__meta--warning">2 Out of Stock</span>
    </div>
    <div class="catalog-stat-card">
      <span class="catalog-stat-card__label">Potential GMV Value</span>
      <span class="catalog-stat-card__value">৳1,485,000</span>
      <span class="catalog-stat-card__meta catalog-stat-card__meta--success">48 Verified Suppliers</span>
    </div>
  `;

  wrap.append(specimen('Catalog Governance KPIs & Inventory Roster', preview));
  return wrap;
}

function renderFollowingFeedSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Followed Stores & Activity Feed Specimens (Prompt 11.3)'));

  // 1. Followed Store Card
  const storeCard = document.createElement('div');
  storeCard.className = 'store-card max-w-sm';
  storeCard.innerHTML = `
    <div>
      <div class="store-card__header">
        <div class="store-card__avatar">👗</div>
        <div class="store-card__info">
          <div class="store-card__name-row">
            <h4 class="store-card__name">Priyo Collection</h4>
            <span class="store-card__verified-badge">✓</span>
          </div>
          <div class="store-card__slug">@priyo-collection</div>
          <p class="store-card__bio">Authentic Bangladeshi Handloom, Tangail Sarees & Traditional Wear.</p>
        </div>
      </div>
      <div class="store-card__meta-bar mt-3">
        <div class="store-card__meta-item"><span aria-hidden="true">📦</span><span>42 products</span></div>
        <div class="store-card__meta-item"><span aria-hidden="true">⭐</span><span>4.9 (196 reviews)</span></div>
        <div class="store-card__meta-item"><span aria-hidden="true">👥</span><span>1,840 followers</span></div>
      </div>
    </div>
    <div class="store-card__actions">
      <button class="btn btn--primary btn--sm">Visit Storefront →</button>
      <button class="btn btn--secondary btn--sm">Unfollow</button>
    </div>
  `;

  // 1b. Unrated store — the metric is omitted, never defaulted to an invented 4.8 / "500+".
  const unratedCard = document.createElement('div');
  unratedCard.className = 'store-card max-w-sm';
  unratedCard.innerHTML = `
    <div>
      <div class="store-card__header">
        <div class="store-card__avatar" aria-hidden="true">✨</div>
        <div class="store-card__info">
          <div class="store-card__name-row">
            <h4 class="store-card__name">Notun Bazar Handicrafts</h4>
          </div>
          <div class="store-card__slug">@notun-bazar</div>
          <p class="store-card__bio">This seller has not added a description yet.</p>
        </div>
      </div>
      <div class="store-card__meta-bar mt-3">
        <div class="store-card__meta-item"><span aria-hidden="true">📦</span><span>3 products</span></div>
        <div class="store-card__meta-item store-card__meta-item--muted"><span aria-hidden="true">⭐</span><span>Not yet rated</span></div>
        <div class="store-card__meta-item"><span aria-hidden="true">👥</span><span>0 followers</span></div>
      </div>
    </div>
    <div class="store-card__actions">
      <button class="btn btn--secondary btn--sm">Visit Storefront →</button>
      <button class="btn btn--primary btn--sm">Follow Store</button>
    </div>
  `;

  // 2. Product Drop Card
  const dropCard = document.createElement('div');
  dropCard.className = 'product-drop-card max-w-[220px]';
  dropCard.innerHTML = `
    <div class="product-drop-card__media">
      <img src="/placeholder-product.svg" class="product-drop-card__img" alt="Product"/>
      <span class="product-drop-card__badge">2 hours ago</span>
    </div>
    <div class="product-drop-card__body">
      <div class="product-drop-card__store-row">
        <span class="product-drop-card__store-link"><span aria-hidden="true">🏪</span> Priyo Collection</span>
        <span class="badge badge--warning product-drop-card__discount">11% off</span>
      </div>
      <h4 class="product-drop-card__title">Royal Crimson Handloom Dhakai Jamdani Saree</h4>
      <div class="product-drop-card__pricing">
        <span class="product-drop-card__price">৳4,250.00</span>
        <span class="product-drop-card__was">৳4,800.00</span>
      </div>
    </div>
    <div class="product-drop-card__footer">
      <button class="btn btn--primary btn--sm btn--full">View Product →</button>
    </div>
  `;

  // 2b. Out-of-stock drop.
  const soldOutCard = document.createElement('div');
  soldOutCard.className = 'product-drop-card max-w-[220px]';
  soldOutCard.innerHTML = `
    <div class="product-drop-card__media">
      <img src="/placeholder-product.svg" class="product-drop-card__img" alt="Product"/>
      <span class="product-drop-card__badge">yesterday</span>
      <span class="product-drop-card__stock">Out of stock</span>
    </div>
    <div class="product-drop-card__body">
      <div class="product-drop-card__store-row">
        <span class="product-drop-card__store-link"><span aria-hidden="true">🏪</span> Rajshahi Silk</span>
      </div>
      <h4 class="product-drop-card__title">Emerald Green Pure Rajshahi Silk Dupatta</h4>
      <div class="product-drop-card__pricing">
        <span class="product-drop-card__price">৳1,450.00</span>
      </div>
    </div>
    <div class="product-drop-card__footer">
      <button class="btn btn--primary btn--sm btn--full">View Product →</button>
    </div>
  `;

  // 3. Live Broadcast Card
  const liveCard = document.createElement('div');
  liveCard.className = 'following-live-card max-w-sm';
  liveCard.innerHTML = `
    <div>
      <div class="following-live-card__head">
        <span class="following-live-badge"><span class="pulse-dot-red" aria-hidden="true"></span> LIVE</span>
        <span class="following-live-card__viewers"><span aria-hidden="true">👥</span> 142 watching</span>
      </div>
      <div class="following-live-card__body mt-2">
        <h4 class="following-live-card__title">Eid Exclusive Jamdani Showcase</h4>
        <div class="following-live-card__store mt-1"><span aria-hidden="true">🏪</span><span>Priyo Collection</span></div>
      </div>
    </div>
    <button class="btn btn--primary btn--sm btn--full">Watch &amp; Order Live</button>
  `;

  // 3b. Scheduled broadcast — carries its start time, and drops the urgent red treatment.
  const scheduledCard = document.createElement('div');
  scheduledCard.className = 'following-live-card following-live-card--scheduled max-w-sm';
  scheduledCard.innerHTML = `
    <div>
      <div class="following-live-card__head">
        <span class="following-live-badge following-live-badge--scheduled"><span aria-hidden="true">⏰</span> SCHEDULED</span>
        <span class="following-live-card__viewers"><span aria-hidden="true">🗓️</span> Starts in 3 hours</span>
      </div>
      <div class="following-live-card__body mt-2">
        <h4 class="following-live-card__title">Pure Rajshahi Silk Quality Inspection</h4>
        <div class="following-live-card__store mt-1"><span aria-hidden="true">🏪</span><span>Rajshahi Silk Emporium</span></div>
        <p class="following-live-card__schedule">28 Aug 2026</p>
      </div>
    </div>
    <button class="btn btn--secondary btn--sm btn--full">View Broadcast</button>
  `;

  // 4. KPI tile — a real <button>, so it is reachable by Tab and activated by Enter/Space.
  const kpiTile = document.createElement('div');
  kpiTile.className = 'following-kpis max-w-md';
  kpiTile.innerHTML = `
    <button type="button" class="following-kpi-card" aria-label="Show Followed Stores">
      <span class="following-kpi-card__head">
        <span class="following-kpi-card__label">Followed Stores</span>
        <span class="following-kpi-card__icon" aria-hidden="true">🏪</span>
      </span>
      <span class="following-kpi-card__val">1</span>
      <span class="following-kpi-card__sub">1 shop saved</span>
    </button>
    <button type="button" class="following-kpi-card" aria-label="Show New Drops">
      <span class="following-kpi-card__head">
        <span class="following-kpi-card__label">New Drops</span>
        <span class="following-kpi-card__icon" aria-hidden="true">✨</span>
      </span>
      <span class="following-kpi-card__val">6</span>
      <span class="following-kpi-card__sub">Freshly curated arrivals</span>
    </button>
  `;

  wrap.append(
    specimen('Followed Merchant Store Card', storeCard),
    specimen('Store Card — unrated / no metrics to show', unratedCard),
    specimen('Product Drop Arrival Card', dropCard),
    specimen('Product Drop — out of stock', soldOutCard),
    specimen('Live Shopping Broadcast Card', liveCard),
    specimen('Scheduled Broadcast Card', scheduledCard),
    specimen('Activity KPI Tiles (keyboard-reachable)', kpiTile)
  );

  return wrap;
}

function renderCustomerReviewCardSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Customer Published Review Card with Verified Purchase & Lightbox'));

  const sampleReview = {
    id: 1,
    product_ref: 'PRD-8F2K9QX7',
    product_title_en: 'Premium Cotton Saree — Deep Maroon',
    product_title_bn: 'প্রিমিয়াম কটন শাড়ি — মেরুন',
    product_image: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=80',
    product_price: '1,250.00',
    store_ref: 'STR-RAHIM001',
    rating: 5,
    title: 'Beautiful fabric, colour is exact!',
    body: 'The saree drapes beautifully and the colour matches the photos exactly. Delivered well packed within 3 days to Dhaka.',
    reviewer_name: 'Dev Customer',
    is_verified_purchase: true,
    helpful_count: 14,
    coins_earned: 20,
    created_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    media: [
      { id: 901, url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500', media_kind: 'IMAGE' },
    ],
  };

  const card = CustomerReviewCard({
    review: sampleReview,
    onEdit: (r) => toast.info(`Editing review #${r.id}`),
    onDelete: (r) => toast.error(`Deleting review #${r.id}`),
  });

  wrap.append(specimen('5-Star Verified Purchase Review with Attached Photo', card));
  return wrap;
}

function renderPendingReviewCardSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Delivered Purchase Awaiting Customer Review & Coin Bonus'));

  const samplePending = {
    order_item_id: 'MOCK-OI-1',
    product_ref: 'PRD-9K1L4XC6',
    product_title_en: 'Authentic Handloom Tant Saree — Gold Zari Border',
    product_title_bn: 'হাতে বোনা তাঁতের শাড়ি — জরি পাড়',
    product_image: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=500&auto=format&fit=crop&q=80',
    product_price: '3,200.00',
    store_name: 'Rahim Handloom & Silks',
    order_ref: 'ORD-849102',
    delivered_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    potential_coins: { text_photo: 20, video: 40 },
  };

  const card = PendingReviewCard({
    item: samplePending,
    onWriteReview: (item) => toast.info(`Opening review writer for ${item.product_title_en}`),
  });

  wrap.append(specimen('Delivered Item Card with +20/+40 Coin Bounty Callout', card));
  return wrap;
}

function renderCustomerAddressCardSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Customer Saved Delivery Address Cards (Primary & Standard)'));

  const sampleDefault = {
    id: 1,
    label: 'HOME',
    recipient_name: 'Fatema Begum',
    recipient_phone: '+8801711223344',
    division: 'dhaka',
    district: 'dhaka_city',
    upazila: 'Dhanmondi',
    address_line: 'House 42, Road 7/A, Dhanmondi R/A',
    delivery_notes: 'Ring the calling bell twice; leave at main gate if unavailable',
    postal_code: '1205',
    is_default: true,
  };

  const sampleOffice = {
    id: 2,
    label: 'OFFICE',
    custom_label: 'Tech HQ',
    recipient_name: 'Tanvir Ahmed',
    recipient_phone: '+8801812345678',
    division: 'dhaka',
    district: 'dhaka_city',
    upazila: 'Gulshan',
    address_line: 'Level 8, Concord Tower, Gulshan 2',
    delivery_notes: 'Deliver between 9 AM - 6 PM on weekdays',
    postal_code: '1212',
    is_default: false,
  };

  const grid = document.createElement('div');
  grid.className = 'addresses-grid';

  const card1 = document.createElement('div');
  card1.className = 'address-card address-card--default';
  card1.innerHTML = `
    <div class="address-card__header">
      <div class="address-card__type-tag address-card__type-tag--home">🏠 Home</div>
      <div class="address-card__default-badge">⭐ Default</div>
    </div>
    <div class="address-card__body">
      <div class="address-card__recipient">${sampleDefault.recipient_name}</div>
      <div class="address-card__phone-row">${sampleDefault.recipient_phone}</div>
      <div class="address-card__address-text">${sampleDefault.address_line}</div>
      <div class="address-card__geo-hierarchy">📍 Dhanmondi, Dhaka City, Dhaka - 1205</div>
      <div class="address-card__notes">📝 ${sampleDefault.delivery_notes}</div>
    </div>
    <div class="address-card__footer">
      <span class="text-xs text-muted font-bold">Primary Delivery</span>
      <button class="btn btn--secondary btn--xs">Edit</button>
    </div>
  `;

  const card2 = document.createElement('div');
  card2.className = 'address-card';
  card2.innerHTML = `
    <div class="address-card__header">
      <div class="address-card__type-tag address-card__type-tag--office">🏢 Tech HQ</div>
    </div>
    <div class="address-card__body">
      <div class="address-card__recipient">${sampleOffice.recipient_name}</div>
      <div class="address-card__phone-row">${sampleOffice.recipient_phone}</div>
      <div class="address-card__address-text">${sampleOffice.address_line}</div>
      <div class="address-card__geo-hierarchy">📍 Gulshan, Dhaka City, Dhaka - 1212</div>
      <div class="address-card__notes">📝 ${sampleOffice.delivery_notes}</div>
    </div>
    <div class="address-card__footer">
      <button class="btn btn--ghost btn--xs">Set Default</button>
      <button class="btn btn--secondary btn--xs">Edit</button>
    </div>
  `;

  grid.append(card1, card2);
  wrap.append(specimen('Responsive Address Cards with Tags and Default Badge', grid));
  return wrap;
}

/**
 * Master Colour engine specimen. Renders the SAME seed through the generator for every preset so
 * the ramps can be compared side by side — this is the fastest way to spot a seed whose ramp
 * collapses (steps that read identical) before it is ever published.
 */
function renderMasterPaletteSpecimen() {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-section space-y-4';
  wrap.append(subgroup('Master Colour ramps — one seed generates every ramp step'));

  const strip = (label, entries) => {
    const row = document.createElement('div');
    row.className = 'theme-ramp-strip';
    const name = document.createElement('span');
    name.className = 'theme-ramp-strip__label';
    name.textContent = label;
    const swatches = document.createElement('div');
    swatches.className = 'theme-ramp-strip__swatches';
    for (const [step, hex] of entries) {
      const sw = document.createElement('span');
      sw.className = 'theme-ramp-strip__swatch';
      sw.style.background = hex;
      sw.title = `${step} — ${hex}`;
      swatches.append(sw);
    }
    row.append(name, swatches);
    return row;
  };

  for (const preset of Object.values(MASTER_PRESETS)) {
    const palette = generatePalette(preset.master);
    const block = document.createElement('div');
    block.className = 'theme-master__ramps';
    block.append(
      strip('Brand', BRAND_STEPS.map((k) => [k, palette.brand[k]])),
      strip('Neutral', NEUTRAL_STEPS.map((k) => [k, palette.neutral[k]])),
      strip('Status', [
        ['success', palette.success[500]],
        ['warning', palette.warning[500]],
        ['danger', palette.danger[500]],
        ['info', palette.info[500]],
        ['accent', palette.accent[300]],
      ]),
    );

    const meta = document.createElement('p');
    meta.className = 'theme-master__blurb';
    meta.textContent = `seed ${preset.master.seed} · hue ${palette.meta.seedHue}° · neutral hue `
      + `${palette.meta.neutralHue}° (${preset.master.neutralMode}) · accent hue `
      + `${palette.meta.accentHue}° (${preset.master.accentHarmony}) · anchored at brand-`
      + `${palette.meta.anchorStep} · chroma x${palette.meta.chromaScale}`;
    block.append(meta);

    wrap.append(specimen(preset.name_en, block));
  }

  return wrap;
}
