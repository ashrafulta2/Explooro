/**
 * ads.js — Mock API for the ad marketplace (catalogue, quoting, inventory, campaigns, pricing).
 *
 * WHY the pricing math is repeated here: mocks stand in for the server, and the server's authority
 * on price is server/src/services/adPricing.js. This file mirrors that engine closely enough for
 * VITE_API_MODE=mock to behave like the real thing — same line items, same discount/fee/VAT order,
 * same error codes. When a rate rule changes, change it there first, then mirror it here.
 */

const PREPAID_MODELS = ['FLAT_DAILY', 'FLAT_SLOT', 'CPS'];

const DEFAULT_TIER_DISCOUNTS = { STARTER: 0, VERIFIED_TRADER: 5, ELITE_PARTNER: 10 };

/** The signed-in seller's trust tier in mock mode — drives the loyalty discount on every quote. */
const MOCK_TIER = 'VERIFIED_TRADER';

let mockAdProducts = [
  {
    id: 1,
    key: 'search_boost',
    name_en: 'Search Boost',
    name_bn: 'সার্চ বুস্ট',
    tagline_en: 'Appear at the top when shoppers search',
    tagline_bn: 'ক্রেতারা খুঁজলেই সবার উপরে দেখান',
    description_en: 'Your product is placed above organic results for the keywords you choose. You pay only when a shopper actually clicks.',
    description_bn: 'আপনার বেছে নেওয়া কিওয়ার্ডে সার্চ ফলাফলের সবার উপরে পণ্য দেখানো হয়। ক্রেতা ক্লিক করলেই কেবল টাকা কাটা হয়।',
    icon: '🔍',
    placement: 'SEARCH_RESULTS',
    pricing_model: 'CPC',
    badge_key: 'POPULAR',
    requires_product: true,
    requires_review: true,
    is_enabled: true,
    sort_order: 10,
    allowed_roles: ['saler', 'supplier'],
    rate_card: { floor_cpc: 1.0, suggested_cpc: 2.5, min_budget: 300, min_days: 1, max_days: 90, service_fee_percent: 0, vat_percent: 0, tier_discounts: { ...DEFAULT_TIER_DISCOUNTS } },
  },
  {
    id: 2,
    key: 'feed_promotion',
    name_en: 'Home Feed Promotion',
    name_bn: 'হোম ফিড প্রমোশন',
    tagline_en: "Blend into the shopper's home feed",
    tagline_bn: 'ক্রেতার হোম ফিডে স্বাভাবিকভাবে দেখান',
    description_en: 'A native card inside the scrolling home feed. Priced per thousand views, so a large audience stays affordable.',
    description_bn: 'হোম ফিডের ভেতরে স্বাভাবিক কার্ড হিসেবে দেখানো হয়। প্রতি হাজার ভিউ হিসেবে দাম, তাই বড় অডিয়েন্সেও খরচ কম।',
    icon: '📱',
    placement: 'FEED',
    pricing_model: 'CPM',
    badge_key: null,
    requires_product: true,
    requires_review: true,
    is_enabled: true,
    sort_order: 20,
    allowed_roles: ['saler', 'supplier'],
    rate_card: { cpm_rate: 80, min_budget: 500, min_days: 1, max_days: 60, service_fee_percent: 0, vat_percent: 0, tier_discounts: { ...DEFAULT_TIER_DISCOUNTS } },
  },
  {
    id: 3,
    key: 'category_banner',
    name_en: 'Category Banner Takeover',
    name_bn: 'ক্যাটেগরি ব্যানার',
    tagline_en: 'Own the banner above a whole category',
    tagline_bn: 'পুরো ক্যাটেগরির উপরের ব্যানার দখল করুন',
    description_en: 'A full-width banner at the top of one category page, reserved for the days you book. Fixed price, no bidding.',
    description_bn: 'একটি ক্যাটেগরি পেজের উপরে পুরো প্রস্থের ব্যানার, আপনার বুক করা দিনগুলোর জন্য সংরক্ষিত। নির্দিষ্ট দাম, কোনো নিলাম নেই।',
    icon: '🏷️',
    placement: 'CATEGORY_BANNER',
    pricing_model: 'FLAT_DAILY',
    badge_key: 'BEST_VALUE',
    requires_product: false,
    requires_review: true,
    is_enabled: true,
    sort_order: 30,
    allowed_roles: ['saler', 'supplier'],
    rate_card: { daily_rate: 450, min_days: 3, max_days: 30, slots_per_period: 4, service_fee_percent: 0, vat_percent: 0, tier_discounts: { ...DEFAULT_TIER_DISCOUNTS } },
  },
  {
    id: 4,
    key: 'home_spotlight',
    name_en: 'Homepage Spotlight',
    name_bn: 'হোমপেজ স্পটলাইট',
    tagline_en: 'The first thing every visitor sees',
    tagline_bn: 'প্রতিটি ভিজিটর প্রথমেই যা দেখে',
    description_en: 'A slide in the homepage hero carousel. The highest-traffic surface on Explooro, sold as a reserved daily slot.',
    description_bn: 'হোমপেজের প্রধান ক্যারোসেলে একটি স্লাইড। এক্সপ্লোরোর সবচেয়ে বেশি ট্রাফিকের জায়গা, দৈনিক সংরক্ষিত স্লট হিসেবে বিক্রি হয়।',
    icon: '🌟',
    placement: 'HOME_HERO',
    pricing_model: 'FLAT_DAILY',
    badge_key: 'PREMIUM',
    requires_product: false,
    requires_review: true,
    is_enabled: true,
    sort_order: 40,
    allowed_roles: ['saler', 'supplier'],
    rate_card: { daily_rate: 1500, min_days: 1, max_days: 14, slots_per_period: 5, service_fee_percent: 0, vat_percent: 0, tier_discounts: { ...DEFAULT_TIER_DISCOUNTS } },
  },
  {
    id: 5,
    key: 'product_page_ads',
    name_en: 'Competitor Page Ads',
    name_bn: 'প্রতিযোগীর পেজে বিজ্ঞাপন',
    tagline_en: "Show up on similar products' pages",
    tagline_bn: 'একই ধরনের পণ্যের পেজে দেখান',
    description_en: 'Your product appears in the "Sponsored" strip on other sellers’ product pages, in front of shoppers already ready to buy.',
    description_bn: 'অন্য বিক্রেতার পণ্য পেজের "স্পনসর্ড" অংশে আপনার পণ্য দেখানো হয় — যেখানে ক্রেতা এমনিতেই কিনতে প্রস্তুত।',
    icon: '🎯',
    placement: 'PRODUCT_PAGE',
    pricing_model: 'CPC',
    badge_key: null,
    requires_product: true,
    requires_review: true,
    is_enabled: true,
    sort_order: 50,
    allowed_roles: ['saler', 'supplier'],
    rate_card: { floor_cpc: 1.5, suggested_cpc: 3.0, min_budget: 300, min_days: 1, max_days: 90, service_fee_percent: 0, vat_percent: 0, tier_discounts: { ...DEFAULT_TIER_DISCOUNTS } },
  },
  {
    id: 6,
    key: 'store_boost',
    name_en: 'Storefront Boost',
    name_bn: 'স্টোরফ্রন্ট বুস্ট',
    tagline_en: 'Promote your whole shop, not one product',
    tagline_bn: 'একটি পণ্য নয় — পুরো দোকান প্রচার করুন',
    description_en: 'Your storefront is featured in the store directory and "Shops you may like" for the days you book.',
    description_bn: 'আপনার বুক করা দিনগুলোতে স্টোর ডিরেক্টরি ও "আপনার পছন্দ হতে পারে" অংশে আপনার দোকান দেখানো হয়।',
    icon: '🏬',
    placement: 'STORE_DIRECTORY',
    pricing_model: 'FLAT_DAILY',
    badge_key: null,
    requires_product: false,
    requires_review: true,
    is_enabled: true,
    sort_order: 60,
    allowed_roles: ['saler', 'supplier'],
    rate_card: { daily_rate: 180, min_days: 7, max_days: 90, slots_per_period: 8, service_fee_percent: 0, vat_percent: 0, tier_discounts: { ...DEFAULT_TIER_DISCOUNTS } },
  },
  {
    id: 7,
    key: 'live_spotlight',
    name_en: 'Live Stream Spotlight',
    name_bn: 'লাইভ স্ট্রিম স্পটলাইট',
    tagline_en: 'Feature your live show on the lobby',
    tagline_bn: 'লাইভ লবিতে আপনার শো হাইলাইট করুন',
    description_en: 'Your live stream is pinned to the top of the live lobby and pushed to followers when it starts. Sold per stream.',
    description_bn: 'আপনার লাইভ স্ট্রিম লাইভ লবির শীর্ষে পিন করা হয় এবং শুরু হলে ফলোয়ারদের জানানো হয়। প্রতি স্ট্রিম হিসেবে বিক্রি।',
    icon: '🎥',
    placement: 'LIVE_LOBBY',
    pricing_model: 'FLAT_SLOT',
    badge_key: null,
    requires_product: false,
    requires_review: true,
    is_enabled: true,
    sort_order: 70,
    allowed_roles: ['saler', 'supplier'],
    rate_card: { slot_rate: 600, min_quantity: 1, max_quantity: 20, slots_per_period: 3, min_days: 1, max_days: 30, service_fee_percent: 0, vat_percent: 0, tier_discounts: { ...DEFAULT_TIER_DISCOUNTS } },
  },
  {
    id: 8,
    key: 'flash_slot',
    name_en: 'Flash Sale Featured Slot',
    name_bn: 'ফ্ল্যাশ সেল ফিচার্ড স্লট',
    tagline_en: 'Get into the countdown strip',
    tagline_bn: 'কাউন্টডাউন স্ট্রিপে জায়গা নিন',
    description_en: 'A guaranteed position in the homepage flash-sale strip for one sale event. You set the discount; we bring the traffic.',
    description_bn: 'একটি সেল ইভেন্টের জন্য হোমপেজ ফ্ল্যাশ সেল স্ট্রিপে নিশ্চিত জায়গা। ছাড় আপনি ঠিক করবেন, ট্রাফিক আমরা আনব।',
    icon: '⚡',
    placement: 'FLASH_STRIP',
    pricing_model: 'FLAT_SLOT',
    badge_key: null,
    requires_product: true,
    requires_review: true,
    is_enabled: true,
    sort_order: 80,
    allowed_roles: ['saler', 'supplier'],
    rate_card: { slot_rate: 2000, min_quantity: 1, max_quantity: 10, slots_per_period: 6, min_days: 1, max_days: 14, service_fee_percent: 0, vat_percent: 0, tier_discounts: { ...DEFAULT_TIER_DISCOUNTS } },
  },
  {
    id: 9,
    key: 'push_blast',
    name_en: 'Push Notification Blast',
    name_bn: 'পুশ নোটিফিকেশন ব্লাস্ট',
    tagline_en: "Land directly in the shopper's notifications",
    tagline_bn: 'সরাসরি ক্রেতার নোটিফিকেশনে পৌঁছান',
    description_en: 'A single promotional push to opted-in shoppers who match your targeting. Priced per recipient delivered.',
    description_bn: 'আপনার টার্গেটিং-এর সাথে মেলে এমন সম্মতি দেওয়া ক্রেতাদের কাছে একটি প্রচারমূলক পুশ। প্রতি প্রাপক হিসেবে দাম।',
    icon: '🔔',
    placement: 'PUSH_INBOX',
    pricing_model: 'CPS',
    badge_key: null,
    requires_product: false,
    requires_review: true,
    is_enabled: true,
    sort_order: 90,
    allowed_roles: ['saler', 'supplier'],
    rate_card: { cps_rate: 0.35, min_quantity: 1000, max_quantity: 200000, min_days: 1, max_days: 1, service_fee_percent: 0, vat_percent: 0, tier_discounts: { ...DEFAULT_TIER_DISCOUNTS } },
  },
];

let mockAdCampaigns = [
  {
    id: 901,
    ref: 'ADC-7F2A91',
    title: 'Eid Jamdani Search Boost',
    ad_product_key: 'search_boost',
    ad_product_name_en: 'Search Boost',
    ad_product_name_bn: 'সার্চ বুস্ট',
    ad_product_icon: '🔍',
    placement: 'SEARCH_RESULTS',
    pricing_model: 'CPC',
    billing_mode: 'METERED',
    status: 'ACTIVE',
    daily_budget: 250,
    total_budget: 2000,
    spent_amount: 120.5,
    today_spent_amount: 42.0,
    prepaid_amount: 0,
    bid_amount: 2.5,
    impressions_count: 1540,
    clicks_count: 85,
    ctr_percentage: '5.52',
    duration_days: null,
    created_at: new Date(Date.now() - 6 * 86400000).toISOString(),
  },
  {
    id: 902,
    ref: 'ADC-3C8B42',
    title: 'Saree Category Banner — Eid Week',
    ad_product_key: 'category_banner',
    ad_product_name_en: 'Category Banner Takeover',
    ad_product_name_bn: 'ক্যাটেগরি ব্যানার',
    ad_product_icon: '🏷️',
    placement: 'CATEGORY_BANNER',
    pricing_model: 'FLAT_DAILY',
    billing_mode: 'PREPAID',
    status: 'ACTIVE',
    daily_budget: 427.5,
    total_budget: 2992.5,
    spent_amount: 2992.5,
    today_spent_amount: 0,
    prepaid_amount: 2992.5,
    bid_amount: 0,
    impressions_count: 24800,
    clicks_count: 612,
    ctr_percentage: '2.47',
    duration_days: 7,
    slot_key: 'CATEGORY:12',
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 903,
    ref: 'ADC-9D1E07',
    title: 'Winter Collection Feed Promo',
    ad_product_key: 'feed_promotion',
    ad_product_name_en: 'Home Feed Promotion',
    ad_product_name_bn: 'হোম ফিড প্রমোশন',
    ad_product_icon: '📱',
    placement: 'FEED',
    pricing_model: 'CPM',
    billing_mode: 'METERED',
    status: 'PENDING_REVIEW',
    daily_budget: 300,
    total_budget: 1500,
    spent_amount: 0,
    today_spent_amount: 0,
    prepaid_amount: 0,
    bid_amount: 0,
    impressions_count: 0,
    clicks_count: 0,
    ctr_percentage: '0.00',
    duration_days: null,
    created_at: new Date(Date.now() - 4 * 3600000).toISOString(),
  },
  {
    id: 904,
    ref: 'ADC-5B6C33',
    title: 'Homepage Spotlight — Launch Day',
    ad_product_key: 'home_spotlight',
    ad_product_name_en: 'Homepage Spotlight',
    ad_product_name_bn: 'হোমপেজ স্পটলাইট',
    ad_product_icon: '🌟',
    placement: 'HOME_HERO',
    pricing_model: 'FLAT_DAILY',
    billing_mode: 'PREPAID',
    status: 'SCHEDULED',
    daily_budget: 1425,
    total_budget: 4275,
    spent_amount: 4275,
    today_spent_amount: 0,
    prepaid_amount: 4275,
    bid_amount: 0,
    impressions_count: 0,
    clicks_count: 0,
    ctr_percentage: '0.00',
    duration_days: 3,
    slot_key: 'HOME_HERO',
    start_date: new Date(Date.now() + 3 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
];

/* --------------------------------------------------------------------------------------------
 * Pricing — mirrors server/src/services/adPricing.js
 * ----------------------------------------------------------------------------------------- */

const RATE_DEFAULTS = {
  floor_cpc: 1.0, suggested_cpc: 2.5, cpm_rate: 80, daily_rate: 450, slot_rate: 1500,
  cps_rate: 0.35, cpa_percent: 4.0, min_budget: 0, min_days: 1, max_days: 30,
  min_quantity: 1, max_quantity: 1000, slots_per_period: 4, service_fee_percent: 0, vat_percent: 0,
};

const rateOf = (card, field) => {
  const n = Number(card?.[field]);
  return Number.isNaN(n) || card?.[field] == null ? RATE_DEFAULTS[field] : n;
};

const toPaisa = (n) => Math.round(Number(n || 0) * 100);
const fromPaisa = (p) => (p / 100).toFixed(2);
const pctOf = (p, percent) => Math.round((p * Number(percent || 0)) / 100);

function priceLabel(product) {
  const rc = product.rate_card || {};
  switch (product.pricing_model) {
    case 'CPC': return { en: `From ৳${rateOf(rc, 'floor_cpc').toFixed(2)} per click`, bn: `প্রতি ক্লিক ৳${rateOf(rc, 'floor_cpc').toFixed(2)} থেকে` };
    case 'CPM': return { en: `৳${rateOf(rc, 'cpm_rate').toFixed(0)} per 1,000 views`, bn: `প্রতি ১,০০০ ভিউ ৳${rateOf(rc, 'cpm_rate').toFixed(0)}` };
    case 'FLAT_DAILY': return { en: `৳${rateOf(rc, 'daily_rate').toFixed(0)} per day`, bn: `প্রতিদিন ৳${rateOf(rc, 'daily_rate').toFixed(0)}` };
    case 'FLAT_SLOT': return { en: `৳${rateOf(rc, 'slot_rate').toFixed(0)} per slot`, bn: `প্রতি স্লট ৳${rateOf(rc, 'slot_rate').toFixed(0)}` };
    case 'CPS': return { en: `৳${rateOf(rc, 'cps_rate').toFixed(2)} per recipient`, bn: `প্রতি প্রাপক ৳${rateOf(rc, 'cps_rate').toFixed(2)}` };
    default: return { en: '', bn: '' };
  }
}

function present(product) {
  const label = priceLabel(product);
  const rc = product.rate_card || {};
  return {
    ...product,
    billing_mode: PREPAID_MODELS.includes(product.pricing_model) ? 'PREPAID' : 'METERED',
    price_label_en: label.en,
    price_label_bn: label.bn,
    limits: {
      min_days: rateOf(rc, 'min_days'),
      max_days: rateOf(rc, 'max_days'),
      min_quantity: rateOf(rc, 'min_quantity'),
      max_quantity: rateOf(rc, 'max_quantity'),
      min_budget: rateOf(rc, 'min_budget'),
      floor_cpc: rateOf(rc, 'floor_cpc'),
      suggested_cpc: rateOf(rc, 'suggested_cpc'),
      slots_per_period: rateOf(rc, 'slots_per_period'),
    },
  };
}

function buildQuote(product, input, tier) {
  const rc = product.rate_card || {};
  const days = Math.max(1, Math.round(Number(input.duration_days) || rateOf(rc, 'min_days')));
  const quantity = Math.max(1, Math.round(Number(input.quantity) || rateOf(rc, 'min_quantity')));
  const budgetPaisa = toPaisa(input.total_budget);

  let lines = [];
  let subtotal = 0;
  let estimate = {};

  switch (product.pricing_model) {
    case 'CPC': {
      const bid = toPaisa(input.bid_amount || rateOf(rc, 'suggested_cpc'));
      if (Number(input.bid_amount || 0) < rateOf(rc, 'floor_cpc')) {
        return { error: { code: 'BID_BELOW_FLOOR', message: `Bid must be at least ৳${rateOf(rc, 'floor_cpc').toFixed(2)} for this placement.` } };
      }
      if (Number(input.total_budget || 0) < rateOf(rc, 'min_budget')) {
        return { error: { code: 'BUDGET_TOO_LOW', message: `Minimum budget for this format is ৳${rateOf(rc, 'min_budget').toFixed(2)}.` } };
      }
      lines = [{ key: 'budget_cap', label_en: 'Campaign budget (charged per click)', label_bn: 'ক্যাম্পেইন বাজেট (প্রতি ক্লিকে কাটা হবে)', qty: 1, unit: 'BUDGET', unit_paisa: budgetPaisa, amount_paisa: budgetPaisa }];
      subtotal = budgetPaisa;
      estimate = { clicks: bid > 0 ? Math.floor(budgetPaisa / bid) : 0 };
      break;
    }
    case 'CPM': {
      const cpm = toPaisa(rateOf(rc, 'cpm_rate'));
      if (Number(input.total_budget || 0) < rateOf(rc, 'min_budget')) {
        return { error: { code: 'BUDGET_TOO_LOW', message: `Minimum budget for this format is ৳${rateOf(rc, 'min_budget').toFixed(2)}.` } };
      }
      lines = [{ key: 'budget_cap', label_en: 'Campaign budget (charged per 1,000 views)', label_bn: 'ক্যাম্পেইন বাজেট (প্রতি ১,০০০ ভিউতে কাটা হবে)', qty: 1, unit: 'BUDGET', unit_paisa: budgetPaisa, amount_paisa: budgetPaisa }];
      subtotal = budgetPaisa;
      estimate = { impressions: cpm > 0 ? Math.floor((budgetPaisa / cpm) * 1000) : 0 };
      break;
    }
    case 'FLAT_DAILY': {
      if (days < rateOf(rc, 'min_days')) {
        return { error: { code: 'DURATION_TOO_SHORT', message: `This placement is sold for at least ${rateOf(rc, 'min_days')} day(s).` } };
      }
      const daily = toPaisa(rateOf(rc, 'daily_rate'));
      lines = [{ key: 'slot_rent', label_en: 'Reserved placement', label_bn: 'সংরক্ষিত প্লেসমেন্ট', qty: days, unit: 'DAY', unit_paisa: daily, amount_paisa: daily * days }];
      subtotal = daily * days;
      estimate = { days };
      break;
    }
    case 'FLAT_SLOT': {
      const slot = toPaisa(rateOf(rc, 'slot_rate'));
      lines = [{ key: 'slot_fee', label_en: 'Placement slot', label_bn: 'প্লেসমেন্ট স্লট', qty: quantity, unit: 'SLOT', unit_paisa: slot, amount_paisa: slot * quantity }];
      subtotal = slot * quantity;
      estimate = { slots: quantity };
      break;
    }
    case 'CPS': {
      if (quantity < rateOf(rc, 'min_quantity')) {
        return { error: { code: 'QUANTITY_TOO_LOW', message: `Minimum order for this format is ${rateOf(rc, 'min_quantity')}.` } };
      }
      const perSend = toPaisa(rateOf(rc, 'cps_rate'));
      lines = [{ key: 'sends', label_en: 'Notification recipients', label_bn: 'নোটিফিকেশন প্রাপক', qty: quantity, unit: 'RECIPIENT', unit_paisa: perSend, amount_paisa: perSend * quantity }];
      subtotal = perSend * quantity;
      estimate = { reach: quantity };
      break;
    }
    default:
      return { error: { code: 'INVALID_PRICING_MODEL', message: 'This ad format has no valid pricing model.' } };
  }

  const discountPercent = Number((rc.tier_discounts || DEFAULT_TIER_DISCOUNTS)[tier] ?? 0);
  const discount = pctOf(subtotal, discountPercent);
  const afterDiscount = subtotal - discount;
  const serviceFee = pctOf(afterDiscount, rateOf(rc, 'service_fee_percent'));
  const vat = pctOf(afterDiscount + serviceFee, rateOf(rc, 'vat_percent'));
  const total = afterDiscount + serviceFee + vat;
  const billingMode = PREPAID_MODELS.includes(product.pricing_model) ? 'PREPAID' : 'METERED';

  const quote = {
    ad_product_key: product.key,
    pricing_model: product.pricing_model,
    billing_mode: billingMode,
    currency: 'BDT',
    lines: lines.map((l) => ({
      key: l.key, label_en: l.label_en, label_bn: l.label_bn, qty: l.qty, unit: l.unit,
      unit_amount: fromPaisa(l.unit_paisa), amount: fromPaisa(l.amount_paisa),
    })),
    subtotal: fromPaisa(subtotal),
    tier,
    discount_percent: discountPercent.toFixed(2),
    discount_amount: fromPaisa(discount),
    service_fee_percent: rateOf(rc, 'service_fee_percent').toFixed(2),
    service_fee: fromPaisa(serviceFee),
    vat_percent: rateOf(rc, 'vat_percent').toFixed(2),
    vat: fromPaisa(vat),
    total: fromPaisa(total),
    charge_now: billingMode === 'PREPAID' ? fromPaisa(total) : '0.00',
    budget_cap: billingMode === 'METERED' ? fromPaisa(total) : '0.00',
    estimate,
  };

  if (['FLAT_DAILY', 'FLAT_SLOT'].includes(product.pricing_model)) {
    const slotsPerPeriod = rateOf(rc, 'slots_per_period');
    // Mock inventory: pretend one position is already sold on a busy format.
    const taken = product.key === 'home_spotlight' ? 2 : 1;
    quote.availability = {
      slot_key: product.placement,
      slots_per_period: slotsPerPeriod,
      busiest_day_taken: taken,
      slots_left: Math.max(0, slotsPerPeriod - taken),
      available: taken < slotsPerPeriod,
    };
  }

  return { quote };
}

const adsHandlers = [
  {
    method: 'GET',
    path: '/ads/products',
    handler() {
      return {
        status: 200,
        body: {
          tier: MOCK_TIER,
          products: mockAdProducts
            .filter((p) => p.is_enabled)
            .map((p) => ({
              ...present(p),
              your_discount_percent: Number((p.rate_card?.tier_discounts || DEFAULT_TIER_DISCOUNTS)[MOCK_TIER] ?? 0),
            })),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/ads/quote',
    handler({ body }) {
      const product = mockAdProducts.find((p) => p.key === body?.ad_product_key);
      if (!product) {
        return { status: 404, body: { error: { code: 'AD_PRODUCT_NOT_FOUND', message: 'Unknown ad format.' } } };
      }
      const result = buildQuote(product, body || {}, MOCK_TIER);
      if (result.error) {
        return { status: 400, body: { error: result.error } };
      }
      return { status: 200, body: { quote: result.quote } };
    },
  },
  {
    method: 'GET',
    path: '/ads/availability',
    handler({ query }) {
      const product = mockAdProducts.find((p) => p.key === query?.product_key);
      if (!product) return { status: 200, body: { slot_key: null, days: [] } };
      const slots = rateOf(product.rate_card, 'slots_per_period');
      const days = [];
      for (let i = 0; i < 30; i += 1) {
        const d = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
        const taken = i % 7 === 0 ? slots : Math.min(slots, i % 3);
        days.push({ date: d, taken, left: Math.max(0, slots - taken) });
      }
      return { status: 200, body: { slot_key: product.placement, slots_per_period: slots, days } };
    },
  },
  {
    method: 'GET',
    path: '/ads/target-categories',
    handler() {
      return {
        status: 200,
        body: {
          categories: [
            { id: 12, name_en: 'Sarees & Traditional Wear', name_bn: 'শাড়ি ও ঐতিহ্যবাহী পোশাক', slug: 'sarees' },
            { id: 14, name_en: 'Electronics & Gadgets', name_bn: 'ইলেকট্রনিক্স ও গ্যাজেট', slug: 'electronics' },
            { id: 18, name_en: 'Home & Kitchen', name_bn: 'হোম ও কিচেন', slug: 'home-kitchen' },
            { id: 21, name_en: 'Beauty & Personal Care', name_bn: 'বিউটি ও পার্সোনাল কেয়ার', slug: 'beauty' },
            { id: 25, name_en: 'Groceries & Food', name_bn: 'মুদি ও খাবার', slug: 'grocery' },
            { id: 31, name_en: 'Mobile & Accessories', name_bn: 'মোবাইল ও এক্সেসরিজ', slug: 'mobile' },
          ],
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/ads/campaigns',
    handler() {
      return { status: 200, body: { campaigns: mockAdCampaigns } };
    },
  },
  {
    method: 'POST',
    path: '/ads/campaigns',
    handler({ body }) {
      const product = mockAdProducts.find((p) => p.key === body?.ad_product_key) || mockAdProducts[0];
      const result = buildQuote(product, body || {}, MOCK_TIER);
      if (result.error) {
        return { status: 400, body: { error: result.error } };
      }
      const q = result.quote;
      const isPrepaid = q.billing_mode === 'PREPAID';
      const days = Number(body?.duration_days) || Number(body?.quantity) || 1;

      const newCampaign = {
        id: Date.now(),
        ref: `ADC-${Date.now().toString(36).toUpperCase().slice(-6)}`,
        title: body?.title || product.name_en,
        ad_product_key: product.key,
        ad_product_name_en: product.name_en,
        ad_product_name_bn: product.name_bn,
        ad_product_icon: product.icon,
        placement: product.placement,
        pricing_model: product.pricing_model,
        billing_mode: q.billing_mode,
        status: 'PENDING_REVIEW',
        total_budget: Number(isPrepaid ? q.charge_now : q.budget_cap),
        daily_budget: isPrepaid ? Number((Number(q.charge_now) / days).toFixed(2)) : Number(body?.daily_budget || 0),
        spent_amount: isPrepaid ? Number(q.charge_now) : 0,
        today_spent_amount: 0,
        prepaid_amount: isPrepaid ? Number(q.charge_now) : 0,
        bid_amount: product.pricing_model === 'CPC' ? Number(body?.bid_amount || 0) : 0,
        impressions_count: 0,
        clicks_count: 0,
        ctr_percentage: '0.00',
        duration_days: body?.duration_days ? Number(body.duration_days) : null,
        quantity: body?.quantity ? Number(body.quantity) : null,
        quote_json: q,
        created_at: new Date().toISOString(),
      };
      mockAdCampaigns.unshift(newCampaign);
      return { status: 201, body: { campaign: newCampaign } };
    },
  },
  {
    method: 'POST',
    path: '/ads/campaigns/:id/pause',
    handler({ params }) {
      const camp = mockAdCampaigns.find((c) => c.id === Number(params.id));
      if (camp) camp.status = 'PAUSED';
      return { status: 200, body: { campaign: camp || null } };
    },
  },
  {
    method: 'POST',
    path: '/ads/campaigns/:id/resume',
    handler({ params }) {
      const camp = mockAdCampaigns.find((c) => c.id === Number(params.id));
      if (camp) camp.status = 'ACTIVE';
      return { status: 200, body: { campaign: camp || null } };
    },
  },
  {
    method: 'POST',
    path: '/ads/campaigns/:id/cancel',
    handler({ params }) {
      const camp = mockAdCampaigns.find((c) => c.id === Number(params.id));
      if (camp) camp.status = 'COMPLETED';
      return { status: 200, body: { campaign: camp || null } };
    },
  },

  /* ----------------------------------------------------------------------------------------
   * Admin — ad pricing governance
   * ------------------------------------------------------------------------------------- */
  {
    method: 'GET',
    path: '/admin/ads/products',
    handler() {
      const seededStats = {
        search_boost: { campaigns: 34, revenue: '48250.00', impressions: 1284000, clicks: 41200 },
        feed_promotion: { campaigns: 12, revenue: '18400.00', impressions: 920000, clicks: 7350 },
        category_banner: { campaigns: 9, revenue: '26550.00', impressions: 415000, clicks: 9800 },
        home_spotlight: { campaigns: 5, revenue: '31500.00', impressions: 680000, clicks: 15400 },
        product_page_ads: { campaigns: 18, revenue: '12750.00', impressions: 340000, clicks: 6100 },
        store_boost: { campaigns: 7, revenue: '8820.00', impressions: 96000, clicks: 2450 },
        live_spotlight: { campaigns: 4, revenue: '2400.00', impressions: 54000, clicks: 1980 },
        flash_slot: { campaigns: 3, revenue: '6000.00', impressions: 210000, clicks: 8400 },
        push_blast: { campaigns: 6, revenue: '14700.00', impressions: 42000, clicks: 3900 },
      };
      return {
        status: 200,
        body: {
          window_days: 30,
          products: mockAdProducts.map((p) => ({
            ...present(p),
            stats: seededStats[p.key] || { campaigns: 0, revenue: '0.00', impressions: 0, clicks: 0 },
          })),
        },
      };
    },
  },
  {
    method: 'PATCH',
    path: '/admin/ads/products/:id',
    handler({ params, body }) {
      const product = mockAdProducts.find((p) => p.id === Number(params.id));
      if (!product) {
        return { status: 404, body: { error: { code: 'AD_PRODUCT_NOT_FOUND', message: 'This ad format does not exist.' } } };
      }
      if (body?.rate_card) {
        product.rate_card = {
          ...product.rate_card,
          ...body.rate_card,
          tier_discounts: { ...(product.rate_card.tier_discounts || {}), ...(body.rate_card.tier_discounts || {}) },
        };
      }
      if (body?.is_enabled != null) product.is_enabled = Boolean(body.is_enabled);
      if (body?.requires_review != null) product.requires_review = Boolean(body.requires_review);
      if (body?.badge_key !== undefined) product.badge_key = body.badge_key || null;
      product.updated_at = new Date().toISOString();
      return { status: 200, body: { product: present(product) } };
    },
  },
];

export default adsHandlers;
