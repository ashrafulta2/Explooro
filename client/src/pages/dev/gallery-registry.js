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
import { CategoryPills } from '../../components/product/CategoryPills.js';
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
  ];
}
