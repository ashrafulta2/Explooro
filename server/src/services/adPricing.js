/**
 * adPricing.js — THE single source of ad pricing arithmetic.
 *
 * WHY one file: CLAUDE.md constraint 10 requires money arithmetic to live in exactly one place.
 * Every ad price the platform ever quotes, charges, or displays is computed here — the seller's
 * wizard preview, the binding quote frozen onto a campaign at purchase, the metered CPC/CPM
 * charge per event, and the "from ৳450/day" label on an ad product card. Nothing else multiplies
 * a rate by a quantity.
 *
 * WHY paisa integers: NUMERIC(14,2) in Postgres, but JS floats drift (0.1 + 0.2). Every
 * intermediate here is an integer number of paisa; only the final formatting divides by 100.
 *
 * Pricing models supported:
 *   CPC        — pay per valid click, metered against a budget cap.
 *   CPM        — pay per 1000 viewable impressions, metered against a budget cap.
 *   FLAT_DAILY — a reserved placement slot rented per day. Prepaid in full at purchase.
 *   FLAT_SLOT  — a one-off placement (a live stream, a flash-sale slot). Prepaid at purchase.
 *   CPS        — cost per delivered send (push blast). Prepaid at purchase.
 *   CPA        — a percentage of an attributed sale. Supported by the engine; not seeded as a
 *                live ad product until order attribution is wired (see docs/ad-marketplace.md).
 *
 * Rate cards are admin data, never constants: `ad_products.rate_card` JSONB, edited from
 * /admin/growth/ad-pricing by anyone holding `growth.ad.govern`.
 */

import { AppError } from '../plugins/errorHandler.js';

export const PRICING_MODELS = ['CPC', 'CPM', 'FLAT_DAILY', 'FLAT_SLOT', 'CPS', 'CPA'];

/** Models that take the seller's money up front vs. models that meter it as events happen. */
export const PREPAID_MODELS = ['FLAT_DAILY', 'FLAT_SLOT', 'CPS'];
export const METERED_MODELS = ['CPC', 'CPM', 'CPA'];

/**
 * Every numeric knob an admin may set on a rate card, with the fallback used when the stored
 * card omits it. A rate card is validated against this map on write, so an admin can never save
 * a card that the quote engine would then choke on.
 */
export const RATE_CARD_FIELDS = {
  // CPC
  floor_cpc: { min: 0.25, max: 500, default: 1.0, models: ['CPC'] },
  suggested_cpc: { min: 0.25, max: 500, default: 2.5, models: ['CPC'] },
  // CPM
  cpm_rate: { min: 5, max: 5000, default: 80, models: ['CPM'] },
  // Flat rentals
  daily_rate: { min: 10, max: 100000, default: 450, models: ['FLAT_DAILY'] },
  slot_rate: { min: 10, max: 500000, default: 1500, models: ['FLAT_SLOT'] },
  // Cost per send
  cps_rate: { min: 0.05, max: 50, default: 0.35, models: ['CPS'] },
  // Cost per acquisition
  cpa_percent: { min: 0.5, max: 30, default: 4.0, models: ['CPA'] },
  // Shared commercial knobs — apply to every model
  min_budget: { min: 0, max: 1000000, default: 0, models: '*' },
  min_days: { min: 1, max: 365, default: 1, models: '*' },
  max_days: { min: 1, max: 365, default: 30, models: '*' },
  min_quantity: { min: 1, max: 1000000, default: 1, models: '*' },
  max_quantity: { min: 1, max: 1000000, default: 1000, models: '*' },
  slots_per_period: { min: 1, max: 50, default: 4, models: ['FLAT_DAILY', 'FLAT_SLOT'] },
  service_fee_percent: { min: 0, max: 30, default: 0, models: '*' },
  vat_percent: { min: 0, max: 30, default: 0, models: '*' },
};

/** Trust-tier loyalty discounts, in percent off the subtotal. Admin-editable per product. */
export const DEFAULT_TIER_DISCOUNTS = { STARTER: 0, VERIFIED_TRADER: 5, ELITE_PARTNER: 10 };

const toPaisa = (amount) => Math.round(Number(amount || 0) * 100);
const fromPaisa = (paisa) => (paisa / 100).toFixed(2);
const pctOf = (paisa, percent) => Math.round((paisa * Number(percent || 0)) / 100);

/**
 * Reads a rate-card value, falling back to the field default. Never returns NaN.
 */
export function rate(rateCard, field) {
  const spec = RATE_CARD_FIELDS[field];
  const raw = rateCard?.[field];
  const num = Number(raw);
  if (raw == null || Number.isNaN(num)) return spec ? spec.default : 0;
  return num;
}

/**
 * Validates an admin-submitted rate card for a pricing model. Returns the sanitised card.
 * Throws AppError on any out-of-range or non-numeric value, so a bad price can never be saved.
 */
export function validateRateCard(pricingModel, rateCard = {}) {
  if (!PRICING_MODELS.includes(pricingModel)) {
    throw new AppError('INVALID_PRICING_MODEL', `Unknown pricing model "${pricingModel}".`);
  }

  const clean = {};
  for (const [field, spec] of Object.entries(RATE_CARD_FIELDS)) {
    const appliesToModel = spec.models === '*' || spec.models.includes(pricingModel);
    if (!appliesToModel) continue;
    if (rateCard[field] == null || rateCard[field] === '') {
      clean[field] = spec.default;
      continue;
    }
    const num = Number(rateCard[field]);
    if (Number.isNaN(num)) {
      throw new AppError('INVALID_RATE', `Rate "${field}" must be a number.`);
    }
    if (num < spec.min || num > spec.max) {
      throw new AppError(
        'RATE_OUT_OF_RANGE',
        `Rate "${field}" must be between ${spec.min} and ${spec.max}.`
      );
    }
    clean[field] = Number(num.toFixed(2));
  }

  if (clean.max_days != null && clean.min_days != null && clean.max_days < clean.min_days) {
    throw new AppError('INVALID_RATE', 'Maximum days cannot be smaller than minimum days.');
  }
  if (clean.max_quantity != null && clean.min_quantity != null && clean.max_quantity < clean.min_quantity) {
    throw new AppError('INVALID_RATE', 'Maximum quantity cannot be smaller than minimum quantity.');
  }
  if (pricingModel === 'CPC' && clean.suggested_cpc < clean.floor_cpc) {
    throw new AppError('INVALID_RATE', 'Suggested bid cannot be below the floor bid.');
  }

  // Tier discounts ride along on the same card but are keyed by tier, not by field name.
  const discounts = rateCard.tier_discounts || DEFAULT_TIER_DISCOUNTS;
  clean.tier_discounts = {};
  for (const tier of Object.keys(DEFAULT_TIER_DISCOUNTS)) {
    const num = Number(discounts[tier] ?? DEFAULT_TIER_DISCOUNTS[tier]);
    if (Number.isNaN(num) || num < 0 || num > 50) {
      throw new AppError('RATE_OUT_OF_RANGE', `Tier discount for ${tier} must be between 0 and 50%.`);
    }
    clean.tier_discounts[tier] = Number(num.toFixed(2));
  }

  return clean;
}

/**
 * Builds the priced line items for a pricing model. Returns paisa amounts.
 * This is the only place a rate is ever multiplied by a quantity.
 */
function buildLines(pricingModel, rateCard, input) {
  const days = Math.max(1, Math.round(Number(input.duration_days) || rate(rateCard, 'min_days')));
  const quantity = Math.max(1, Math.round(Number(input.quantity) || rate(rateCard, 'min_quantity')));
  const budget = toPaisa(input.total_budget);

  switch (pricingModel) {
    case 'CPC': {
      const bid = toPaisa(input.bid_amount || rate(rateCard, 'suggested_cpc'));
      return {
        lines: [
          {
            key: 'budget_cap',
            label_en: 'Campaign budget (charged per click)',
            label_bn: 'ক্যাম্পেইন বাজেট (প্রতি ক্লিকে কাটা হবে)',
            qty: 1,
            unit: 'BUDGET',
            unit_paisa: budget,
            amount_paisa: budget,
          },
        ],
        subtotal_paisa: budget,
        estimate: { clicks: bid > 0 ? Math.floor(budget / bid) : 0 },
      };
    }

    case 'CPM': {
      const cpm = toPaisa(rate(rateCard, 'cpm_rate'));
      return {
        lines: [
          {
            key: 'budget_cap',
            label_en: 'Campaign budget (charged per 1,000 views)',
            label_bn: 'ক্যাম্পেইন বাজেট (প্রতি ১,০০০ ভিউতে কাটা হবে)',
            qty: 1,
            unit: 'BUDGET',
            unit_paisa: budget,
            amount_paisa: budget,
          },
        ],
        subtotal_paisa: budget,
        estimate: { impressions: cpm > 0 ? Math.floor((budget / cpm) * 1000) : 0 },
      };
    }

    case 'FLAT_DAILY': {
      const daily = toPaisa(rate(rateCard, 'daily_rate'));
      const amount = daily * days;
      return {
        lines: [
          {
            key: 'slot_rent',
            label_en: 'Reserved placement',
            label_bn: 'সংরক্ষিত প্লেসমেন্ট',
            qty: days,
            unit: 'DAY',
            unit_paisa: daily,
            amount_paisa: amount,
          },
        ],
        subtotal_paisa: amount,
        estimate: { days },
      };
    }

    case 'FLAT_SLOT': {
      const slot = toPaisa(rate(rateCard, 'slot_rate'));
      const amount = slot * quantity;
      return {
        lines: [
          {
            key: 'slot_fee',
            label_en: 'Placement slot',
            label_bn: 'প্লেসমেন্ট স্লট',
            qty: quantity,
            unit: 'SLOT',
            unit_paisa: slot,
            amount_paisa: amount,
          },
        ],
        subtotal_paisa: amount,
        estimate: { slots: quantity },
      };
    }

    case 'CPS': {
      const perSend = toPaisa(rate(rateCard, 'cps_rate'));
      const amount = perSend * quantity;
      return {
        lines: [
          {
            key: 'sends',
            label_en: 'Notification recipients',
            label_bn: 'নোটিফিকেশন প্রাপক',
            qty: quantity,
            unit: 'RECIPIENT',
            unit_paisa: perSend,
            amount_paisa: amount,
          },
        ],
        subtotal_paisa: amount,
        estimate: { reach: quantity },
      };
    }

    case 'CPA': {
      // Nothing is owed until a sale is attributed, so the quote prices the commission rate
      // itself and carries a zero subtotal.
      return {
        lines: [
          {
            key: 'commission',
            label_en: 'Commission per attributed sale',
            label_bn: 'প্রতিটি বিক্রয়ে কমিশন',
            qty: 1,
            unit: 'PERCENT',
            unit_paisa: toPaisa(rate(rateCard, 'cpa_percent')),
            amount_paisa: 0,
          },
        ],
        subtotal_paisa: 0,
        estimate: {},
      };
    }

    default:
      throw new AppError('INVALID_PRICING_MODEL', `Unknown pricing model "${pricingModel}".`);
  }
}

/**
 * Validates buyer input against the rate card's commercial floors, then prices it.
 *
 * @param {Object} product   - ad_products row: { key, pricing_model, rate_card, ... }
 * @param {Object} input     - { total_budget, daily_budget, bid_amount, duration_days, quantity }
 * @param {Object} [options] - { tier: 'STARTER'|'VERIFIED_TRADER'|'ELITE_PARTNER' }
 * @returns {Object} a complete, display-ready quote in BDT strings.
 */
export function quote(product, input = {}, options = {}) {
  const pricingModel = product?.pricing_model;
  const rateCard = product?.rate_card || {};

  if (!PRICING_MODELS.includes(pricingModel)) {
    throw new AppError('INVALID_PRICING_MODEL', 'This ad format has no valid pricing model.');
  }

  // 1. Commercial floors the admin set on the rate card.
  const minDays = rate(rateCard, 'min_days');
  const maxDays = rate(rateCard, 'max_days');
  const minQty = rate(rateCard, 'min_quantity');
  const maxQty = rate(rateCard, 'max_quantity');
  const minBudget = rate(rateCard, 'min_budget');

  if (pricingModel === 'FLAT_DAILY') {
    const days = Number(input.duration_days) || minDays;
    if (days < minDays) {
      throw new AppError('DURATION_TOO_SHORT', `This placement is sold for at least ${minDays} day(s).`);
    }
    if (days > maxDays) {
      throw new AppError('DURATION_TOO_LONG', `This placement can be booked for at most ${maxDays} day(s).`);
    }
  }

  if (pricingModel === 'FLAT_SLOT' || pricingModel === 'CPS') {
    const qty = Number(input.quantity) || minQty;
    if (qty < minQty) {
      throw new AppError('QUANTITY_TOO_LOW', `Minimum order for this format is ${minQty}.`);
    }
    if (qty > maxQty) {
      throw new AppError('QUANTITY_TOO_HIGH', `Maximum order for this format is ${maxQty}.`);
    }
  }

  if (METERED_MODELS.includes(pricingModel) && pricingModel !== 'CPA') {
    const budget = Number(input.total_budget) || 0;
    if (budget < minBudget) {
      throw new AppError('BUDGET_TOO_LOW', `Minimum budget for this format is ৳${minBudget.toFixed(2)}.`);
    }
    const daily = Number(input.daily_budget) || 0;
    if (daily > 0 && budget < daily) {
      throw new AppError('INVALID_BUDGET', 'Total budget cannot be less than the daily budget.');
    }
  }

  if (pricingModel === 'CPC') {
    const bid = Number(input.bid_amount) || 0;
    const floor = rate(rateCard, 'floor_cpc');
    if (bid < floor) {
      throw new AppError('BID_BELOW_FLOOR', `Bid must be at least ৳${floor.toFixed(2)} for this placement.`);
    }
  }

  // 2. Price it.
  const { lines, subtotal_paisa, estimate } = buildLines(pricingModel, rateCard, input);

  // 3. Tier discount, service fee, VAT — in that order, each on the running total.
  const tier = options.tier || 'STARTER';
  const discounts = rateCard.tier_discounts || DEFAULT_TIER_DISCOUNTS;
  const discountPercent = Number(discounts[tier] ?? 0);
  const discountPaisa = pctOf(subtotal_paisa, discountPercent);
  const afterDiscount = subtotal_paisa - discountPaisa;

  const serviceFeePercent = rate(rateCard, 'service_fee_percent');
  const serviceFeePaisa = pctOf(afterDiscount, serviceFeePercent);

  const vatPercent = rate(rateCard, 'vat_percent');
  const vatPaisa = pctOf(afterDiscount + serviceFeePaisa, vatPercent);

  const totalPaisa = afterDiscount + serviceFeePaisa + vatPaisa;
  const billingMode = PREPAID_MODELS.includes(pricingModel) ? 'PREPAID' : 'METERED';

  return {
    ad_product_key: product.key,
    pricing_model: pricingModel,
    billing_mode: billingMode,
    currency: 'BDT',
    lines: lines.map((l) => ({
      key: l.key,
      label_en: l.label_en,
      label_bn: l.label_bn,
      qty: l.qty,
      unit: l.unit,
      unit_amount: fromPaisa(l.unit_paisa),
      amount: fromPaisa(l.amount_paisa),
    })),
    subtotal: fromPaisa(subtotal_paisa),
    tier,
    discount_percent: discountPercent.toFixed(2),
    discount_amount: fromPaisa(discountPaisa),
    service_fee_percent: serviceFeePercent.toFixed(2),
    service_fee: fromPaisa(serviceFeePaisa),
    vat_percent: vatPercent.toFixed(2),
    vat: fromPaisa(vatPaisa),
    total: fromPaisa(totalPaisa),
    // What the vault is debited the moment the campaign is bought…
    charge_now: billingMode === 'PREPAID' ? fromPaisa(totalPaisa) : '0.00',
    // …versus the cap that metered clicks/impressions may spend over the campaign's life.
    budget_cap: billingMode === 'METERED' ? fromPaisa(totalPaisa) : '0.00',
    estimate,
  };
}

/**
 * The short price label a seller sees on an ad format card, before opening the wizard.
 * Lives here so the card and the quote can never disagree about what a format costs.
 */
export function priceLabel(product) {
  const rc = product?.rate_card || {};
  switch (product?.pricing_model) {
    case 'CPC':
      return {
        en: `From ৳${rate(rc, 'floor_cpc').toFixed(2)} per click`,
        bn: `প্রতি ক্লিক ৳${rate(rc, 'floor_cpc').toFixed(2)} থেকে`,
      };
    case 'CPM':
      return {
        en: `৳${rate(rc, 'cpm_rate').toFixed(0)} per 1,000 views`,
        bn: `প্রতি ১,০০০ ভিউ ৳${rate(rc, 'cpm_rate').toFixed(0)}`,
      };
    case 'FLAT_DAILY':
      return {
        en: `৳${rate(rc, 'daily_rate').toFixed(0)} per day`,
        bn: `প্রতিদিন ৳${rate(rc, 'daily_rate').toFixed(0)}`,
      };
    case 'FLAT_SLOT':
      return {
        en: `৳${rate(rc, 'slot_rate').toFixed(0)} per slot`,
        bn: `প্রতি স্লট ৳${rate(rc, 'slot_rate').toFixed(0)}`,
      };
    case 'CPS':
      return {
        en: `৳${rate(rc, 'cps_rate').toFixed(2)} per recipient`,
        bn: `প্রতি প্রাপক ৳${rate(rc, 'cps_rate').toFixed(2)}`,
      };
    case 'CPA':
      return {
        en: `${rate(rc, 'cpa_percent').toFixed(1)}% of each sale`,
        bn: `প্রতিটি বিক্রয়ের ${rate(rc, 'cpa_percent').toFixed(1)}%`,
      };
    default:
      return { en: '', bn: '' };
  }
}

/**
 * The charge for one metered billing event, bounded by what is left of the campaign budget.
 * Used by both the CPC click path and the CPM impression path in ads.service.js.
 *
 * @param {string} pricingModel  - 'CPC' or 'CPM'
 * @param {Object} args          - { bidAmount, cpmRate, impressionsInBatch, availableBudget }
 * @returns {string} the amount to charge, as a NUMERIC(14,2)-safe string.
 */
export function meteredCharge(pricingModel, { bidAmount = 0, cpmRate = 0, impressions = 1, availableBudget = 0 }) {
  const availablePaisa = toPaisa(availableBudget);
  if (availablePaisa <= 0) return '0.00';

  let wantPaisa;
  if (pricingModel === 'CPM') {
    // One impression costs cpm_rate / 1000. Rounded up to the paisa so a sub-paisa impression
    // still bills something — otherwise a 1000-view campaign could run free forever.
    wantPaisa = Math.max(1, Math.ceil((toPaisa(cpmRate) * impressions) / 1000));
  } else {
    wantPaisa = toPaisa(bidAmount);
  }

  return fromPaisa(Math.min(wantPaisa, availablePaisa));
}
