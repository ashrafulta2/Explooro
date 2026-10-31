/**
 * supplierFlashSale.ts — mock of a supplier's own flash sales (server/src/services/supplierFlashSale.service.ts).
 *
 * Mirrors the server's rules so the feature is demonstrable with VITE_API_MODE=mock: the supplier
 * funds the discount (platform + partner keep their regular share), the admin's limits are enforced,
 * and a product must have sold at its price for `min_listing_days` first. A deal made here is put
 * on the mock catalog row (setMockProductFlashSale), so the home strip, the card and the mock cart
 * all show and charge it.
 *
 * Demo figures, stated plainly: fixture products carry only a retail price, so the supplier price is
 * taken as retail / 1.15 (the shipped 15% markup) and the margin is split 70/30 partner/platform.
 * The demo supplier owns the fixtures of two stores.
 */

import type { MockRoute } from '../types.ts';
import { listMockProducts, setMockProductFlashSale } from './products.ts';

const DAY_MS = 24 * 3600_000;
const OWN_STORES = new Set(['STR-RAHIM001', 'STR-DHKTEX02']);
const RULE_LIMITS = {
  max_discount_pct: { min: 1, max: 90 },
  max_duration_hours: { min: 1, max: 720 },
  max_live_deals: { min: 1, max: 100 },
  min_listing_days: { min: 0, max: 90 },
};
let rules = { enabled: true, max_discount_pct: 50, max_duration_hours: 72, max_live_deals: 5, min_listing_days: 7, updated_at: new Date().toISOString() };
const deals: Record<string, any>[] = [];

/** The suppliers' own deals, so the admin's list (campaigns.ts) shows them beside its own. */
export function listSupplierFundedMockDeals() {
  return deals;
}
// Most fixtures have sold at their price for a while; every fourth was re-priced two days ago.
const LOADED_AT = Date.now();
const priceSince = (p) => new Date(LOADED_AT - (Number(p.id) % 4 === 0 ? 2 : 40) * DAY_MS).toISOString();

const fail = (status: number, code: string, en: string, bn: string, details: Record<string, any> = {}) =>
  ({ status, body: { error: { code, message_en: en, message_bn: bn, details } } });
const round2 = (n: number) => Math.round(n * 100) / 100;

const ownProducts = () => listMockProducts().filter((p) => OWN_STORES.has(p.store_ref));
const findOwn = (id) => ownProducts().find((p) => String(p.id) === String(id));
const eligibleFrom = (p) => new Date(Date.parse(priceSince(p)) + rules.min_listing_days * DAY_MS);
const liveDeals = () => deals.filter((d) => ['ACTIVE', 'SCHEDULED'].includes(d.status) && Date.parse(d.ends_at) > Date.now());

function priceDeal(p, dealPrice) {
  const regular = Number(p.price);
  const supplier = round2(regular / 1.15);
  const margin = round2(regular - supplier);
  const partner = round2(margin * 0.7);
  const platform = round2(margin - partner);
  const deal = round2(Number(dealPrice));
  const funded = round2(regular - deal);
  if (!(deal > 0) || funded <= 0) {
    return { error: fail(400, 'VALIDATION_FAILED', `The flash price must be above zero and below the regular price (BDT ${regular.toFixed(2)}).`, `ফ্ল্যাশ দাম শূন্যের বেশি এবং নিয়মিত দামের (৳${regular.toFixed(2)}) কম হতে হবে।`, { field: 'discount_price' }) };
  }
  const payout = round2(supplier - funded);
  if (payout <= 0) {
    const min = round2(margin + 0.01);
    return { error: fail(400, 'VALIDATION_FAILED', `At this flash price you would receive nothing per unit. The lowest flash price is BDT ${min.toFixed(2)}.`, `এই ফ্ল্যাশ দামে আপনি প্রতি ইউনিটে কিছুই পাবেন না। সর্বনিম্ন ফ্ল্যাশ দাম ৳${min.toFixed(2)}।`, { field: 'discount_price', min_price: min }) };
  }
  return {
    pricing: {
      regular_price: regular, deal_price: deal, discount_pct: Math.round((funded / regular) * 100),
      supplier_funded: funded, supplier_payout: payout, regular_supplier_payout: supplier,
      partner_share: partner, platform_share: platform,
    },
  };
}

function ruleProblem(p, dealPrice, window: { startsAt: Date; endsAt: Date } | null, checkCount: boolean) {
  if (!rules.enabled) return fail(403, 'FORBIDDEN', 'Suppliers cannot start flash sales right now.', 'এই মুহূর্তে সাপ্লায়াররা ফ্ল্যাশ সেল চালু করতে পারবেন না।');
  const from = eligibleFrom(p);
  if (from.getTime() > Date.now()) {
    const day = from.toISOString().slice(0, 10);
    return fail(400, 'VALIDATION_FAILED', `This product can have a flash sale from ${day}: it must sell at its current price for ${rules.min_listing_days} days first.`, `এই পণ্যে ${day} থেকে ফ্ল্যাশ সেল দেওয়া যাবে: আগে বর্তমান দামে ${rules.min_listing_days} দিন বিক্রি হতে হবে।`, { reason: 'LISTING_TOO_NEW' });
  }
  const min = Math.ceil(Number(p.price) * (100 - rules.max_discount_pct)) / 100;
  if (Number(dealPrice) < min) {
    return fail(400, 'VALIDATION_FAILED', `A flash sale can take at most ${rules.max_discount_pct}% off, so the lowest price is BDT ${min.toFixed(2)}.`, `ফ্ল্যাশ সেলে সর্বোচ্চ ${rules.max_discount_pct}% ছাড় দেওয়া যায়, তাই সর্বনিম্ন দাম ৳${min.toFixed(2)}।`, { reason: 'DISCOUNT_TOO_DEEP' });
  }
  if (window && window.endsAt.getTime() - window.startsAt.getTime() > rules.max_duration_hours * 3600_000) {
    return fail(400, 'VALIDATION_FAILED', `A flash sale can run for at most ${rules.max_duration_hours} hours.`, `ফ্ল্যাশ সেল সর্বোচ্চ ${rules.max_duration_hours} ঘণ্টা চলতে পারে।`, { reason: 'TOO_LONG' });
  }
  if (checkCount && liveDeals().length >= rules.max_live_deals) {
    return fail(400, 'VALIDATION_FAILED', `You already have ${liveDeals().length} live or scheduled flash sales; the limit is ${rules.max_live_deals}.`, `আপনার ইতিমধ্যে ${liveDeals().length}টি চালু বা নির্ধারিত ফ্ল্যাশ সেল আছে; সীমা ${rules.max_live_deals}টি।`, { reason: 'TOO_MANY_DEALS' });
  }
  return null;
}

export default [
  {
    method: 'GET',
    path: '/supplier/flash-sales',
    handler: ({ query = {} }) => {
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const own = ownProducts();
      const now = Date.now();
      return {
        status: 200,
        body: {
          rules,
          products: own.slice(offset, offset + limit).map((p) => {
            const from = eligibleFrom(p);
            const live = p.is_flash_sale ? p.flash_sale_id : null;
            return {
              id: p.id, ref: p.ref, title_en: p.title_en, title_bn: p.title_bn, stock_qty: p.stock,
              default_retail_price: p.price, retail_price_since: priceSince(p), live_flash_sale_id: live,
              eligible_from: from.toISOString(), eligible: from.getTime() <= now && live == null,
            };
          }),
          // Same reading as the server's displayStatus: the window, not the stored SCHEDULED.
          deals: deals.map((d) => {
            if (!['ACTIVE', 'SCHEDULED'].includes(d.status)) return d;
            const status = Date.parse(d.ends_at) <= now ? 'COMPLETED' : Date.parse(d.starts_at) <= now ? 'ACTIVE' : 'SCHEDULED';
            return { ...d, status };
          }),
          meta: { limit, offset, total: own.length },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/supplier/flash-sales/quote',
    handler: ({ query = {} }) => {
      const p = findOwn(query.product_id);
      if (!p) return fail(404, 'NOT_FOUND', 'Product not found.', 'পণ্য পাওয়া যায়নি।');
      const priced = priceDeal(p, query.discount_price);
      if (priced.error) return priced.error;
      const problem = ruleProblem(p, query.discount_price, null, false);
      return { status: 200, body: { pricing: priced.pricing, problem: problem ? problem.body.error : null } };
    },
  },
  {
    method: 'POST',
    path: '/supplier/flash-sales',
    handler: ({ body = {} }) => {
      const p = findOwn(body.product_id);
      if (!p) return fail(404, 'NOT_FOUND', 'Product not found.', 'পণ্য পাওয়া যায়নি।');
      const startsAt = body.starts_at ? new Date(body.starts_at) : new Date();
      const endsAt = new Date(body.ends_at);
      if (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        return fail(400, 'VALIDATION_FAILED', 'Choose an end time after the start time.', 'শুরুর সময়ের পরে একটি শেষ সময় বেছে নিন।', { field: 'ends_at' });
      }
      if (p.is_flash_sale) return fail(409, 'CONFLICT', 'This product already has a flash sale in that time window.', 'এই সময়ে পণ্যটিতে ইতিমধ্যে একটি ফ্ল্যাশ সেল চালু আছে।');
      const problem = ruleProblem(p, body.discount_price, { startsAt, endsAt }, true);
      if (problem) return problem;
      const priced = priceDeal(p, body.discount_price);
      if (priced.error) return priced.error;
      const allocated = Number(body.allocated_qty);
      if (!(allocated > 0) || allocated > Number(p.stock)) {
        return fail(400, 'VALIDATION_FAILED', `Allocate between 1 and ${p.stock} units.`, `১ থেকে ${p.stock}টি ইউনিট বরাদ্দ করুন।`, { field: 'allocated_qty' });
      }
      const deal = {
        id: Date.now(), ref: `FLS-${Date.now().toString(36).toUpperCase()}`, product_id: p.id,
        product_title_en: p.title_en, product_title_bn: p.title_bn,
        discount_price: priced.pricing.deal_price.toFixed(2), original_price: Number(p.price).toFixed(2),
        allocated_qty: allocated, sold_qty: 0, per_user_limit: Number(body.per_user_limit) || 1,
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), status: 'SCHEDULED', funded_by: 'SUPPLIER',
        created_at: new Date().toISOString(),
      };
      deals.unshift(deal);
      if (startsAt.getTime() <= Date.now()) setMockProductFlashSale(p.id, deal);
      return { status: 201, body: { flash_sale: deal, pricing: priced.pricing } };
    },
  },
  {
    method: 'POST',
    path: '/supplier/flash-sales/:id/stop',
    handler: ({ params = {} }) => {
      const deal = deals.find((d) => String(d.id) === String(params.id));
      if (!deal) return fail(404, 'NOT_FOUND', 'Flash sale not found.', 'ফ্ল্যাশ সেল পাওয়া যায়নি।');
      if (!['ACTIVE', 'SCHEDULED'].includes(deal.status)) return fail(409, 'CONFLICT', 'This flash sale has already ended.', 'এই ফ্ল্যাশ সেল ইতিমধ্যে শেষ হয়েছে।');
      deal.status = 'CANCELLED';
      setMockProductFlashSale(deal.product_id, null);
      return { status: 200, body: { flash_sale: deal } };
    },
  },
  {
    method: 'GET',
    path: '/admin/growth/campaigns/flash-sales/supplier-rules',
    handler: () => ({ status: 200, body: { rules, limits: RULE_LIMITS } }),
  },
  {
    method: 'PUT',
    path: '/admin/growth/campaigns/flash-sales/supplier-rules',
    handler: ({ body = {} }) => {
      const next = body.rules || {};
      if (typeof next.enabled !== 'boolean') return fail(400, 'VALIDATION_FAILED', 'Say whether suppliers may run flash sales.', 'সাপ্লায়াররা ফ্ল্যাশ সেল চালাতে পারবে কিনা জানান।', { field: 'enabled' });
      for (const [key, { min, max }] of Object.entries(RULE_LIMITS)) {
        if (!Number.isInteger(next[key]) || next[key] < min || next[key] > max) {
          return fail(400, 'VALIDATION_FAILED', `${key} must be a whole number from ${min} to ${max}.`, `${key} ${min} থেকে ${max} এর মধ্যে একটি পূর্ণ সংখ্যা হতে হবে।`, { field: key });
        }
      }
      if (typeof body.reason !== 'string' || body.reason.trim().length < 10) {
        return fail(400, 'VALIDATION_FAILED', 'Give a reason of at least 10 characters for this change.', 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।', { field: 'reason' });
      }
      if (body.expected_updated_at && body.expected_updated_at !== rules.updated_at) {
        return fail(409, 'CONFLICT', 'Someone else changed these limits since you opened them. Reload and try again.', 'আপনি খোলার পর অন্য কেউ এই সীমা বদলেছেন। আবার লোড করে চেষ্টা করুন।');
      }
      rules = { enabled: next.enabled, max_discount_pct: next.max_discount_pct, max_duration_hours: next.max_duration_hours, max_live_deals: next.max_live_deals, min_listing_days: next.min_listing_days, updated_at: new Date().toISOString() };
      return { status: 200, body: { rules, limits: RULE_LIMITS } };
    },
  },
] satisfies MockRoute[];
