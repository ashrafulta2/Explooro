/**
 * Mock handlers for the product catalog — cursor-paginated per docs/api-contract.md §4.1.
 */
import products from '../fixtures/products.json' with { type: 'json' };
import stores from '../fixtures/stores.json' with { type: 'json' };
import { resolveMockMediaUrl } from './media.js';

function traceId() {
  return `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

// A tiny Banglish → Bengali seed map so "shari"/"saree" find "শাড়ি" in mock mode. The real
// engine (Prompt 4.4) replaces this with server/src/utils/transliterate.js + the i18n_strings
// table — this is only here so the mock search feels like the finished feature during preview.
const SEARCH_SYNONYMS = {
  saree: ['শাড়ি'], shari: ['শাড়ি'], sari: ['শাড়ি'],
  panjabi: ['পাঞ্জাবি'], panjabi_: ['পাঞ্জাবি'], punjabi: ['পাঞ্জাবি'],
  kurti: ['কুর্তি'], jhola: ['ব্যাগ'], bag: ['ব্যাগ', 'bag'],
  juta: ['জুতা'], joota: ['জুতা'], shoe: ['জুতা', 'shoe'],
  modhu: ['মধু'], honey: ['মধু', 'honey'], cha: ['চা', 'tea'], tea: ['চা', 'tea'],
  gohona: ['গহনা'], jewellery: ['গহনা'], jewelry: ['গহনা'],
};

/** Expands a raw query into the lowercased needles the mock search should test against. */
function searchNeedles(raw) {
  const q = (raw || '').toLowerCase().trim();
  if (!q) return [];
  const needles = new Set([q]);
  for (const word of q.split(/\s+/)) {
    if (SEARCH_SYNONYMS[word]) for (const syn of SEARCH_SYNONYMS[word]) needles.add(syn.toLowerCase());
  }
  return [...needles];
}

/** True when any needle is a substring of the product's searchable text. */
function productMatchesQuery(p, raw) {
  const needles = searchNeedles(raw);
  if (needles.length === 0) return true;
  const haystack = [
    p.title_en, p.title_bn, p.category, p.category_bn, p.brand, p.district, p.ref,
    p.description_en, p.description_bn,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return needles.some((n) => haystack.includes(n));
}

// Response time copy keyed by trust tier — mirrors server/src/services/product.service.js's
// RESPONSE_TIME_BY_TIER (chat/messaging response tracking doesn't exist yet, Phase 8).
const RESPONSE_TIME_BY_TIER = {
  elite: { en: 'Usually responds within 1 hour', bn: 'সাধারণত ১ ঘণ্টার মধ্যে সাড়া দেয়' },
  verified: { en: 'Usually responds within a few hours', bn: 'সাধারণত কয়েক ঘণ্টার মধ্যে সাড়া দেয়' },
  standard: { en: 'Usually responds within a day', bn: 'সাধারণত এক দিনের মধ্যে সাড়া দেয়' },
};

const VARIANT_ATTRS_BY_CATEGORY = {
  Clothing: [
    { size: 'M' }, { size: 'L' }, { size: 'XL' },
  ],
  Electronics: [
    { color: 'Black' }, { color: 'White' },
  ],
  Footwear: [
    { size: '40' }, { size: '42' }, { size: '44' },
  ],
};

/** Deterministic (no Math.random) so the same product always shows the same demo variants —
 * a random reshuffle on every render would make "select a variant" look broken. */
export function synthesizeVariants(product) {
  const attrsList = VARIANT_ATTRS_BY_CATEGORY[product.category];
  if (!attrsList) return [];

  return attrsList.map((attrs, i) => {
    const isLast = i === attrsList.length - 1;
    const key = Object.values(attrs)[0];
    return {
      id: `${product.ref}-V${i}`,
      sku: `${product.ref}-${key}`,
      attributes: attrs,
      price_delta: i === attrsList.length - 1 ? 50 : 0,
      // The last combo of every variant set is deliberately out of stock, so VariantSelector's
      // "disabled with an explanation, not hidden" rule (Prompt 4.6 REQUIREMENT 2) has something
      // real to demonstrate on every product that has variants at all.
      stock_qty: isLast ? 0 : Math.max(3, product.stock % 20),
      image_index: (product.image_index + i) % 10,
    };
  });
}

function synthesizeImages(product) {
  const primaryUrl = product.image_url || null;
  return [0, 1, 2].map((i) => ({
    id: `${product.ref}-IMG${i}`,
    url: primaryUrl,
    is_primary: i === 0,
    image_index: (product.image_index + i) % 10,
  }));
}

export function synthesizeSupplier(product) {
  const store = stores.find((s) => s.ref === product.store_ref);
  const tier = product.supplier_tier || 'standard';
  return {
    ref: product.store_ref,
    name: store?.name_en || `${product.district} Supplier Co.`,
    district: store?.district || product.district,
    tier,
    is_verified: tier !== 'standard',
    response_time_en: RESPONSE_TIME_BY_TIER[tier]?.en,
    response_time_bn: RESPONSE_TIME_BY_TIER[tier]?.bn,
  };
}

export function synthesizeDescription(product) {
  return {
    description_en:
      product.description_en ||
      `${product.title_en} from a ${product.supplier_tier} supplier in ${product.district}. Sourced directly and quality-checked before listing.`,
    description_bn:
      product.description_bn ||
      `${product.district} থেকে ${product.title_bn} — সরাসরি সংগ্রহ করা এবং তালিকাভুক্তির আগে মান যাচাই করা হয়েছে।`,
  };
}

/** Mirrors the shape server/src/services/pricing.service.js's calculatePricingBreakdown returns —
 * the mock fixture only carries a flat `margin_pct` (the saler-facing badge value), so the rest of
 * the breakdown is reverse-engineered from it for display purposes. The real split arithmetic
 * lives only in pricing.service.js; this is presentation data for a page that has no real backend
 * order behind it in mock mode. */
function synthesizePricing(product) {
  const retail = Number(product.price);
  const platformProfitPct = 10;
  const salerProfitPct = 20;
  const extraMarkupPlatformPct = 20;

  // Wholesale cost derived so retail = wholesale + 10% platform profit + 20% saler profit
  const wholesaleCost = Number((retail / (1 + (platformProfitPct + salerProfitPct) / 100)).toFixed(2));
  const wholesaleMargin = Number((wholesaleCost * 0.1).toFixed(2));
  const baseCost = Number((wholesaleCost - wholesaleMargin).toFixed(2));

  const platformDefaultProfit = Number((wholesaleCost * (platformProfitPct / 100)).toFixed(2));
  const salerDefaultProfit = Number((wholesaleCost * (salerProfitPct / 100)).toFixed(2));
  const minRetailPrice = Number((wholesaleCost + platformDefaultProfit).toFixed(2));

  return {
    base_cost: baseCost,
    wholesale_margin: wholesaleMargin,
    wholesale_cost: wholesaleCost,
    retail_price: retail,
    default_retail_price: retail,
    min_retail_price: minRetailPrice,
    net_retail_margin: Number((platformDefaultProfit + salerDefaultProfit).toFixed(2)),
    saler_earning: salerDefaultProfit,
    saler_default_earning: salerDefaultProfit,
    platform_earning: platformDefaultProfit,
    platform_default_earning: platformDefaultProfit,
    platform_default_profit_pct: platformProfitPct,
    saler_default_profit_pct: salerProfitPct,
    extra_markup_platform_pct: extraMarkupPlatformPct,
    price_status: 'DEFAULT',
    saler_split_pct: 40,
    platform_split_pct: 60,
    saler_margin_pct: Number(((salerDefaultProfit / retail) * 100).toFixed(1)),
    total_margin_pct: Number((((platformDefaultProfit + salerDefaultProfit) / retail) * 100).toFixed(1)),
  };
}

/** Attaches everything ProductDetailPage needs beyond the flat catalog-listing shape. */
function toDetailShape(product) {
  return {
    ...product,
    ...synthesizeDescription(product),
    variants: synthesizeVariants(product),
    // Uploaded photos (media_id set) win over the synthesized gallery, as product_images does live.
    images: product.images?.length ? product.images : synthesizeImages(product),
    supplier: synthesizeSupplier(product),
    pricing: synthesizePricing(product),
    has_variants: synthesizeVariants(product).length > 0,
  };
}

function encodeCursor(index) {
  return btoa(JSON.stringify({ i: index }));
}

function decodeCursor(cursor) {
  try {
    return JSON.parse(atob(cursor)).i ?? 0;
  } catch {
    return 0;
  }
}

function notFound(message_en, message_bn) {
  return {
    status: 404,
    body: { error: { code: 'NOT_FOUND', message_en, message_bn, trace_id: traceId() } },
  };
}

function toPaisa(amount) {
  if (amount === undefined || amount === null || amount === '') return 0;
  const num = typeof amount === 'number' ? amount : parseFloat(amount);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

// In-memory mutable products store initialized from static fixtures.
// WHY ids here: live list rows carry the numeric `id` that POST /admin/growth/campaigns/flash-sales
// takes as product_id; fixture rows only had `ref`. Fixtures already flagged is_flash_sale get a
// synthetic flash_sale_id (the live list's fs.id) so "End flash sale" has a deal to stop.
const FIXTURE_FLASH_ID_FLOOR = 800_000;
let activeProducts = products.map((p, i) => ({
  id: i + 1,
  ...p,
  ...(p.is_flash_sale && !p.flash_sale_id ? { flash_sale_id: FIXTURE_FLASH_ID_FLOOR + i + 1 } : {}),
}));

export function findMockProductById(id) {
  return activeProducts.find((p) => String(p.id) === String(id)) || null;
}

/** Points a product at its live flash sale, or clears it (`deal` = null) — the list's LEFT JOIN. */
export function setMockProductFlashSale(productId, deal) {
  const p = findMockProductById(productId);
  if (!p) return;
  p.is_flash_sale = Boolean(deal);
  p.flash_sale_id = deal?.id ?? null;
  p.flash_discount_price = deal?.discount_price ?? null;
  p.flash_ends_at = deal?.ends_at ?? null;
}

export function findMockProductByFlashSaleId(flashSaleId) {
  return activeProducts.find((p) => String(p.flash_sale_id) === String(flashSaleId)) || null;
}

// In-memory store items for mock saler storefront
const mockSalerStoreItems = [
  {
    id: 1,
    store_id: 1,
    saler_id: 6,
    product_id: 'PRD-8F2K9QX7',
    product_ref: 'PRD-8F2K9QX7',
    title_en: 'Premium Cotton Saree',
    title_bn: 'প্রিমিয়াম কটন শাড়ি',
    custom_retail_price: 1350.0,
    collection_name: 'Featured',
    display_order: 1,
    is_active: true,
    added_at: new Date(Date.now() - 86400000).toISOString(),
  },
];

// Names match the admin catalog page's category filter so a product created in mock mode
// shows up under it.
const MOCK_CATEGORIES = [
  { id: 1, name_en: 'Clothing', name_bn: 'পোশাক', slug: 'clothing', parent_id: null },
  { id: 2, name_en: 'Electronics', name_bn: 'ইলেকট্রনিক্স', slug: 'electronics', parent_id: null },
  { id: 3, name_en: 'Kids', name_bn: 'শিশু', slug: 'kids', parent_id: null },
  { id: 4, name_en: 'Food & Grocery', name_bn: 'খাদ্য ও মুদি', slug: 'food-grocery', parent_id: null },
  { id: 5, name_en: 'Beauty & Health', name_bn: 'সৌন্দর্য ও স্বাস্থ্য', slug: 'beauty-health', parent_id: null },
  { id: 6, name_en: 'Crafts', name_bn: 'হস্তশিল্প', slug: 'crafts', parent_id: null },
  { id: 7, name_en: 'Home & Kitchen', name_bn: 'ঘর ও রান্নাঘর', slug: 'home-kitchen', parent_id: null },
  { id: 8, name_en: 'Jewellery', name_bn: 'গহনা', slug: 'jewellery', parent_id: null },
  { id: 9, name_en: 'Footwear', name_bn: 'জুতা', slug: 'footwear', parent_id: null },
  { id: 10, name_en: 'Furniture', name_bn: 'আসবাবপত্র', slug: 'furniture', parent_id: null },
  { id: 11, name_en: 'Bags', name_bn: 'ব্যাগ', slug: 'bags', parent_id: null },
  { id: 12, name_en: 'Wholesale', name_bn: 'পাইকারি', slug: 'wholesale', parent_id: null },
];

export default [
  {
    method: 'GET',
    path: '/products',
    handler({ query }) {
      let filtered = [...activeProducts];

      if (query.q || query.search) {
        filtered = filtered.filter((p) => productMatchesQuery(p, query.q || query.search));
      }
      if (query.category && query.category !== 'all') {
        filtered = filtered.filter((p) => p.category === query.category);
      }
      if (query.min_price) {
        filtered = filtered.filter((p) => Number(p.price) >= Number(query.min_price));
      }
      if (query.max_price) {
        filtered = filtered.filter((p) => Number(p.price) <= Number(query.max_price));
      }
      if (query.in_stock === '1') {
        filtered = filtered.filter((p) => (p.stock ?? 0) > 0);
      }
      if (query.flash_sale === '1' || query.flash_sale === 'true' || query.flash_sale === true) {
        filtered = filtered.filter((p) => Boolean(p.is_flash_sale));
      }
      if (query.supplier_tier) {
        const tiers = query.supplier_tier.split(',');
        filtered = filtered.filter((p) => tiers.includes(p.supplier_tier));
      }
      if (query.tier) {
        const tiers = query.tier.split(',');
        filtered = filtered.filter((p) => tiers.includes(p.supplier_tier));
      }
      if (query.district) {
        const normalizeDist = (d) => {
          if (!d) return '';
          const s = String(d).toLowerCase().trim();
          if (s === 'chittagong') return 'chattogram';
          if (s === 'comilla') return 'cumilla';
          if (s === 'barisal') return 'barishal';
          if (s === 'bogra') return 'bogura';
          if (s === 'jessore') return 'jashore';
          return s;
        };
        const target = normalizeDist(query.district);
        filtered = filtered.filter((p) => normalizeDist(p.district) === target);
      }
      if (query.min_rating) {
        filtered = filtered.filter((p) => (p.rating ?? 0) >= Number(query.min_rating));
      }
      if (query.min_margin) {
        filtered = filtered.filter((p) => (p.margin_pct ?? 0) >= Number(query.min_margin));
      }
      if (query.sort) {
        if (query.sort === 'price_asc') {
          filtered.sort((a, b) => Number(a.price) - Number(b.price));
        } else if (query.sort === 'price_desc') {
          filtered.sort((a, b) => Number(b.price) - Number(a.price));
        } else if (query.sort === 'rating') {
          filtered.sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0));
        } else if (query.sort === 'newest') {
          filtered.sort((a, b) => String(b.id || '').localeCompare(String(a.id || '')));
        }
      }

      const limit = Math.min(Number(query.limit) || 100, 200);
      const start = query.cursor ? decodeCursor(query.cursor) : 0;
      const page = filtered.slice(start, start + limit);
      const nextIndex = start + limit;
      const hasMore = nextIndex < filtered.length;
      return {
        status: 200,
        body: {
          data: { products: page },
          meta: {
            cursor: { next: hasMore ? encodeCursor(nextIndex) : null, has_more: hasMore },
            count: page.length,
            total: filtered.length,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/products/:id',
    handler({ params }) {
      const rawId = String(params?.id || '').trim();
      const idParam = decodeURIComponent(rawId);
      const numIdx = Number(idParam);
      const product = activeProducts.find((p, idx) =>
        p.ref === idParam ||
        p.slug === idParam ||
        String(p.id) === idParam ||
        p.ref === rawId ||
        p.slug === rawId ||
        p.ref?.toLowerCase() === idParam.toLowerCase() ||
        p.slug?.toLowerCase() === idParam.toLowerCase() ||
        (!isNaN(numIdx) && numIdx > 0 && (idx === numIdx - 1 || numIdx === 1))
      ) || activeProducts[0];

      if (!product) {
        return notFound(`No product with ref "${params.id}".`, `"${params.id}" নামে কোনো পণ্য নেই।`);
      }
      return { status: 200, body: { data: { product: toDetailShape(product) } } };
    },
  },
  {
    method: 'GET',
    path: '/catalog/categories',
    handler() {
      return { status: 200, body: { data: { categories: MOCK_CATEGORIES } } };
    },
  },
  {
    method: 'POST',
    path: '/products',
    handler({ body }) {
      const b = body || {};
      // Mirrors the live contract (server/src/services/product.service.js createProduct).
      if (!b.title_en || !b.title_bn || !b.category_id) {
        return {
          status: 400, // live VALIDATION_FAILED status (errorHandler.js)
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message_en: 'Title (English & Bangla) and category are required.',
              message_bn: 'শিরোনাম (ইংরেজি ও বাংলা) এবং ক্যাটাগরি আবশ্যক।',
            },
          },
        };
      }
      // Same rule as the live API: media_ids must be product images this session uploaded.
      const mediaIds = Array.isArray(b.media_ids) ? b.media_ids : [];
      const imageUrls = mediaIds.map((id) => resolveMockMediaUrl(id));
      if (b.media_ids !== undefined && (!Array.isArray(b.media_ids) || imageUrls.some((u) => !u))) {
        return {
          status: 400, // live VALIDATION_FAILED status (errorHandler.js)
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message_en: 'One or more images are not product images you uploaded.',
              message_bn: 'এক বা একাধিক ছবি আপনার আপলোড করা প্রোডাক্ট ছবি নয়।',
            },
          },
        };
      }
      const category = MOCK_CATEGORIES.find((c) => String(c.id) === String(b.category_id));
      const retail = parseFloat(b.default_retail_price) || 0;
      const cost = (parseFloat(b.base_cost) || 0) + (parseFloat(b.wholesale_margin) || 0);
      const ref = b.ref || `PRD-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      const newProduct = {
        ref,
        id: activeProducts.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0) + 1,
        title_en: b.title_en,
        title_bn: b.title_bn,
        price: retail.toFixed(2),
        currency: b.currency || 'BDT',
        district: b.district || 'Dhaka',
        store_ref: b.store_ref || 'STR-RAHIM001',
        stock: parseInt(b.stock_qty, 10) || 0,
        category: category?.name_en || 'Clothing',
        category_bn: category?.name_bn || 'পোশাক',
        rating: b.rating ? String(b.rating) : '4.5',
        rating_count: b.rating_count || 1,
        supplier_tier: b.supplier_tier || 'verified',
        margin_pct: retail > 0 ? Math.round(((retail - cost) / retail) * 100) : 0,
        image_index: Math.floor(Math.random() * 10),
        is_flash_sale: Boolean(b.is_flash_sale),
        store_open: true,
        is_verified_supplier: b.supplier_tier === 'verified' || b.supplier_tier === 'elite',
        image_url: imageUrls[0] || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=80',
        images: imageUrls.map((url, i) => ({ media_id: Number(mediaIds[i]), url, display_order: i, is_primary: i === 0 })),
        brand: b.brand || null,
        description_en: b.description_en || 'High quality commercial sample product listed on platform.',
        description_bn: b.description_bn || 'প্ল্যাটফর্মে তালিকাভুক্ত উচ্চ মানের বাণিজ্যিক স্যাম্পল পণ্য।',
        created_at: new Date().toISOString(),
      };

      activeProducts.unshift(newProduct);

      return {
        status: 201,
        body: {
          data: { product: newProduct },
          meta: {
            message_en: 'Product created and listed successfully in catalog.',
            message_bn: 'পণ্য সফলভাবে তৈরি এবং ক্যাটালগে যুক্ত করা হয়েছে।',
          },
        },
      };
    },
  },
  {
    method: 'PUT',
    path: '/products/:id',
    handler({ params, body }) {
      const idParam = String(params?.id || '');
      const idx = activeProducts.findIndex((p) => p.ref === idParam || String(p.id) === idParam);
      if (idx === -1) {
        return notFound(`Product "${idParam}" not found.`, `"${idParam}" পণ্যটি পাওয়া যায়নি।`);
      }

      const b = body || {};
      const updated = {
        ...activeProducts[idx],
        ...b,
        price: b.price !== undefined ? (parseFloat(b.price) || 0).toFixed(2) : activeProducts[idx].price,
        stock: b.stock !== undefined ? parseInt(b.stock, 10) : activeProducts[idx].stock,
        margin_pct: b.margin_pct !== undefined ? parseFloat(b.margin_pct) : activeProducts[idx].margin_pct,
        updated_at: new Date().toISOString(),
      };

      activeProducts[idx] = updated;

      return {
        status: 200,
        body: {
          data: { product: updated },
          meta: {
            message_en: 'Product updated successfully.',
            message_bn: 'পণ্য সফলভাবে আপডেট করা হয়েছে।',
          },
        },
      };
    },
  },
  {
    // Mirrors the live PATCH (server/src/services/product.service.js updateProduct): live column
    // names, id-or-ref lookup, and media_ids replacing the photo set (at least one required).
    method: 'PATCH',
    path: '/products/:id',
    handler({ params, body }) {
      const idParam = decodeURIComponent(String(params?.id || ''));
      const idx = activeProducts.findIndex((p) => p.ref === idParam || String(p.id) === idParam);
      if (idx === -1) {
        return notFound(`Product "${idParam}" not found.`, `"${idParam}" পণ্যটি পাওয়া যায়নি।`);
      }
      const b = body || {};
      const current = activeProducts[idx];
      const invalid = (en, bn) => ({
        status: 400, // live VALIDATION_FAILED status (errorHandler.js)
        body: { error: { code: 'VALIDATION_FAILED', message_en: en, message_bn: bn } },
      });

      let images = current.images;
      if (b.media_ids !== undefined) {
        if (!Array.isArray(b.media_ids) || b.media_ids.length === 0) {
          return invalid('A product needs at least one photo.', 'একটি প্রোডাক্টে অন্তত একটি ছবি থাকতে হবে।');
        }
        const attached = new Map((current.images || []).map((i) => [String(i.media_id), i.url]));
        const urls = b.media_ids.map((id) => attached.get(String(id)) || resolveMockMediaUrl(id));
        if (urls.some((u) => !u)) {
          return invalid('One or more images are not product images you uploaded.', 'এক বা একাধিক ছবি আপনার আপলোড করা প্রোডাক্ট ছবি নয়।');
        }
        images = urls.map((url, i) => ({ media_id: Number(b.media_ids[i]), url, display_order: i, is_primary: i === 0 }));
      }

      const category = b.category_id !== undefined ? MOCK_CATEGORIES.find((c) => String(c.id) === String(b.category_id)) : null;
      const retail = b.default_retail_price !== undefined ? parseFloat(b.default_retail_price) : parseFloat(current.price);
      const updated = {
        ...current,
        ...(b.title_en !== undefined && { title_en: b.title_en }),
        ...(b.title_bn !== undefined && { title_bn: b.title_bn }),
        ...(b.description_en !== undefined && { description_en: b.description_en }),
        ...(b.description_bn !== undefined && { description_bn: b.description_bn }),
        ...(b.brand !== undefined && { brand: b.brand }),
        ...(category && { category_id: category.id, category: category.name_en, category_bn: category.name_bn }),
        ...(b.stock_qty !== undefined && { stock: parseInt(b.stock_qty, 10) || 0 }),
        price: retail.toFixed(2),
        ...(b.base_cost !== undefined && retail > 0 && {
          margin_pct: Math.round(((retail - parseFloat(b.base_cost) - (parseFloat(b.wholesale_margin) || 0)) / retail) * 100),
        }),
        ...(images && { images, image_url: images[0]?.url || current.image_url }),
        updated_at: new Date().toISOString(),
      };
      activeProducts[idx] = updated;
      return { status: 200, body: { data: { product: updated } } };
    },
  },
  {
    // Mirrors POST /products/:id/restock (product.service.js restockProduct): adds to stored stock.
    method: 'POST',
    path: '/products/:id/restock',
    handler({ params, body }) {
      const idParam = decodeURIComponent(String(params?.id || ''));
      const p = activeProducts.find((x) => x.ref === idParam || String(x.id) === idParam);
      if (!p) return notFound(`Product "${idParam}" not found.`, `"${idParam}" পণ্যটি পাওয়া যায়নি।`);
      const qty = Number(body?.quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        return {
          status: 400, // live VALIDATION_FAILED status (errorHandler.js)
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message_en: 'Quantity must be a whole number of at least 1.',
              message_bn: 'পরিমাণ অবশ্যই ১ বা তার বেশি পূর্ণ সংখ্যা হতে হবে।',
            },
          },
        };
      }
      p.stock = (Number(p.stock) || 0) + qty;
      const product = { id: p.id, ref: p.ref, stock_qty: p.stock };
      return { status: 200, body: { data: { product }, product } };
    },
  },
  {
    method: 'DELETE',
    path: '/products/:id',
    handler({ params }) {
      const idParam = String(params?.id || '');
      const initialLength = activeProducts.length;
      activeProducts = activeProducts.filter((p) => p.ref !== idParam && String(p.id) !== idParam);
      if (activeProducts.length === initialLength) {
        return notFound(`Product "${idParam}" not found.`, `"${idParam}" পণ্যটি পাওয়া যায়নি।`);
      }

      return {
        status: 200,
        body: {
          data: { success: true, ref: idParam },
          meta: {
            message_en: 'Product removed from catalog.',
            message_bn: 'পণ্য ক্যাটালগ থেকে মুছে ফেলা হয়েছে।',
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/admin/catalog/stats',
    // WHY this mirrors server/src/services/product.service.js getCatalogStats() field for field:
    // the admin catalog page reads this contract in mock mode and the Fastify route in live mode.
    // When the two drifted, the panel silently changed meaning depending on VITE_API_MODE.
    handler() {
      const LOW_STOCK_THRESHOLD = 10;
      const thresholdFor = (p) => Number(p.low_stock_threshold ?? LOW_STOCK_THRESHOLD) || LOW_STOCK_THRESHOLD;
      const isVerified = (p) => p.supplier_tier === 'verified' || p.supplier_tier === 'elite';

      const totalProducts = activeProducts.length;
      const inStockCount = activeProducts.filter((p) => (p.stock ?? 0) > 0).length;
      const lowStockCount = activeProducts.filter((p) => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= thresholdFor(p)).length;
      const outOfStockCount = activeProducts.filter((p) => (p.stock ?? 0) === 0).length;
      const flashSaleCount = activeProducts.filter((p) => Boolean(p.is_flash_sale)).length;

      // Distinct suppliers, not products with a verified supplier — the KPI is labelled
      // "Verified Suppliers", and the SQL behind the live endpoint counts DISTINCT supplier_id.
      const supplierKey = (p) => p.store_ref || p.supplier_ref || p.supplier_id || 'unknown';
      const totalSuppliers = new Set(activeProducts.map(supplierKey)).size;
      const verifiedSuppliersCount = new Set(activeProducts.filter(isVerified).map(supplierKey)).size;
      
      const categoriesMap = {};
      let totalGmvPaisa = 0;
      for (const p of activeProducts) {
        const cat = p.category || 'Uncategorized';
        categoriesMap[cat] = (categoriesMap[cat] || 0) + 1;
        totalGmvPaisa += (parseFloat(p.price) || 0) * (p.stock || 0);
      }

      return {
        status: 200,
        body: {
          data: {
            stats: {
              total_products: totalProducts,
              in_stock_count: inStockCount,
              low_stock_count: lowStockCount,
              out_of_stock_count: outOfStockCount,
              flash_sale_count: flashSaleCount,
              total_suppliers: totalSuppliers,
              verified_suppliers_count: verifiedSuppliersCount,
              total_categories: Object.keys(categoriesMap).length,
              total_potential_inventory_value: Math.round(totalGmvPaisa),
              categories_breakdown: categoriesMap,
              low_stock_threshold: LOW_STOCK_THRESHOLD,
              status_scope: 'ACTIVE',
            },
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/pricing/preview',
    handler({ body }) {
      const baseCost = body?.base_cost ?? body?.baseCost ?? 0;
      const wholesaleMargin = body?.wholesale_margin ?? body?.wholesaleMargin ?? 0;
      const retailPrice = body?.retail_price ?? body?.retailPrice;
      const defaultRetailPrice = body?.default_retail_price ?? body?.defaultRetailPrice;
      const platformProfitPct = body?.platform_default_profit_pct ?? 10;
      const salerProfitPct = body?.saler_default_profit_pct ?? 20;
      const extraMarkupPlatformPct = body?.extra_markup_platform_pct ?? 20;

      const baseCostPaisa = toPaisa(baseCost);
      const wholesaleMarginPaisa = toPaisa(wholesaleMargin);
      const wholesaleCostPaisa = baseCostPaisa + wholesaleMarginPaisa;

      const platformDefaultProfitPaisa = Math.round((wholesaleCostPaisa * platformProfitPct) / 100);
      const salerDefaultProfitPaisa = Math.round((wholesaleCostPaisa * salerProfitPct) / 100);
      const calculatedDefaultRetailPaisa = wholesaleCostPaisa + platformDefaultProfitPaisa + salerDefaultProfitPaisa;
      const defaultRetailPricePaisa = defaultRetailPrice ? toPaisa(defaultRetailPrice) : calculatedDefaultRetailPaisa;
      const minRetailPricePaisa = wholesaleCostPaisa + platformDefaultProfitPaisa;

      const retailPricePaisa = (retailPrice !== undefined && retailPrice !== null && retailPrice !== '')
        ? toPaisa(retailPrice)
        : defaultRetailPricePaisa;

      if (retailPricePaisa < minRetailPricePaisa) {
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message_en: `Retail price (BDT ${(retailPricePaisa / 100).toFixed(2)}) cannot be lower than minimum selling price (BDT ${(minRetailPricePaisa / 100).toFixed(2)}).`,
              message_bn: `খুচরা মূল্য (৳${(retailPricePaisa / 100).toFixed(2)}) সর্বনিম্ন বিক্রয় মূল্যের (৳${(minRetailPricePaisa / 100).toFixed(2)}) চেয়ে কম হতে পারে না।`,
              trace_id: traceId(),
            },
          },
        };
      }

      let salerEarningPaisa = 0;
      let platformEarningPaisa = 0;
      let priceStatus = 'DEFAULT';

      if (retailPricePaisa < defaultRetailPricePaisa) {
        // Price dropped below default: Platform profit is fixed; only saler profit drops
        priceStatus = 'DISCOUNTED';
        const dropPaisa = defaultRetailPricePaisa - retailPricePaisa;
        platformEarningPaisa = platformDefaultProfitPaisa;
        salerEarningPaisa = salerDefaultProfitPaisa - dropPaisa;
      } else if (retailPricePaisa === defaultRetailPricePaisa) {
        priceStatus = 'DEFAULT';
        platformEarningPaisa = platformDefaultProfitPaisa;
        salerEarningPaisa = salerDefaultProfitPaisa;
      } else {
        // Price marked up above default: Extra markup shared between platform and saler
        priceStatus = 'BOOSTED';
        const extraPaisa = retailPricePaisa - defaultRetailPricePaisa;
        const extraPlatformPaisa = Math.floor((extraPaisa * extraMarkupPlatformPct) / 100);
        const extraSalerPaisa = extraPaisa - extraPlatformPaisa;
        platformEarningPaisa = platformDefaultProfitPaisa + extraPlatformPaisa;
        salerEarningPaisa = salerDefaultProfitPaisa + extraSalerPaisa;
      }

      const netRetailMarginPaisa = retailPricePaisa - wholesaleCostPaisa;
      const totalMarginPct = retailPricePaisa > 0
        ? parseFloat(((netRetailMarginPaisa / retailPricePaisa) * 100).toFixed(2))
        : 0;

      const salerMarginPct = retailPricePaisa > 0
        ? parseFloat(((salerEarningPaisa / retailPricePaisa) * 100).toFixed(2))
        : 0;

      const preview = {
        base_cost: parseFloat((baseCostPaisa / 100).toFixed(2)),
        wholesale_margin: parseFloat((wholesaleMarginPaisa / 100).toFixed(2)),
        wholesale_cost: parseFloat((wholesaleCostPaisa / 100).toFixed(2)),
        retail_price: parseFloat((retailPricePaisa / 100).toFixed(2)),
        default_retail_price: parseFloat((defaultRetailPricePaisa / 100).toFixed(2)),
        min_retail_price: parseFloat((minRetailPricePaisa / 100).toFixed(2)),
        net_retail_margin: parseFloat((netRetailMarginPaisa / 100).toFixed(2)),
        saler_earning: parseFloat((salerEarningPaisa / 100).toFixed(2)),
        saler_default_earning: parseFloat((salerDefaultProfitPaisa / 100).toFixed(2)),
        platform_earning: parseFloat((platformEarningPaisa / 100).toFixed(2)),
        platform_default_earning: parseFloat((platformDefaultProfitPaisa / 100).toFixed(2)),
        platform_default_profit_pct: platformProfitPct,
        saler_default_profit_pct: salerProfitPct,
        extra_markup_platform_pct: extraMarkupPlatformPct,
        price_status: priceStatus,
        saler_split_pct: 40,
        platform_split_pct: 60,
        total_margin_pct: totalMarginPct,
        saler_margin_pct: salerMarginPct,
        rule_source: 'GLOBAL_COMMISSION_RULE',
        paisa: {
          base_cost: baseCostPaisa,
          wholesale_margin: wholesaleMarginPaisa,
          wholesale_cost: wholesaleCostPaisa,
          retail_price: retailPricePaisa,
          default_retail_price: defaultRetailPricePaisa,
          min_retail_price: minRetailPricePaisa,
          net_retail_margin: netRetailMarginPaisa,
          saler_earning: salerEarningPaisa,
          platform_earning: platformEarningPaisa,
        },
      };

      return {
        status: 200,
        body: { data: { preview } },
      };
    },
  },
  {
    method: 'GET',
    path: '/sourcing/catalog',
    handler({ query }) {
      let filtered = products.map((p) => {
        const pricing = synthesizePricing(p);
        const tier = p.supplier_tier || 'standard';
        const shippingSpeed = tier === 'elite' ? 'fast_24h' : tier === 'verified' ? 'standard_48h' : 'standard_72h';
        const dispatchHours = tier === 'elite' ? 24 : tier === 'verified' ? 48 : 72;

        return {
          ...p,
          pricing,
          supplier: synthesizeSupplier(p),
          shipping_speed: shippingSpeed,
          dispatch_hours: dispatchHours,
          sourcing_opportunity: {
            potential_profit: pricing.saler_earning,
            margin_pct: p.margin_pct ?? pricing.total_margin_pct,
            saler_margin_pct: pricing.saler_margin_pct,
            stock_available: p.stock ?? 25,
            suggested_retail: pricing.retail_price,
            min_retail_price: pricing.min_retail_price,
            default_retail_price: pricing.default_retail_price,
            base_cost: pricing.base_cost,
            wholesale_cost: pricing.wholesale_cost,
          },
        };
      });

      if (query.category && query.category !== 'all') {
        filtered = filtered.filter((p) => p.category.toLowerCase() === query.category.toLowerCase());
      }

      if (query.verification_tier && query.verification_tier !== 'all') {
        filtered = filtered.filter((p) => p.supplier_tier === query.verification_tier);
      }

      if (query.shipping_speed && query.shipping_speed !== 'all') {
        filtered = filtered.filter((p) => p.shipping_speed === query.shipping_speed);
      }

      if (query.in_stock === 'true' || query.in_stock === true) {
        filtered = filtered.filter((p) => (p.stock ?? 0) > 0);
      }

      if (query.min_margin_pct) {
        const minMargin = parseFloat(query.min_margin_pct);
        if (!isNaN(minMargin)) {
          filtered = filtered.filter((p) => (p.margin_pct ?? 0) >= minMargin);
        }
      }

      const sortBy = query.sort_by || 'margin_desc';
      if (sortBy === 'margin_desc') {
        filtered.sort((a, b) => (b.margin_pct ?? 0) - (a.margin_pct ?? 0));
      } else if (sortBy === 'popularity') {
        filtered.sort((a, b) => (b.rating_count ?? 0) - (a.rating_count ?? 0));
      } else if (sortBy === 'newest') {
        filtered.reverse();
      } else if (sortBy === 'price_asc') {
        filtered.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
      } else if (sortBy === 'price_desc') {
        filtered.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
      }

      const limit = parseInt(query.limit, 10) || 50;
      const offset = parseInt(query.offset, 10) || 0;
      const paged = filtered.slice(offset, offset + limit);

      return {
        status: 200,
        body: {
          data: { catalog: paged, total: filtered.length },
          meta: { total: filtered.length, limit, offset },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/sourcing/my-store',
    handler() {
      return {
        status: 200,
        body: {
          data: { store_items: mockSalerStoreItems },
          store_items: mockSalerStoreItems,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/sourcing/add-to-store',
    handler({ body }) {
      const productId = body?.product_id;
      const customRetailPrice = body?.custom_retail_price !== undefined ? parseFloat(body.custom_retail_price) : undefined;
      const collectionName = body?.collection_name || 'General';

      const product = products.find((p) => p.ref === productId || String(p.id) === String(productId));
      if (!product) {
        return notFound(`Product "${productId}" not found.`, `"${productId}" প্রোডাক্ট পাওয়া যায়নি।`);
      }

      const pricing = synthesizePricing(product);
      if (customRetailPrice !== undefined && customRetailPrice < pricing.wholesale_cost) {
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message_en: `Custom retail price must be at least BDT ${pricing.wholesale_cost.toFixed(2)}.`,
              message_bn: `কাস্টম খুচরা মূল্য অবশ্যই কমপক্ষে ৳${pricing.wholesale_cost.toFixed(2)} হতে হবে।`,
              trace_id: traceId(),
            },
          },
        };
      }

      const existingIndex = mockSalerStoreItems.findIndex((item) => item.product_ref === product.ref || item.product_id === productId);
      const finalPrice = customRetailPrice ?? parseFloat(product.price);

      const newItem = {
        id: existingIndex >= 0 ? mockSalerStoreItems[existingIndex].id : mockSalerStoreItems.length + 1,
        store_id: 1,
        saler_id: 6,
        product_id: product.ref,
        product_ref: product.ref,
        title_en: product.title_en,
        title_bn: product.title_bn,
        custom_retail_price: finalPrice,
        collection_name: collectionName,
        display_order: existingIndex >= 0 ? mockSalerStoreItems[existingIndex].display_order : mockSalerStoreItems.length + 1,
        is_active: true,
        added_at: new Date().toISOString(),
        pricing: {
          ...pricing,
          retail_price: finalPrice,
          net_retail_margin: finalPrice - pricing.wholesale_cost,
          saler_earning: parseFloat(((finalPrice - pricing.wholesale_cost) * 0.4).toFixed(2)),
          platform_earning: parseFloat(((finalPrice - pricing.wholesale_cost) * 0.6).toFixed(2)),
        },
      };

      if (existingIndex >= 0) {
        mockSalerStoreItems[existingIndex] = newItem;
      } else {
        mockSalerStoreItems.push(newItem);
      }

      return {
        status: 201,
        body: {
          data: { item: newItem },
          item: newItem,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/search',
    handler({ query }) {
      const raw = query.q || query.query || '';
      const matched = activeProducts.filter((p) => productMatchesQuery(p, raw));
      return {
        status: 200,
        body: {
          data: { products: matched },
          meta: { count: matched.length, total: matched.length },
          products: matched,
          stores: [],
          categories: [],
          totalCount: matched.length,
          driver: 'mock',
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/search/suggest',
    handler({ query }) {
      const raw = query.q || query.query || '';
      const limit = Math.min(Number(query.limit) || 6, 12);
      const allMatches = activeProducts.filter((p) => productMatchesQuery(p, raw));
      return {
        status: 200,
        body: {
          query: raw.trim(),
          suggestions: allMatches.slice(0, limit),
          total: allMatches.length,
          categories: [],
          driver: 'mock',
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/sourcing/catalog',
    handler({ query }) {
      const category = query?.category;
      const minMargin = parseFloat(query?.min_margin_pct || 0);
      const tier = query?.verification_tier;

      let catalog = products.map((p) => {
        const price = parseFloat(p.price || 500);
        const wholesale = Math.round(price * 0.75);
        const profit = Math.round(price - wholesale - (price * 0.05));
        const marginPct = Math.round((profit / price) * 100);

        return {
          ...p,
          wholesale_price: wholesale.toString(),
          margin_pct: marginPct,
          supplier_tier: p.supplier_tier || 'verified',
          pricing: {
            wholesale_cost: wholesale,
            suggested_retail: price,
            saler_earning: profit,
            saler_margin_pct: marginPct,
          },
          sourcing_opportunity: {
            wholesale_cost: wholesale,
            potential_profit: profit,
            margin_pct: marginPct,
          },
        };
      });

      if (category && category !== 'all') {
        catalog = catalog.filter((p) => p.category === category);
      }
      if (minMargin > 0) {
        catalog = catalog.filter((p) => p.margin_pct >= minMargin);
      }
      if (tier && tier !== 'all') {
        catalog = catalog.filter((p) => (p.supplier_tier || 'standard').toLowerCase() === tier.toLowerCase());
      }

      return {
        status: 200,
        body: {
          data: {
            catalog,
          },
          meta: {
            total: catalog.length,
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/pricing/preview',
    handler({ body }) {
      const b = body || {};
      const baseCost = parseFloat(b.base_cost || 500);
      const wholesaleMargin = parseFloat(b.wholesale_margin || 0);
      const retailPrice = parseFloat(b.retail_price || 700);

      const wholesaleCost = baseCost + wholesaleMargin;
      const platformFee = Math.round(retailPrice * 0.05);
      const salerEarning = Math.max(0, retailPrice - wholesaleCost - platformFee);
      const marginPct = retailPrice > 0 ? ((salerEarning / retailPrice) * 100).toFixed(1) : '0';

      return {
        status: 200,
        body: {
          data: {
            preview: {
              wholesale_cost: wholesaleCost,
              suggested_retail: retailPrice,
              platform_fee: platformFee,
              saler_earning: salerEarning,
              saler_margin_pct: parseFloat(marginPct),
              supplier_earning: wholesaleCost,
            },
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/sourcing/add-to-store',
    handler({ body }) {
      const b = body || {};
      return {
        status: 201,
        body: {
          data: {
            item: {
              id: Date.now(),
              product_id: b.product_id,
              custom_retail_price: b.custom_retail_price,
              collection_name: b.collection_name || 'General',
              created_at: new Date().toISOString(),
            },
          },
          meta: {
            message_en: 'Product added to your virtual storefront successfully',
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/sourcing/my-store',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            store_items: [],
          },
        },
      };
    },
  },
];
