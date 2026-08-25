/**
 * bundles.js — Mock API Handlers for Bundling & Surge Pricing (Prompt 10.5).
 */

const SEEDED_BUNDLES = [
  {
    id: 1,
    ref: 'BND-8K2P9Q1X',
    saler_id: 6,
    saler_name: 'Tanvir Hasan',
    title_en: 'Executive Office Combo (Shirt + Trousers)',
    title_bn: 'এক্সিকিউটিভ অফিস কম্বো (শার্ট + ট্রাউজার)',
    bundle_price: 2550.00,
    sum_of_parts: 3000.00,
    discount_amount: 450.00,
    is_active: true,
    item_count: 2,
    supplier_count: 2,
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
];

const SEEDED_SURGE_RECS = [
  {
    id: 1,
    ref: 'SRG-9M4K2P7X',
    product_id: 1,
    product_ref: 'PROD-WALT-01',
    product_title_en: 'Walton 43-inch Android Smart TV',
    product_title_bn: 'ওয়ালটন ৪৩-ইঞ্চি অ্যান্ড্রয়েড স্মার্ট টিভি',
    supplier_id: 5,
    supplier_name: 'Walton Electronics',
    current_price: 32500.00,
    recommended_price: 35750.00,
    surge_pct: 10.0,
    velocity_score: 18,
    depletion_rate_score: 0.35,
    search_volume_score: 85,
    reason_en: 'High sales velocity: 18 units sold in 24h. Recommended price adjustment: +10% for higher margins without dampening velocity.',
    reason_bn: 'উচ্চ বিক্রয় গতি: ২৪ ঘণ্টায় ১৮টি ইউনিট বিক্রি হয়েছে। বিক্রয় গতি বজায় রেখে মার্জিন বাড়াতে +১০% মূল্য সমন্বয়ের পরামর্শ দেওয়া হচ্ছে।',
    status: 'PENDING',
    expires_at: new Date(Date.now() + 172800000).toISOString(),
    created_at: new Date().toISOString(),
  },
];

function calculateMockBreakdown(items = [], bundlePrice = 0) {
  let sumOfParts = 0;
  let totalWholesale = 0;

  const enriched = items.map((it) => {
    const qty = it.qty || 1;
    const retail = parseFloat(it.retailPrice || it.retail_price || 1000);
    const base = parseFloat(it.baseCost || it.base_cost || 600);
    const margin = parseFloat(it.wholesaleMargin || it.wholesale_margin || 100);
    const wholesale = (base + margin) * qty;
    const lineRetail = retail * qty;

    sumOfParts += lineRetail;
    totalWholesale += wholesale;

    return {
      productId: it.productId || it.product_id,
      productTitleEn: it.productTitleEn || it.productTitle || 'Product',
      qty,
      originalRetailPrice: retail,
      originalLineTotal: lineRetail,
      wholesaleCost: wholesale,
      supplierId: it.supplierId || 1,
      supplierName: it.supplierName || 'Supplier',
    };
  });

  const price = parseFloat(bundlePrice || sumOfParts * 0.85);
  const discountAmount = Math.max(0, sumOfParts - price);
  const discountPct = sumOfParts > 0 ? parseFloat(((discountAmount / sumOfParts) * 100).toFixed(2)) : 0;

  const processed = enriched.map((it) => {
    const share = sumOfParts > 0 ? (discountAmount * it.originalLineTotal) / sumOfParts : 0;
    const effectiveLine = it.originalLineTotal - share;
    const effectiveUnit = effectiveLine / it.qty;
    const netMargin = effectiveLine - it.wholesaleCost;
    const salerComm = netMargin * 0.4;
    const platMargin = netMargin * 0.6;

    return {
      ...it,
      discountShare: parseFloat(share.toFixed(2)),
      effectiveUnitPrice: parseFloat(effectiveUnit.toFixed(2)),
      effectiveLineTotal: parseFloat(effectiveLine.toFixed(2)),
      netRetailMargin: parseFloat(netMargin.toFixed(2)),
      salerCommission: parseFloat(salerComm.toFixed(2)),
      platformMargin: parseFloat(platMargin.toFixed(2)),
    };
  });

  const totalSaler = processed.reduce((acc, it) => acc + it.salerCommission, 0);
  const totalPlat = processed.reduce((acc, it) => acc + it.platformMargin, 0);
  const totalNet = processed.reduce((acc, it) => acc + it.netRetailMargin, 0);

  return {
    sum_of_parts: parseFloat(sumOfParts.toFixed(2)),
    bundle_price: parseFloat(price.toFixed(2)),
    discount_amount: parseFloat(discountAmount.toFixed(2)),
    discount_pct: discountPct,
    total_wholesale_cost: parseFloat(totalWholesale.toFixed(2)),
    total_net_margin: parseFloat(totalNet.toFixed(2)),
    total_saler_commission: parseFloat(totalSaler.toFixed(2)),
    total_platform_margin: parseFloat(totalPlat.toFixed(2)),
    saler_margin_pct: price > 0 ? parseFloat(((totalSaler / price) * 100).toFixed(2)) : 0,
    is_multi_supplier: true,
    supplier_count: 2,
    items: processed,
    suppliers: [
      { supplier_id: 5, supplier_name: 'Walton Apparel', item_count: 1, total_wholesale_payout: 800.00, items: [] },
      { supplier_id: 6, supplier_name: 'Apex Textiles', item_count: 1, total_wholesale_payout: 1250.00, items: [] },
    ],
  };
}

export default [
  {
    method: 'POST',
    path: '/saler/bundles/preview',
    handler: ({ body }) => {
      const breakdown = calculateMockBreakdown(body?.items, body?.bundle_price);
      return { status: 200, body: { data: breakdown } };
    },
  },
  {
    method: 'POST',
    path: '/saler/bundles',
    handler: ({ body }) => {
      const newBundle = {
        id: SEEDED_BUNDLES.length + 1,
        ref: `BND-${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
        saler_id: 6,
        saler_name: 'Tanvir Hasan',
        title_en: body.title_en,
        title_bn: body.title_bn,
        bundle_price: body.bundle_price,
        sum_of_parts: body.bundle_price * 1.15,
        discount_amount: body.bundle_price * 0.15,
        is_active: true,
        item_count: body.items?.length || 2,
        supplier_count: 2,
        created_at: new Date().toISOString(),
      };
      SEEDED_BUNDLES.unshift(newBundle);
      return { status: 201, body: { data: newBundle } };
    },
  },
  {
    method: 'GET',
    path: '/saler/bundles',
    handler: () => {
      return { status: 200, body: { data: SEEDED_BUNDLES, meta: { total: SEEDED_BUNDLES.length } } };
    },
  },
  {
    method: 'GET',
    path: '/bundles/:idOrRef',
    handler: ({ params }) => {
      const bundle = SEEDED_BUNDLES.find((b) => String(b.id) === params.idOrRef || b.ref === params.idOrRef) || SEEDED_BUNDLES[0];
      return { status: 200, body: { data: bundle } };
    },
  },
  {
    method: 'PATCH',
    path: '/saler/bundles/:id',
    handler: ({ params, body }) => {
      const b = SEEDED_BUNDLES.find((item) => String(item.id) === params.id);
      if (b && body) {
        if (body.is_active !== undefined) b.is_active = body.is_active;
        if (body.bundle_price !== undefined) b.bundle_price = body.bundle_price;
      }
      return { status: 200, body: { data: b } };
    },
  },
  {
    method: 'DELETE',
    path: '/saler/bundles/:id',
    handler: ({ params }) => {
      const idx = SEEDED_BUNDLES.findIndex((b) => String(b.id) === params.id);
      if (idx >= 0) SEEDED_BUNDLES.splice(idx, 1);
      return { status: 200, body: { data: { success: true } } };
    },
  },
  {
    method: 'POST',
    path: '/cart/bundle',
    handler: ({ body }) => {
      return { status: 200, body: { data: { bundle_id: body.bundle_id, items_count: 2 } } };
    },
  },
  {
    method: 'GET',
    path: '/supplier/surge/recommendations',
    handler: () => {
      return { status: 200, body: { data: SEEDED_SURGE_RECS, meta: { total: SEEDED_SURGE_RECS.length } } };
    },
  },
  {
    method: 'POST',
    path: '/supplier/surge/recommendations/:id/accept',
    handler: ({ params }) => {
      const rec = SEEDED_SURGE_RECS.find((r) => String(r.id) === params.id);
      if (rec) rec.status = 'ACCEPTED';
      return { status: 200, body: { data: { success: true, recommendation: rec } } };
    },
  },
  {
    method: 'POST',
    path: '/supplier/surge/recommendations/:id/dismiss',
    handler: ({ params }) => {
      const rec = SEEDED_SURGE_RECS.find((r) => String(r.id) === params.id);
      if (rec) rec.status = 'DISMISSED';
      return { status: 200, body: { data: { success: true, recommendation: rec } } };
    },
  },
];
