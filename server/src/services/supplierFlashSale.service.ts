/**
 * supplierFlashSale.service.ts — a supplier's own flash sales (migration 096, owner decision 2026-10-31).
 *
 * The one place that decides whether a supplier may discount a product and what they are paid:
 *   * The supplier funds the whole discount. The platform's and the partner pool's share of a unit are
 *     what they are at the regular retail price; the supplier's payout drops by regular − deal
 *     (pricing.service calculateSupplierFundedBreakdown, used by both the quote here and checkout).
 *   * A deal is live at once if it fits the limits an admin sets in `flash_sale.supplier_rules`
 *     (RULE_LIMITS bounds each one). An admin can still emergency-stop it.
 *   * A product must have sold at its current retail price for `min_listing_days`
 *     (`products.retail_price_since`, restarted by a trigger on every retail change). WHY: the struck
 *     price a shopper sees must be one they were really charged, and listing an old product again as
 *     "new" must not dodge the funding.
 */

import * as settingRepo from '../repositories/setting.repository.ts';
import { AppError } from '../plugins/errorHandler.ts';
import { writeAudit } from '../lib/audit.ts';
import { calculateSupplierFundedBreakdown, resolveSplitPercentages, toPaisa } from './pricing.service.ts';
import { createFlashSale } from './flashSale.service.ts';

export const SETTINGS_GROUP = 'growth';
export const SETTING_KEY = 'flash_sale.supplier_rules';

/** Bounds of every rule. The admin form and the API both read these; a write outside them is refused. */
export const RULE_LIMITS = Object.freeze({
  max_discount_pct: { min: 1, max: 90 },
  max_duration_hours: { min: 1, max: 720 },
  max_live_deals: { min: 1, max: 100 },
  min_listing_days: { min: 0, max: 90 },
});

export const DEFAULT_RULES = Object.freeze({
  enabled: true,
  max_discount_pct: 50,
  max_duration_hours: 72,
  max_live_deals: 5,
  min_listing_days: 7,
});

const SETTING_META = {
  valueType: 'OBJECT',
  labelEn: 'Supplier flash sale limits',
  labelBn: 'সাপ্লায়ারের ফ্ল্যাশ সেলের সীমা',
};

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
// A start a little in the past is "now" sent from a slow form, not a backdated deal.
const START_GRACE_MS = 5 * 60_000;

function readJsonValue(raw) {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

function isWholeIn(n, { min, max }) {
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
}

/** Forgiving reader: a missing or out-of-range stored field falls back to its default. */
export function sanitizeRules(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const out: Record<string, any> = { enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_RULES.enabled };
  for (const key of Object.keys(RULE_LIMITS)) {
    out[key] = isWholeIn(v[key], RULE_LIMITS[key]) ? v[key] : DEFAULT_RULES[key];
  }
  return out as typeof DEFAULT_RULES;
}

/** Strict: the API refuses anything out of range instead of clamping it. Pure, for the tests too. */
export function validateRules(input: Record<string, any> = {}) {
  if (typeof input.enabled !== 'boolean') {
    throw new AppError('VALIDATION_FAILED', 'Say whether suppliers may run flash sales.', 'সাপ্লায়াররা ফ্ল্যাশ সেল চালাতে পারবে কিনা জানান।', { field: 'enabled' });
  }
  const out: Record<string, any> = { enabled: input.enabled };
  for (const [key, range] of Object.entries(RULE_LIMITS)) {
    if (!isWholeIn(input[key], range)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${key} must be a whole number from ${range.min} to ${range.max}.`,
        `${key} ${range.min} থেকে ${range.max} এর মধ্যে একটি পূর্ণ সংখ্যা হতে হবে।`,
        { field: key, ...range }
      );
    }
    out[key] = input[key];
  }
  return out as typeof DEFAULT_RULES;
}

export async function getRules(db) {
  let row = null;
  try {
    row = await settingRepo.getSettingByKey(db, SETTING_KEY);
  } catch {
    // Before migration 096 the shipped defaults are a better answer than a 500.
  }
  return { ...sanitizeRules(readJsonValue(row?.value_json)), updated_at: row?.updated_at ?? null };
}

/** Admin write: strict, reasoned, stale-checked and audited with before/after. */
export async function updateRules(db, { rules, reason, expectedUpdatedAt = null, user, reqMeta = {} as Record<string, any> }) {
  const next = validateRules(rules);
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    throw new AppError('VALIDATION_FAILED', 'Give a reason of at least 10 characters for this change.', 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।', { field: 'reason' });
  }

  const client = db.connect ? await db.connect() : db;
  const dedicated = Boolean(db.connect);
  let before;
  let after;
  try {
    if (dedicated) await client.query('BEGIN');
    await settingRepo.lockSettingsGroup(client, SETTINGS_GROUP);
    const row = await settingRepo.getSettingByKey(client, SETTING_KEY);
    // WHY 409: a form opened before someone else's save would silently undo it.
    if (expectedUpdatedAt && row?.updated_at && new Date(row.updated_at).getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw new AppError('CONFLICT', 'Someone else changed these limits since you opened them. Reload and try again.', 'আপনি খোলার পর অন্য কেউ এই সীমা বদলেছেন। আবার লোড করে চেষ্টা করুন।');
    }
    before = sanitizeRules(readJsonValue(row?.value_json));
    const saved = await settingRepo.upsertSetting(client, { key: SETTING_KEY, valueJson: next, groupKey: SETTINGS_GROUP, updatedBy: user?.id ?? null, ...SETTING_META });
    after = { ...sanitizeRules(readJsonValue(saved?.value_json)), updated_at: saved?.updated_at ?? null };
    if (dedicated) await client.query('COMMIT');
  } catch (err) {
    if (dedicated) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (dedicated && client.release) client.release();
  }

  await writeAudit(db, {
    actorId: user?.id ?? null,
    action: 'growth.flash_sale.update_supplier_rules',
    targetType: 'platform_settings',
    targetRef: SETTING_KEY,
    before,
    after: { ...after, reason: reason.trim() },
    ip: reqMeta.ip || null,
    userAgent: reqMeta.userAgent || null,
  });
  return after;
}

/** When the product may first be discounted by its supplier, from its retail-price clock. */
export function eligibleFrom(retailPriceSince, minListingDays) {
  const since = new Date(retailPriceSince ?? 0).getTime();
  return new Date((Number.isFinite(since) ? since : 0) + minListingDays * DAY_MS);
}

/**
 * Every rule a supplier deal must pass, pure so the tests and the quote share it. Throws the first
 * failure as VALIDATION_FAILED (or FORBIDDEN when suppliers may not run deals at all).
 */
export function assertDealFitsRules({ rules, product, discountPrice, startsAt, endsAt, liveDeals, now = Date.now() }) {
  if (!rules.enabled) {
    throw new AppError('FORBIDDEN', 'Suppliers cannot start flash sales right now.', 'এই মুহূর্তে সাপ্লায়াররা ফ্ল্যাশ সেল চালু করতে পারবেন না।');
  }
  const from = eligibleFrom(product.retail_price_since, rules.min_listing_days);
  if (from.getTime() > now) {
    throw new AppError(
      'VALIDATION_FAILED',
      `This product can have a flash sale from ${from.toISOString().slice(0, 10)}: it must sell at its current price for ${rules.min_listing_days} days first.`,
      `এই পণ্যে ${from.toISOString().slice(0, 10)} থেকে ফ্ল্যাশ সেল দেওয়া যাবে: আগে বর্তমান দামে ${rules.min_listing_days} দিন বিক্রি হতে হবে।`,
      { field: 'product_id', reason: 'LISTING_TOO_NEW', eligible_from: from.toISOString() }
    );
  }
  const regularPaisa = toPaisa(product.default_retail_price);
  const dealPaisa = toPaisa(discountPrice);
  const minDealPaisa = Math.ceil((regularPaisa * (100 - rules.max_discount_pct)) / 100);
  if (dealPaisa < minDealPaisa) {
    throw new AppError(
      'VALIDATION_FAILED',
      `A flash sale can take at most ${rules.max_discount_pct}% off, so the lowest price is BDT ${(minDealPaisa / 100).toFixed(2)}.`,
      `ফ্ল্যাশ সেলে সর্বোচ্চ ${rules.max_discount_pct}% ছাড় দেওয়া যায়, তাই সর্বনিম্ন দাম ৳${(minDealPaisa / 100).toFixed(2)}।`,
      { field: 'discount_price', reason: 'DISCOUNT_TOO_DEEP', min_price: minDealPaisa / 100 }
    );
  }
  if (startsAt && endsAt) {
    if (startsAt.getTime() < now - START_GRACE_MS) {
      throw new AppError('VALIDATION_FAILED', 'A flash sale cannot start in the past.', 'ফ্ল্যাশ সেল অতীতে শুরু হতে পারে না।', { field: 'starts_at' });
    }
    if (endsAt.getTime() - startsAt.getTime() > rules.max_duration_hours * HOUR_MS) {
      throw new AppError(
        'VALIDATION_FAILED',
        `A flash sale can run for at most ${rules.max_duration_hours} hours.`,
        `ফ্ল্যাশ সেল সর্বোচ্চ ${rules.max_duration_hours} ঘণ্টা চলতে পারে।`,
        { field: 'ends_at', reason: 'TOO_LONG', max_hours: rules.max_duration_hours }
      );
    }
  }
  if (liveDeals != null && liveDeals >= rules.max_live_deals) {
    throw new AppError(
      'VALIDATION_FAILED',
      `You already have ${liveDeals} live or scheduled flash sales; the limit is ${rules.max_live_deals}.`,
      `আপনার ইতিমধ্যে ${liveDeals}টি চালু বা নির্ধারিত ফ্ল্যাশ সেল আছে; সীমা ${rules.max_live_deals}টি।`,
      { reason: 'TOO_MANY_DEALS', max_live_deals: rules.max_live_deals }
    );
  }
}

const OWN_PRODUCT_SQL = `
  SELECT p.id, p.ref, p.title_en, p.title_bn, p.category_id, p.status, p.stock_qty,
         p.default_retail_price, p.base_cost, p.wholesale_margin, p.partner_profit, p.retail_price_since
    FROM products p
   WHERE p.id = $1 AND p.supplier_id = $2`;

async function loadOwnProduct(db, supplierId, productId) {
  const id = parseInt(productId, 10);
  if (!Number.isInteger(id)) {
    throw new AppError('VALIDATION_FAILED', 'Choose one of your products.', 'আপনার একটি পণ্য বেছে নিন।', { field: 'product_id' });
  }
  const { rows } = await db.query(OWN_PRODUCT_SQL, [id, supplierId]);
  // WHY NOT_FOUND for someone else's product too: it does not reveal which ids exist.
  if (!rows[0]) throw new AppError('NOT_FOUND', 'Product not found.', 'পণ্য পাওয়া যায়নি।');
  return rows[0];
}

async function countLiveDeals(db, supplierId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM flash_sales fs JOIN products p ON p.id = fs.product_id
      WHERE p.supplier_id = $1 AND fs.funded_by = 'SUPPLIER'
        AND fs.status IN ('ACTIVE', 'SCHEDULED') AND fs.ends_at > now()`,
    [supplierId]
  );
  return Number(rows[0]?.n || 0);
}

/** What one unit pays everyone at this flash price. Same function checkout uses. */
async function priceDeal(db, product, discountPrice) {
  const split = await resolveSplitPercentages(db, { productId: product.id, productRef: product.ref, categoryId: product.category_id });
  const b = calculateSupplierFundedBreakdown({
    baseCost: product.base_cost,
    wholesaleMargin: product.wholesale_margin,
    salerSplitPct: split.salerSplitPct,
    platformSplitPct: split.platformSplitPct,
    ruleSource: split.ruleSource,
    partnerProfit: product.partner_profit,
    regularRetailPrice: product.default_retail_price,
    dealPrice: discountPrice,
  });
  return {
    regular_price: b.default_retail_price,
    deal_price: b.retail_price,
    discount_pct: Math.round((b.supplier_funded / b.default_retail_price) * 100),
    supplier_funded: b.supplier_funded,
    supplier_payout: b.supplier_payout,
    regular_supplier_payout: b.regular_supplier_payout,
    partner_share: b.saler_earning,
    platform_share: b.platform_earning,
  };
}

function parseWindow(body) {
  const startsAt = body.starts_at ? new Date(body.starts_at) : new Date();
  const endsAt = body.ends_at ? new Date(body.ends_at) : null;
  if (Number.isNaN(startsAt.getTime()) || !endsAt || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw new AppError('VALIDATION_FAILED', 'Choose an end time after the start time.', 'শুরুর সময়ের পরে একটি শেষ সময় বেছে নিন।', { field: 'ends_at' });
  }
  return { startsAt, endsAt };
}

/** Preview for the supplier form: the payout at this price and whether the deal would be accepted. */
export async function quote(db, user, { product_id: productId, discount_price: discountPrice }) {
  const [rules, product] = await Promise.all([getRules(db), loadOwnProduct(db, user.id, productId)]);
  const pricing = await priceDeal(db, product, discountPrice);
  let problem = null;
  try {
    assertDealFitsRules({ rules, product, discountPrice, startsAt: null, endsAt: null, liveDeals: null });
  } catch (err) {
    problem = { code: err.code, message_en: err.message, message_bn: err.messageBn ?? err.message_bn ?? null, details: err.details ?? null };
  }
  return { pricing, problem };
}

/** A supplier starts a flash sale on their own product; live at once when it fits the rules. */
export async function createOwnDeal(db, user, body: Record<string, any> = {}, reqMeta = {}) {
  const [rules, product, liveDeals] = await Promise.all([
    getRules(db),
    loadOwnProduct(db, user.id, body.product_id),
    countLiveDeals(db, user.id),
  ]);
  if (product.status !== 'ACTIVE') {
    throw new AppError('VALIDATION_FAILED', 'Only a live product can have a flash sale.', 'শুধু চালু পণ্যে ফ্ল্যাশ সেল দেওয়া যায়।', { field: 'product_id' });
  }
  const { startsAt, endsAt } = parseWindow(body);
  assertDealFitsRules({ rules, product, discountPrice: body.discount_price, startsAt, endsAt, liveDeals });
  // Throws when the supplier would be paid nothing per unit; also gives the figures we return.
  const pricing = await priceDeal(db, product, body.discount_price);

  const deal = await createFlashSale(
    db,
    user,
    {
      product_id: product.id,
      discount_price: body.discount_price,
      allocated_qty: body.allocated_qty,
      per_user_limit: body.per_user_limit,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      title: body.title,
    },
    reqMeta,
    { fundedBy: 'SUPPLIER' }
  );
  return { flash_sale: deal, pricing };
}

/** The supplier stops their own live or scheduled deal. Sold units stay sold. */
export async function stopOwnDeal(db, user, flashSaleId, reqMeta: Record<string, any> = {}) {
  const id = parseInt(flashSaleId, 10);
  const { rows: found } = await db.query(
    `SELECT fs.* FROM flash_sales fs JOIN products p ON p.id = fs.product_id
      WHERE fs.id = $1 AND p.supplier_id = $2 AND fs.funded_by = 'SUPPLIER'`,
    [id, user.id]
  );
  const before = found[0];
  if (!before) throw new AppError('NOT_FOUND', 'Flash sale not found.', 'ফ্ল্যাশ সেল পাওয়া যায়নি।');
  if (!['ACTIVE', 'SCHEDULED'].includes(before.status)) {
    throw new AppError('CONFLICT', 'This flash sale has already ended.', 'এই ফ্ল্যাশ সেল ইতিমধ্যে শেষ হয়েছে।');
  }
  const { rows } = await db.query(
    `UPDATE flash_sales SET status = 'CANCELLED', updated_at = now()
      WHERE id = $1 AND status IN ('ACTIVE', 'SCHEDULED') RETURNING *`,
    [id]
  );
  const after = rows[0] ?? before;
  await writeAudit(db, {
    actorId: user.id,
    action: 'growth.flash_sale.stop_own',
    targetType: 'flash_sales',
    targetRef: id,
    before,
    after,
    ip: reqMeta.ip || null,
    userAgent: reqMeta.userAgent || null,
  });
  return after;
}

/**
 * What the supplier should read for a deal. WHY not the stored status: a deal is inserted SCHEDULED
 * and nothing flips it, so the stored value says neither "live now" nor "ended"; the window does.
 */
export function displayStatus(deal, now = Date.now()) {
  if (!['ACTIVE', 'SCHEDULED'].includes(deal.status)) return deal.status;
  if (new Date(deal.ends_at).getTime() <= now) return 'COMPLETED';
  return new Date(deal.starts_at).getTime() <= now ? 'ACTIVE' : 'SCHEDULED';
}

function pageArgs(query: Record<string, any> = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

/** The supplier's page: the rules, their products (with when each may be discounted) and their deals. */
export async function getOverview(db, user, query: Record<string, any> = {}) {
  const { limit, offset } = pageArgs(query);
  const rules = await getRules(db);
  const [products, productCount, deals] = await Promise.all([
    db.query(
      `SELECT p.id, p.ref, p.title_en, p.title_bn, p.stock_qty, p.default_retail_price, p.retail_price_since,
              (SELECT fs.id FROM flash_sales fs
                WHERE fs.product_id = p.id AND fs.status IN ('ACTIVE', 'SCHEDULED') AND fs.ends_at > now()
                ORDER BY fs.starts_at LIMIT 1) AS live_flash_sale_id
         FROM products p
        WHERE p.supplier_id = $1 AND p.status = 'ACTIVE'
        ORDER BY p.title_en
        LIMIT $2 OFFSET $3`,
      [user.id, limit, offset]
    ),
    db.query(`SELECT COUNT(*)::int AS n FROM products WHERE supplier_id = $1 AND status = 'ACTIVE'`, [user.id]),
    db.query(
      `SELECT fs.id, fs.ref, fs.product_id, p.title_en AS product_title_en, p.title_bn AS product_title_bn,
              fs.discount_price, fs.original_price, fs.allocated_qty, fs.sold_qty, fs.per_user_limit,
              fs.starts_at, fs.ends_at, fs.status, fs.created_at
         FROM flash_sales fs JOIN products p ON p.id = fs.product_id
        WHERE p.supplier_id = $1 AND fs.funded_by = 'SUPPLIER'
        ORDER BY fs.created_at DESC
        LIMIT 50`,
      [user.id]
    ),
  ]);
  const now = Date.now();
  return {
    rules,
    products: products.rows.map((p) => {
      const from = eligibleFrom(p.retail_price_since, rules.min_listing_days);
      return { ...p, eligible_from: from.toISOString(), eligible: from.getTime() <= now && p.live_flash_sale_id == null };
    }),
    deals: deals.rows.map((d) => ({ ...d, status: displayStatus(d, now) })),
    meta: { limit, offset, total: Number(productCount.rows[0]?.n || 0) },
  };
}
