/**
 * salerDashboard.service.js — Saler Dashboard & Analytics Business Logic (Prompt 11.2 / idea §AL.2).
 *
 * Implements:
 * 1. Unified saler overview metrics (today's revenue/profit, 30d stats, wallet balances, store health).
 * 2. Analytics engine with pure time-series breakdown, traffic sources, conversion rates, and district distribution.
 * 3. First-run onboarding checklist with 15-second module walkthroughs for new salers.
 * 4. Grounded prescriptive Growth Assistant recommendations with 1-click executable actions.
 */

import { getInsightsForUser } from './ai/prescriptiveInsights.js';

/**
 * Aggregates high-level telemetry and status for the Saler Dashboard overview.
 */
export async function getSalerOverview(db, salerId) {
  const parsedSalerId = Number(salerId);

  // 1. Storefront details & shelves
  const { rows: storeRows } = await db.query(
    // WHY shelves are counted from `collection_name`: there is no `store_shelves` table — a shelf is
    // a grouping label on the curated item itself (see store.service.js, which calls it `shelfName`).
    `SELECT vs.id, vs.slug, vs.shop_name, vs.is_active,
            lm.storage_key AS logo_key,
            bm.storage_key AS banner_key,
            COUNT(DISTINCT ssi.id)::int AS curated_products_count,
            COUNT(DISTINCT ssi.collection_name)::int AS shelves_count
     FROM virtual_stores vs
     LEFT JOIN media_assets lm ON lm.id = vs.logo_media_id
     LEFT JOIN media_assets bm ON bm.id = vs.banner_media_id
     LEFT JOIN saler_store_items ssi ON ssi.store_id = vs.id AND ssi.is_active = true
     WHERE vs.saler_id = $1 AND vs.deleted_at IS NULL
     GROUP BY vs.id, vs.slug, vs.shop_name, vs.is_active, lm.storage_key, bm.storage_key`,
    [parsedSalerId]
  );
  const store = storeRows[0] || {
    id: null,
    slug: null,
    shop_name: null,
    is_active: false,
    logo_key: null,
    banner_key: null,
    curated_products_count: 0,
    shelves_count: 0,
  };

  // 2. Earnings and Order Volumes (reconciled with sub_orders and wallet)
  // WHY `saler_commission`: that is the column the split arithmetic writes and the vault pays out
  // from (checkout.service.js, vault.service.js). It is the saler's take of `net_retail_margin`.
  //
  // WHY RETURNED is excluded from the money columns: an approved return triggers a clawback that
  // reverses the commission (clawback.service.js). Counting it as profit showed salers earnings
  // they no longer had — and this function reports `returned_orders_count` in the same breath, so
  // it was contradicting itself. Order *counts* still include returns; only the money excludes them.
  const { rows: orderMetrics } = await db.query(
    `SELECT
       COUNT(so.id)::int AS total_orders,
       COUNT(CASE WHEN so.created_at >= CURRENT_DATE THEN 1 END)::int AS today_orders_count,
       COALESCE(SUM(CASE WHEN so.created_at >= CURRENT_DATE AND so.status NOT IN ('CANCELLED', 'REFUNDED', 'RETURNED') THEN so.total_amount ELSE 0 END), 0)::numeric(14,2) AS today_gross_sales,
       COALESCE(SUM(CASE WHEN so.created_at >= CURRENT_DATE AND so.status NOT IN ('CANCELLED', 'REFUNDED', 'RETURNED') THEN so.saler_commission ELSE 0 END), 0)::numeric(14,2) AS today_net_profit,
       COALESCE(SUM(CASE WHEN so.created_at >= now() - INTERVAL '30 days' AND so.status NOT IN ('CANCELLED', 'REFUNDED', 'RETURNED') THEN so.saler_commission ELSE 0 END), 0)::numeric(14,2) AS profit_30d,
       COUNT(CASE WHEN so.status IN ('PLACED', 'CONFIRMED', 'PACKED') THEN 1 END)::int AS pending_fulfillment_count,
       COUNT(CASE WHEN so.status = 'DELIVERED' THEN 1 END)::int AS delivered_orders_count,
       COUNT(CASE WHEN so.status = 'RETURNED' OR so.status = 'REFUNDED' THEN 1 END)::int AS returned_orders_count
     FROM sub_orders so
     WHERE so.saler_id = $1`,
    [parsedSalerId]
  );
  const metrics = orderMetrics[0] || {
    total_orders: 0,
    today_orders_count: 0,
    today_gross_sales: '0.00',
    today_net_profit: '0.00',
    profit_30d: '0.00',
    pending_fulfillment_count: 0,
    delivered_orders_count: 0,
    returned_orders_count: 0,
  };

  // Compute return rate percentage
  const totalCompletedOrReturned = metrics.delivered_orders_count + metrics.returned_orders_count;
  const returnRatePct = totalCompletedOrReturned > 0
    ? Number(((metrics.returned_orders_count / totalCompletedOrReturned) * 100).toFixed(1))
    : 0;

  // 3. Digital Vault Balances (reconciled from wallets/ledger)
  let availableBalance = '0.00';
  let escrowBalance = '0.00';
  const { rows: walletRows } = await db.query(
    `SELECT available_balance, pending_escrow_balance FROM wallets WHERE user_id = $1`,
    [parsedSalerId]
  );
  if (walletRows.length > 0) {
    availableBalance = walletRows[0].available_balance;
    escrowBalance = walletRows[0].pending_escrow_balance;
  }

  // 4. Activity indicators (Unread messages, active ads, short link clicks, active referrals)
  // WHY no per-query `.catch(() => 0)` here any more: these four used to swallow every error and
  // report a confident zero. Two of them were querying columns that do not exist
  // (`referrals.sponsor_id`), so the dashboard showed "0 referrals" to salers who had referrals —
  // indistinguishable from the truth, and silent in the logs. A broken query must now fail loudly.
  const { rows: unreadRows } = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM chat_messages cm
     JOIN chat_thread_participants ctp ON ctp.thread_id = cm.thread_id AND ctp.user_id = $1
     WHERE cm.sender_id <> $1 AND (ctp.last_read_message_id IS NULL OR cm.id > ctp.last_read_message_id)`,
    [parsedSalerId]
  );
  const unreadMessagesCount = unreadRows[0]?.count || 0;

  const { rows: adsRows } = await db.query(
    `SELECT COUNT(*)::int AS count FROM ad_campaigns WHERE user_id = $1 AND status = 'ACTIVE'`,
    [parsedSalerId]
  );
  const activeAdsCount = adsRows[0]?.count || 0;

  const { rows: linkRows } = await db.query(
    `SELECT COALESCE(SUM(clicks_count), 0)::int AS clicks FROM short_links WHERE saler_id = $1`,
    [parsedSalerId]
  );
  const totalLinkClicks = linkRows[0]?.clicks || 0;

  const { rows: refRows } = await db.query(
    `SELECT COUNT(*)::int AS count FROM referrals WHERE referrer_user_id = $1`,
    [parsedSalerId]
  );
  const referralCount = refRows[0]?.count || 0;

  // 5. Onboarding status checklist
  const hasCurated = store.curated_products_count > 0;
  const hasStoreCustomized = Boolean(store.slug && store.shop_name);
  const hasSharedSocial = totalLinkClicks > 0;
  const hasFirstSale = metrics.total_orders > 0;
  const isBrandNew = !hasFirstSale && store.curated_products_count === 0;

  const onboardingSteps = [
    {
      id: 'step_curate',
      title_en: 'Curate your first wholesale product',
      title_bn: 'আপনার প্রথম পাইকারি পণ্য নির্বাচন করুন',
      desc_en: 'Browse the supplier catalog and add high-margin items to your storefront.',
      desc_bn: 'সাপ্লায়ার ক্যাটালগ থেকে পণ্য বাছাই করে আপনার স্টোরে যুক্ত করুন।',
      action_url: '/saler/sourcing',
      action_label_en: 'Browse Sourcing Catalog',
      action_label_bn: 'সোর্সিং ক্যাটালগ দেখুন',
      completed: hasCurated,
      video_duration: '15s',
      video_title_en: '15s Walkthrough: 1-Tap Sourcing',
      video_title_bn: '১৫ সেকেন্ড গাইড: ১-ট্যাপ সোর্সিং',
      video_slug: 'sourcing_walkthrough',
    },
    {
      id: 'step_storefront',
      title_en: 'Customize your virtual storefront',
      title_bn: 'আপনার ভার্চুয়াল স্টোর সাজান',
      desc_en: 'Choose a branded vanity slug, add your logo and organize product shelves.',
      desc_bn: 'স্টোরের নাম, লোগো এবং ক্যাটাগরি সেলফ সাজিয়ে তুলুন।',
      action_url: '/saler/store-builder',
      action_label_en: 'Open Store Builder',
      action_label_bn: 'স্টোর বিল্ডার খুলুন',
      completed: hasStoreCustomized,
      video_duration: '15s',
      video_title_en: '15s Walkthrough: Store Builder',
      video_title_bn: '১৫ সেকেন্ড গাইড: স্টোর সাজানো',
      video_slug: 'store_builder_walkthrough',
    },
    {
      id: 'step_share',
      title_en: 'Share your store on WhatsApp & Facebook',
      title_bn: 'হোয়াটসঅ্যাপ ও ফেসবুকে স্টোর শেয়ার করুন',
      desc_en: 'Generate print-quality vector flyers or tracked affiliate short links.',
      desc_bn: 'সোশ্যাল সেলার কিট থেকে ব্যানার ও শর্ট লিংক তৈরি করে শেয়ার করুন।',
      action_url: '/saler/social-kit',
      action_label_en: 'Launch Social Kit',
      action_label_bn: 'সোশ্যাল কিট খুলুন',
      completed: hasSharedSocial,
      video_duration: '15s',
      video_title_en: '15s Walkthrough: Social Kit & Flyers',
      video_title_bn: '১৫ সেকেন্ড গাইড: সোশ্যাল ব্যানার তৈরি',
      video_slug: 'social_kit_walkthrough',
    },
    {
      id: 'step_first_sale',
      title_en: 'Make your first sale & claim your profit',
      title_bn: 'প্রথম বিক্রয় সম্পন্ন করে মুনাফা পান',
      desc_en: 'Suppliers pack & ship orders automatically. Watch earnings deposit into your vault.',
      desc_bn: 'অর্ডার আসলেই সাপ্লায়ার পাঠিয়ে দিবে এবং মুনাফা আপনার ভল্টে যুক্ত হবে।',
      action_url: '/saler/vault',
      action_label_en: 'Check Digital Vault',
      action_label_bn: 'ডিজিটাল ভল্ট দেখুন',
      completed: hasFirstSale,
      video_duration: '15s',
      video_title_en: '15s Walkthrough: Instant Payouts',
      video_title_bn: '১৫ সেকেন্ড গাইড: ইনস্ট্যান্ট ক্যাশআউট',
      video_slug: 'vault_payouts_walkthrough',
    },
  ];

  return {
    saler_id: parsedSalerId,
    store,
    metrics: {
      ...metrics,
      return_rate_pct: returnRatePct,
      available_balance: availableBalance,
      escrow_balance: escrowBalance,
      unread_messages_count: unreadMessagesCount,
      active_ads_count: activeAdsCount,
      total_link_clicks: totalLinkClicks,
      referral_count: referralCount,
    },
    onboarding: {
      is_brand_new: isBrandNew,
      completed_steps_count: [hasCurated, hasStoreCustomized, hasSharedSocial, hasFirstSale].filter(Boolean).length,
      total_steps: onboardingSteps.length,
      steps: onboardingSteps,
    },
  };
}

/**
 * Returns detailed historical analytics reconciled with sub_orders and double-entry ledger.
 * Formats time-series trends and distributions for pure inline SVG rendering.
 */
export async function getSalerAnalytics(db, salerId, { range = '30d' } = {}) {
  const parsedSalerId = Number(salerId);
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;

  // 1. Time-series daily revenue & profit points
  const { rows: trendRows } = await db.query(
    `SELECT
       TO_CHAR(d.day, 'YYYY-MM-DD') AS date_str,
       TO_CHAR(d.day, 'Mon DD') AS label,
       COALESCE(SUM(so.total_amount), 0)::numeric(14,2) AS gross_sales,
       COALESCE(SUM(so.saler_commission), 0)::numeric(14,2) AS net_profit,
       COUNT(so.id)::int AS orders_count
     FROM generate_series(
       (CURRENT_DATE - ($2 || ' days')::interval)::date,
       CURRENT_DATE::date,
       '1 day'::interval
     ) d(day)
     LEFT JOIN sub_orders so
       ON so.saler_id = $1
       AND so.created_at::date = d.day::date
       AND so.status NOT IN ('CANCELLED', 'REFUNDED', 'RETURNED')
     GROUP BY d.day
     ORDER BY d.day ASC`,
    [parsedSalerId, days - 1]
  );

  // 2. Aggregate period summary totals
  const totalGrossSales = trendRows.reduce((acc, r) => acc + Number(r.gross_sales), 0);
  const totalNetProfit = trendRows.reduce((acc, r) => acc + Number(r.net_profit), 0);
  const totalOrders = trendRows.reduce((acc, r) => acc + r.orders_count, 0);

  // 3. Top performing products.
  //
  // WHY the join order matters: `order_items` used to be joined on `product_id` alone, with the
  // saler filter sitting on a LEFT JOIN to `sub_orders` further down — so every item row survived
  // whether or not it belonged to this saler, and `units_sold` silently reported the whole
  // platform's sales of that product. The saler's own parcels have to be selected first.
  //
  // WHY commission is prorated: there is no per-item saler earning in the schema — `saler_commission`
  // is settled per sub-order. Splitting it across the parcel's items by their share of `line_total`
  // is the honest attribution. (The previous `unit_price - unit_cost` expression named two columns
  // that do not exist, and would have measured gross markup, not the saler's cut, if they had.)
  const { rows: topProducts } = await db.query(
    `SELECT
       p.id AS product_id,
       p.title_en,
       p.title_bn,
       p.slug,
       ssi.custom_retail_price,
       p.default_retail_price,
       COALESCE(SUM(oi.qty), 0)::int AS units_sold,
       COALESCE(SUM(
         so.saler_commission
         * (oi.line_total / NULLIF((SELECT SUM(oi2.line_total) FROM order_items oi2 WHERE oi2.sub_order_id = so.id), 0))
       ), 0)::numeric(14,2) AS total_margin_earned,
       p.stock_qty
     FROM saler_store_items ssi
     JOIN products p ON p.id = ssi.product_id
     LEFT JOIN sub_orders so
          ON so.saler_id = ssi.saler_id
          AND so.created_at >= now() - ($2 || ' days')::interval
          AND so.status NOT IN ('CANCELLED', 'REFUNDED', 'RETURNED')
     LEFT JOIN order_items oi ON oi.sub_order_id = so.id AND oi.product_id = p.id
     WHERE ssi.saler_id = $1 AND ssi.is_active = true
     GROUP BY p.id, p.title_en, p.title_bn, p.slug, ssi.custom_retail_price, p.default_retail_price, p.stock_qty
     ORDER BY units_sold DESC, total_margin_earned DESC
     LIMIT 8`,
    [parsedSalerId, days]
  );

  // 4. Traffic sources & conversion rate
  // `source_channel` is a CHECK-constrained enum: GENERAL | WHATSAPP | FACEBOOK | PRINT_FLYER |
  // QR_CODE | INSTAGRAM. Printed flyers and QR codes are one offline bucket to the saler.
  const { rows: clickStats } = await db.query(
    `SELECT
       COALESCE(SUM(clicks_count), 0)::int AS total_clicks,
       COALESCE(SUM(CASE WHEN source_channel = 'WHATSAPP' THEN clicks_count ELSE 0 END), 0)::int AS whatsapp_clicks,
       COALESCE(SUM(CASE WHEN source_channel = 'FACEBOOK' THEN clicks_count ELSE 0 END), 0)::int AS facebook_clicks,
       COALESCE(SUM(CASE WHEN source_channel IN ('PRINT_FLYER', 'QR_CODE') THEN clicks_count ELSE 0 END), 0)::int AS flyer_clicks,
       COALESCE(SUM(CASE WHEN source_channel IS NULL OR source_channel NOT IN ('WHATSAPP', 'FACEBOOK', 'PRINT_FLYER', 'QR_CODE') THEN clicks_count ELSE 0 END), 0)::int AS direct_clicks
     FROM short_links
     WHERE saler_id = $1`,
    [parsedSalerId]
  );

  const clicks = clickStats[0] || { total_clicks: 0, whatsapp_clicks: 0, facebook_clicks: 0, flyer_clicks: 0, direct_clicks: 0 };
  const effectiveVisitors = Math.max(clicks.total_clicks, totalOrders);
  const conversionRatePct = effectiveVisitors > 0
    ? Number(((totalOrders / effectiveVisitors) * 100).toFixed(2))
    : 0;

  // WHY percentages are derived rather than declared: they used to be the literals 45/30/15/10 with
  // counts that fell back to `visitors * 0.45` when the real number was zero, so the attribution
  // donut drew the same four slices for every saler on the platform regardless of their actual
  // traffic. An analytics figure that ignores its own data is worse than an empty chart.
  const totalAttributed = clicks.whatsapp_clicks + clicks.facebook_clicks + clicks.flyer_clicks + clicks.direct_clicks;
  const pct = (n) => (totalAttributed > 0 ? Number(((n / totalAttributed) * 100).toFixed(1)) : 0);

  const trafficSources = [
    { source: 'WhatsApp Shares', count: clicks.whatsapp_clicks, percentage: pct(clicks.whatsapp_clicks), color: '#25D366' },
    { source: 'Facebook & Stories', count: clicks.facebook_clicks, percentage: pct(clicks.facebook_clicks), color: '#1877F2' },
    { source: 'Printed Flyers / QR', count: clicks.flyer_clicks, percentage: pct(clicks.flyer_clicks), color: '#F59E0B' },
    { source: 'Direct & Others', count: clicks.direct_clicks, percentage: pct(clicks.direct_clicks), color: '#8B5CF6' },
  ];

  // 5. Geographic sales by Bangladesh districts
  const { rows: districtRows } = await db.query(
    `SELECT
       COALESCE(o.district, 'Unknown') AS district,
       COUNT(so.id)::int AS order_count,
       COALESCE(SUM(so.total_amount), 0)::numeric(14,2) AS gmv
     FROM sub_orders so
     JOIN orders o ON o.id = so.order_id
     WHERE so.saler_id = $1
       AND so.created_at >= now() - ($2 || ' days')::interval
       AND so.status NOT IN ('CANCELLED', 'REFUNDED', 'RETURNED')
     GROUP BY o.district
     ORDER BY order_count DESC, gmv DESC
     LIMIT 6`,
    [parsedSalerId, days]
  );

  return {
    range,
    days,
    summary: {
      total_gross_sales: totalGrossSales.toFixed(2),
      total_net_profit: totalNetProfit.toFixed(2),
      total_orders: totalOrders,
      conversion_rate_pct: conversionRatePct,
      total_visitors: effectiveVisitors,
    },
    trends: trendRows,
    top_products: topProducts,
    traffic_sources: trafficSources,
    district_distribution: districtRows,
  };
}

/**
 * Returns grounded prescriptive recommendations with 1-click executable actions.
 */
export async function getSalerGrowthRecommendations(db, salerId, lang = 'en', deps = {}) {
  const parsedSalerId = Number(salerId);

  // Load grounded AI insights from Prompt 10.3 engine
  const baseInsights = await getInsightsForUser(db, { userId: parsedSalerId, role: 'saler', lang }, deps);

  // Map findings to actionable 1-click action triggers
  const actionableRecommendations = (baseInsights.findings || []).map((f, idx) => {
    let action = {
      type: 'NAVIGATE',
      url: '/saler/sourcing',
      label_en: 'View Sourcing',
      label_bn: 'সোর্সিং দেখুন',
    };

    if (f.type === 'PRICE_OPPORTUNITY') {
      action = {
        type: 'QUICK_PRICE_MATCH',
        productId: f.product_id,
        suggestedPrice: f.suggested_price,
        label_en: `⚡ Match Price (৳${f.suggested_price})`,
        label_bn: `⚡ দাম সমান করুন (৳${f.suggested_price})`,
        url: `/saler/store-builder?edit=${f.product_id}&price=${f.suggested_price}`,
      };
    } else if (f.type === 'SLOW_MOVER') {
      action = {
        type: 'CREATE_PROMO_FLYER',
        productId: f.product_id,
        label_en: '📣 Create Social Flyer',
        label_bn: '📣 সোশ্যাল ব্যানার বানান',
        url: `/saler/social-kit?product_id=${f.product_id}`,
      };
    } else if (f.type === 'HERO_PRODUCT') {
      action = {
        type: 'CREATE_BUNDLE',
        productId: f.product_id,
        label_en: '🎁 Build Bundle Combo',
        label_bn: '🎁 কম্বো বান্ডেল তৈরি করুন',
        url: `/saler/bundles?primary_product_id=${f.product_id}`,
      };
    }

    return {
      id: `rec_${idx + 1}`,
      type: f.type,
      title: f.title,
      message: f.message,
      recommendation: baseInsights.recommendations[idx] || f.message,
      action,
    };
  });

  // Fallback defaults if new saler has few metrics
  if (actionableRecommendations.length === 0) {
    actionableRecommendations.push({
      id: 'rec_default_1',
      type: 'SOURCING_DISCOVERY',
      title: lang === 'bn' ? 'বেশি মার্জিনের পণ্য বাছাই' : 'Source High Margin Crafts',
      message: lang === 'bn'
        ? 'হস্তশিল্প ও জামদানি ক্যাটাগরিতে ২৫%+ মার্জিন পাওয়া যাচ্ছে।'
        : 'Artisan handloom and crafts currently offer 25%+ retail profit margins.',
      recommendation: lang === 'bn'
        ? 'সোর্সিং ক্যাটালগ থেকে শীর্ষ মার্জিনের পণ্য আপনার স্টোরে যুক্ত করুন।'
        : 'Explore the sourcing catalog and add high-margin products to your shelves.',
      action: {
        type: 'NAVIGATE',
        url: '/saler/sourcing?min_margin=25',
        label_en: 'Explore 25%+ Margins →',
        label_bn: '২৫%+ মার্জিনের পণ্য দেখুন →',
      },
    });

    actionableRecommendations.push({
      id: 'rec_default_2',
      type: 'SOCIAL_DISTRIBUTION',
      title: lang === 'bn' ? 'সোশ্যাল সেলার কিট' : 'Viral WhatsApp Distribution',
      message: lang === 'bn'
        ? 'সোশ্যাল মিডিয়া ব্যানারে কিউআর কোড যুক্ত করে ক্রেতাদের সরাসরি স্টোরে আনুন।'
        : 'Vector flyers with QR codes increase WhatsApp status conversion by 3x.',
      recommendation: lang === 'bn'
        ? '১-ক্লিকে হোয়াটসঅ্যাপ স্ট্যাটাস ব্যানার ডাউনলোড করুন।'
        : 'Generate and share a branded product flyer with 1 click.',
      action: {
        type: 'NAVIGATE',
        url: '/saler/social-kit',
        label_en: 'Create Status Flyer →',
        label_bn: 'স্ট্যাটাস ব্যানার বানান →',
      },
    });
  }

  return {
    saler_id: parsedSalerId,
    recommendations: actionableRecommendations,
  };
}
