/**
 * Mock handlers for the product catalog — cursor-paginated per docs/api-contract.md §4.1.
 */
import products from '../fixtures/products.json' with { type: 'json' };
import stores from '../fixtures/stores.json' with { type: 'json' };

function traceId() {
  return `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
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
function synthesizeVariants(product) {
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

function synthesizeSupplier(product) {
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

function synthesizeDescription(product) {
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
  const salerSplitPct = 40;
  const platformSplitPct = 60;
  const netRetailMargin = retail * ((product.margin_pct ?? 15) / 100) * (100 / salerSplitPct);
  const wholesaleCost = Math.max(0, retail - netRetailMargin);
  const wholesaleMargin = wholesaleCost * 0.12;
  const baseCost = wholesaleCost - wholesaleMargin;
  const salerEarning = netRetailMargin * (salerSplitPct / 100);
  const platformEarning = netRetailMargin - salerEarning;

  return {
    base_cost: Number(baseCost.toFixed(2)),
    wholesale_margin: Number(wholesaleMargin.toFixed(2)),
    wholesale_cost: Number(wholesaleCost.toFixed(2)),
    retail_price: retail,
    net_retail_margin: Number(netRetailMargin.toFixed(2)),
    saler_earning: Number(salerEarning.toFixed(2)),
    platform_earning: Number(platformEarning.toFixed(2)),
    saler_split_pct: salerSplitPct,
    platform_split_pct: platformSplitPct,
  };
}

/** Attaches everything ProductDetailPage needs beyond the flat catalog-listing shape. */
function toDetailShape(product) {
  return {
    ...product,
    ...synthesizeDescription(product),
    variants: synthesizeVariants(product),
    images: synthesizeImages(product),
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

// In-memory mutable products store initialized from static fixtures
let activeProducts = [...products];

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

export default [
  {
    method: 'GET',
    path: '/products',
    handler({ query }) {
      let filtered = [...activeProducts];

      if (query.q || query.search) {
        const q = (query.q || query.search).toLowerCase().trim();
        filtered = filtered.filter(
          (p) =>
            p.title_en?.toLowerCase().includes(q) ||
            p.title_bn?.toLowerCase().includes(q) ||
            p.category?.toLowerCase().includes(q) ||
            p.district?.toLowerCase().includes(q) ||
            p.ref?.toLowerCase().includes(q)
        );
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
      if (query.tier) {
        const tiers = query.tier.split(',');
        filtered = filtered.filter((p) => tiers.includes(p.supplier_tier));
      }
      if (query.district) {
        filtered = filtered.filter((p) => p.district === query.district);
      }
      if (query.min_rating) {
        filtered = filtered.filter((p) => (p.rating ?? 0) >= Number(query.min_rating));
      }
      if (query.min_margin) {
        filtered = filtered.filter((p) => (p.margin_pct ?? 0) >= Number(query.min_margin));
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
      const idParam = String(params?.id || '');
      const numIdx = Number(idParam);
      const product = activeProducts.find((p, idx) =>
        p.ref === idParam ||
        p.slug === idParam ||
        String(p.id) === idParam ||
        (!isNaN(numIdx) && numIdx > 0 && (idx === numIdx - 1 || numIdx === 1))
      ) || activeProducts[0];

      if (!product) {
        return notFound(`No product with ref "${params.id}".`, `"${params.id}" নামে কোনো পণ্য নেই।`);
      }
      return { status: 200, body: { data: { product: toDetailShape(product) } } };
    },
  },
  {
    method: 'POST',
    path: '/products',
    handler({ body }) {
      const b = body || {};
      const ref = b.ref || `PRD-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      const newProduct = {
        ref,
        id: activeProducts.length + 1,
        title_en: b.title_en || 'New Sample Product',
        title_bn: b.title_bn || 'নতুন স্যাম্পল পণ্য',
        price: (parseFloat(b.price) || 999.00).toFixed(2),
        currency: b.currency || 'BDT',
        district: b.district || 'Dhaka',
        store_ref: b.store_ref || 'STR-RAHIM001',
        stock: parseInt(b.stock, 10) || 50,
        category: b.category || 'Clothing',
        category_bn: b.category_bn || 'পোশাক',
        rating: b.rating ? String(b.rating) : '4.5',
        rating_count: b.rating_count || 1,
        supplier_tier: b.supplier_tier || 'verified',
        margin_pct: parseFloat(b.margin_pct) || 20,
        image_index: Math.floor(Math.random() * 10),
        is_flash_sale: Boolean(b.is_flash_sale),
        store_open: true,
        is_verified_supplier: b.supplier_tier === 'verified' || b.supplier_tier === 'elite',
        image_url: b.image_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=80',
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
    handler() {
      const totalProducts = activeProducts.length;
      const inStockCount = activeProducts.filter((p) => (p.stock ?? 0) > 0).length;
      const lowStockCount = activeProducts.filter((p) => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= 10).length;
      const outOfStockCount = activeProducts.filter((p) => (p.stock ?? 0) === 0).length;
      const flashSaleCount = activeProducts.filter((p) => Boolean(p.is_flash_sale)).length;
      const verifiedSuppliersCount = activeProducts.filter((p) => p.supplier_tier === 'verified' || p.supplier_tier === 'elite').length;
      
      const categoriesMap = {};
      let totalGmvPaisa = 0;
      for (const p of activeProducts) {
        const cat = p.category || 'Other';
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
              verified_suppliers_count: verifiedSuppliersCount,
              total_categories: Object.keys(categoriesMap).length,
              total_potential_inventory_value: Math.round(totalGmvPaisa),
              categories_breakdown: categoriesMap,
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
      const retailPrice = body?.retail_price ?? body?.retailPrice ?? 0;

      const baseCostPaisa = toPaisa(baseCost);
      const wholesaleMarginPaisa = toPaisa(wholesaleMargin);
      const retailPricePaisa = toPaisa(retailPrice);
      const wholesaleCostPaisa = baseCostPaisa + wholesaleMarginPaisa;

      if (retailPricePaisa < wholesaleCostPaisa) {
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message_en: `Retail price (BDT ${(retailPricePaisa / 100).toFixed(2)}) cannot be lower than total wholesale cost (BDT ${(wholesaleCostPaisa / 100).toFixed(2)}).`,
              message_bn: `খুচরা মূল্য (৳${(retailPricePaisa / 100).toFixed(2)}) পাইকারি খরচের (৳${(wholesaleCostPaisa / 100).toFixed(2)}) চেয়ে কম হতে পারে না।`,
              trace_id: traceId(),
            },
          },
        };
      }

      const netRetailMarginPaisa = retailPricePaisa - wholesaleCostPaisa;
      const salerSplitPct = 40;
      const platformSplitPct = 60;
      const salerEarningPaisa = Math.floor((netRetailMarginPaisa * salerSplitPct) / 100);
      const platformEarningPaisa = netRetailMarginPaisa - salerEarningPaisa;

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
        net_retail_margin: parseFloat((netRetailMarginPaisa / 100).toFixed(2)),
        saler_earning: parseFloat((salerEarningPaisa / 100).toFixed(2)),
        platform_earning: parseFloat((platformEarningPaisa / 100).toFixed(2)),
        saler_split_pct: salerSplitPct,
        platform_split_pct: platformSplitPct,
        total_margin_pct: totalMarginPct,
        saler_margin_pct: salerMarginPct,
        rule_source: 'GLOBAL_COMMISSION_RULE',
        paisa: {
          base_cost: baseCostPaisa,
          wholesale_margin: wholesaleMarginPaisa,
          wholesale_cost: wholesaleCostPaisa,
          retail_price: retailPricePaisa,
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
      const q = (query.q || query.query || '').toLowerCase().trim();
      const matched = products.filter(
        (p) =>
          !q ||
          (p.title_en && p.title_en.toLowerCase().includes(q)) ||
          (p.title_bn && p.title_bn.includes(q)) ||
          (p.description_en && p.description_en.toLowerCase().includes(q)) ||
          (p.brand && p.brand.toLowerCase().includes(q))
      );
      return {
        status: 200,
        body: {
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
      const q = (query.q || query.query || '').toLowerCase().trim();
      const suggestions = products
        .filter(
          (p) =>
            !q ||
            (p.title_en && p.title_en.toLowerCase().includes(q)) ||
            (p.title_bn && p.title_bn.includes(q))
        )
        .slice(0, 6);
      return {
        status: 200,
        body: {
          query: q,
          suggestions,
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
