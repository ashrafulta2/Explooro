/**
 * adProducts.service.js — the ad marketplace catalogue and its governance.
 *
 * Two audiences, one catalogue:
 *   - Sellers see the formats they are allowed to buy, each with a price label and the commercial
 *     floors their wizard must respect (GET /ads/products).
 *   - Holders of `growth.ad.govern` see every format including disabled ones, with revenue per
 *     format, and may rewrite any rate card (GET/PATCH /admin/ads/products).
 *
 * Every price shown anywhere comes from services/adPricing.js. This file decides *who may buy
 * what* and *what inventory is left*; it never multiplies a rate by a quantity itself.
 */

import { AppError } from '../plugins/errorHandler.js';
import { writeAudit } from '../lib/audit.js';
import * as adProductRepo from '../repositories/adProduct.repository.js';
import {
  quote as priceQuote,
  priceLabel,
  validateRateCard,
  rate,
  PREPAID_MODELS,
} from './adPricing.js';

/** Formats that rent a physical position and therefore consume day-level inventory. */
const SLOT_BACKED_MODELS = ['FLAT_DAILY', 'FLAT_SLOT'];

/**
 * The trust tier that decides a seller's loyalty discount. Falls back to STARTER for a seller who
 * has no trust row yet (a brand-new account), which is the no-discount case.
 */
export async function getSellerTier(db, userId) {
  const { rows } = await db.query(`SELECT tier FROM trust_scores WHERE user_id = $1`, [userId]);
  return rows[0]?.tier || 'STARTER';
}

/**
 * The slot inventory key a booking of this product occupies. Category banners are per-category
 * (two sellers can each own a banner, as long as it is a different category); every other
 * slot-backed format has a single global queue.
 */
export function resolveSlotKey(product, { categoryId = null } = {}) {
  if (product.placement === 'CATEGORY_BANNER') {
    if (!categoryId) throw new AppError('CATEGORY_REQUIRED', 'Choose a category for this banner.');
    return `CATEGORY:${Number(categoryId)}`;
  }
  return product.placement;
}

/** Inclusive list of ISO dates between two dates. */
export function expandDates(startDate, days) {
  const out = [];
  const cursor = new Date(startDate);
  cursor.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < days; i += 1) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * Shapes one ad_products row for a client. Strips nothing secret — rate cards are public prices —
 * but adds the display label and the floors the wizard needs so it can validate before submitting.
 */
function presentProduct(product) {
  const label = priceLabel(product);
  return {
    id: product.id,
    key: product.key,
    name_en: product.name_en,
    name_bn: product.name_bn,
    tagline_en: product.tagline_en,
    tagline_bn: product.tagline_bn,
    description_en: product.description_en,
    description_bn: product.description_bn,
    icon: product.icon,
    placement: product.placement,
    pricing_model: product.pricing_model,
    billing_mode: PREPAID_MODELS.includes(product.pricing_model) ? 'PREPAID' : 'METERED',
    badge_key: product.badge_key,
    requires_product: product.requires_product,
    requires_review: product.requires_review,
    is_enabled: product.is_enabled,
    sort_order: product.sort_order,
    price_label_en: label.en,
    price_label_bn: label.bn,
    rate_card: product.rate_card,
    limits: {
      min_days: rate(product.rate_card, 'min_days'),
      max_days: rate(product.rate_card, 'max_days'),
      min_quantity: rate(product.rate_card, 'min_quantity'),
      max_quantity: rate(product.rate_card, 'max_quantity'),
      min_budget: rate(product.rate_card, 'min_budget'),
      floor_cpc: rate(product.rate_card, 'floor_cpc'),
      suggested_cpc: rate(product.rate_card, 'suggested_cpc'),
      slots_per_period: rate(product.rate_card, 'slots_per_period'),
    },
  };
}

/**
 * The seller-facing catalogue: only enabled formats, only those their role may buy.
 */
export async function listForSeller(db, userId, { role = null } = {}) {
  const products = await adProductRepo.listProducts(db, { onlyEnabled: true, role });
  const tier = await getSellerTier(db, userId);

  return {
    tier,
    products: products.map((p) => ({
      ...presentProduct(p),
      your_discount_percent: Number(p.rate_card?.tier_discounts?.[tier] ?? 0),
    })),
  };
}

/**
 * The admin catalogue: every format, with what each earned the platform recently.
 */
export async function listForAdmin(db, { days = 30 } = {}) {
  const [products, revenue] = await Promise.all([
    adProductRepo.listProducts(db, {}),
    adProductRepo.getRevenueByProduct(db, { days }),
  ]);

  const byId = new Map(revenue.map((r) => [Number(r.id), r]));

  return {
    window_days: days,
    products: products.map((p) => {
      const stats = byId.get(Number(p.id)) || {};
      return {
        ...presentProduct(p),
        allowed_roles: p.allowed_roles,
        updated_at: p.updated_at,
        stats: {
          campaigns: Number(stats.campaigns || 0),
          revenue: Number(stats.revenue || 0).toFixed(2),
          impressions: Number(stats.impressions || 0),
          clicks: Number(stats.clicks || 0),
        },
      };
    }),
  };
}

/**
 * Rewrites one ad format's commercial terms. HIGH-risk per the permission catalogue, so the
 * before/after pair is written to audit_logs exactly as CLAUDE.md constraint 11 requires — a price
 * change is the kind of thing a seller will later dispute.
 */
export async function updateProductPricing(db, adminId, productId, patch = {}, reqMeta = {}) {
  const existing = await adProductRepo.getProductById(db, productId);
  if (!existing) {
    throw new AppError('AD_PRODUCT_NOT_FOUND', 'This ad format does not exist.');
  }

  const fields = { updated_by: adminId };

  if (patch.rate_card) {
    // Merge onto the stored card so a partial edit cannot silently blank the fields it omits.
    fields.rate_card = validateRateCard(existing.pricing_model, {
      ...existing.rate_card,
      ...patch.rate_card,
      tier_discounts: { ...(existing.rate_card?.tier_discounts || {}), ...(patch.rate_card.tier_discounts || {}) },
    });
  }
  if (patch.is_enabled != null) fields.is_enabled = Boolean(patch.is_enabled);
  if (patch.requires_review != null) fields.requires_review = Boolean(patch.requires_review);
  if (patch.badge_key !== undefined) fields.badge_key = patch.badge_key || '__CLEAR__';
  if (patch.sort_order != null) fields.sort_order = Number(patch.sort_order);
  if (Array.isArray(patch.allowed_roles) && patch.allowed_roles.length) fields.allowed_roles = patch.allowed_roles;
  for (const key of ['name_en', 'name_bn', 'tagline_en', 'tagline_bn']) {
    if (patch[key]) fields[key] = String(patch[key]).trim();
  }

  const updated = await adProductRepo.updateProduct(db, productId, fields);

  await writeAudit(db, {
    userId: adminId,
    action: 'growth.ad_product.update_pricing',
    resourceType: 'ad_products',
    resourceId: productId,
    before: { rate_card: existing.rate_card, is_enabled: existing.is_enabled, badge_key: existing.badge_key },
    after: { rate_card: updated.rate_card, is_enabled: updated.is_enabled, badge_key: updated.badge_key },
    ipAddress: reqMeta.ip || null,
    userAgent: reqMeta.userAgent || null,
  });

  return presentProduct(updated);
}

/**
 * Prices a would-be campaign without creating it. The seller's wizard calls this on every change,
 * so the number on the confirm button is the same number the purchase will charge.
 */
export async function quoteCampaign(db, userId, input = {}) {
  const product = await adProductRepo.getProductByKey(db, input.ad_product_key);
  if (!product) {
    throw new AppError('AD_PRODUCT_NOT_FOUND', 'Unknown ad format.');
  }
  if (!product.is_enabled) {
    throw new AppError('AD_PRODUCT_DISABLED', 'This ad format is not on sale right now.');
  }

  const tier = await getSellerTier(db, userId);
  const result = priceQuote(product, input, { tier });

  // For slot-backed formats the price is only half the answer — the seller also needs to know
  // whether the days they picked are still free.
  if (SLOT_BACKED_MODELS.includes(product.pricing_model)) {
    result.availability = await checkAvailability(db, product, input);
  }

  return result;
}

/**
 * How many reserved positions are left across the requested run, and whether the booking fits.
 */
export async function checkAvailability(db, product, input = {}) {
  const slotsPerPeriod = rate(product.rate_card, 'slots_per_period');
  const days = product.pricing_model === 'FLAT_DAILY'
    ? Math.max(1, Number(input.duration_days) || rate(product.rate_card, 'min_days'))
    : Math.max(1, Number(input.quantity) || 1);

  let slotKey;
  try {
    slotKey = resolveSlotKey(product, { categoryId: input.category_id });
  } catch {
    // No category chosen yet — the wizard is mid-edit, so report the format's headline capacity.
    return { slot_key: null, slots_per_period: slotsPerPeriod, available: true, busiest_day_taken: 0 };
  }

  const start = input.start_date ? new Date(input.start_date) : new Date();
  const dates = expandDates(start, days);
  const usage = await adProductRepo.getSlotUsage(db, slotKey, dates[0], dates[dates.length - 1]);

  const busiest = usage.reduce((max, r) => Math.max(max, Number(r.taken)), 0);

  return {
    slot_key: slotKey,
    slots_per_period: slotsPerPeriod,
    busiest_day_taken: busiest,
    slots_left: Math.max(0, slotsPerPeriod - busiest),
    available: busiest < slotsPerPeriod,
    from: dates[0],
    to: dates[dates.length - 1],
  };
}

/**
 * A calendar of remaining capacity, so the wizard can grey out full days instead of failing the
 * purchase after the seller has filled in everything.
 */
export async function getAvailabilityCalendar(db, productKey, { categoryId = null, days = 30 } = {}) {
  const product = await adProductRepo.getProductByKey(db, productKey);
  if (!product) throw new AppError('AD_PRODUCT_NOT_FOUND', 'Unknown ad format.');
  if (!SLOT_BACKED_MODELS.includes(product.pricing_model)) {
    return { slot_key: null, days: [] };
  }

  const slotKey = resolveSlotKey(product, { categoryId });
  const slotsPerPeriod = rate(product.rate_card, 'slots_per_period');
  const dates = expandDates(new Date(), days);
  const usage = await adProductRepo.getSlotUsage(db, slotKey, dates[0], dates[dates.length - 1]);
  const takenByDate = new Map(usage.map((r) => [new Date(r.booking_date).toISOString().slice(0, 10), Number(r.taken)]));

  return {
    slot_key: slotKey,
    slots_per_period: slotsPerPeriod,
    days: dates.map((d) => ({
      date: d,
      taken: takenByDate.get(d) || 0,
      left: Math.max(0, slotsPerPeriod - (takenByDate.get(d) || 0)),
    })),
  };
}

export { adProductRepo, SLOT_BACKED_MODELS };
