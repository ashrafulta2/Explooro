/**
 * pricing.service.ts — Dynamic pricing engine & profit split calculator (Prompt 4.3).
 *
 * Rules:
 *   retail_price = base_cost + wholesale_margin + net_retail_margin
 *   saler_earning    = net_retail_margin × saler_split_pct
 *   platform_earning = net_retail_margin × platform_split_pct
 *
 * Resolution hierarchy:
 *   1. Product-specific commission override in commission_rules (scope_type = 'PRODUCT')
 *   2. Category-specific commission rule in commission_rules (scope_type = 'CATEGORY')
 *   3. Global platform_settings key ('commission.default_splits') — the ONE global default
 *   4. Hard fallback (40% saler / 60% platform)
 *   Then, for steps 2-4 only and only when a salerId is given: the Shop Partner Pro rebate
 *   (subscriptionRebate.ts) moves its points from platform to shop partner. Module OFF => no change.
 *
 * WHY there is no GLOBAL commission_rules step: a seeded GLOBAL row used to sit above the setting,
 * so editing the default at /admin/finance/splits (which writes the setting) changed nothing in
 * pricing. The global default has exactly one home; commission_rules holds only the overrides.
 *
 * Precision & Rounding Invariant:
 *   All arithmetic is strictly performed in integer paisa (1 BDT = 100 paisa) to eliminate
 *   floating-point drift. Rounding remainders (fractional paisa) always go to the platform.
 */

import { AppError } from '../plugins/errorHandler.ts';
import { applyRebate, resolveProRebatePct } from './subscriptionRebate.ts';
import { TIER_KEYS, parseTierBonuses, resolveSalerTierBonusPct } from './salerTierBonus.ts';

/**
 * Converts a decimal BDT amount into integer paisa.
 * @param {number|string} amount
 * @returns {number} Integer paisa
 */
export function toPaisa(amount: number|string): number {
  if (amount === undefined || amount === null || amount === '') return 0;
  const num = typeof amount === 'number' ? amount : parseFloat(amount);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

/**
 * Converts integer paisa to formatted decimal BDT string with 2 decimal places.
 * @param {number} paisa
 * @returns {string} e.g. "120.00"
 */
export function toBdtString(paisa: number): string {
  return (paisa / 100).toFixed(2);
}

/**
 * Converts integer paisa to numeric decimal BDT.
 * @param {number} paisa
 * @returns {number} e.g. 120.00
 */
export function toBdtNumber(paisa: number): number {
  return parseFloat((paisa / 100).toFixed(2));
}

/**
 * The share of the margin each side actually gets, as a percentage (2 decimals).
 * WHY this is not saler_split_pct: since migration 085 a supplier's per-unit partner_profit decides
 * the pool's side, so the configured split can say 40/60 while the money goes 67/33. Anything that
 * prints a percentage next to the earnings must print these, or the two disagree on screen.
 */
function marginSharePcts(poolPaisa: number, marginPaisa: number): { pool_share_pct: number; platform_share_pct: number } {
  if (marginPaisa <= 0) return { pool_share_pct: 0, platform_share_pct: 0 };
  const pool = parseFloat(((poolPaisa / marginPaisa) * 100).toFixed(2));
  return { pool_share_pct: pool, platform_share_pct: parseFloat((100 - pool).toFixed(2)) };
}

/**
 * Resolves the active commission split percentages for a product/category context.
 *
 * @param {object} db Database client
 * @param {object} context { productId, productRef, categoryId }
 * @returns {Promise<{ salerSplitPct: number, platformSplitPct: number, ruleSource: string }>}
 */
/**
 * @param {*} db
 * @param {{ productId?: *, productRef?: *, categoryId?: *, salerId?: *, cache?: *, preloaded?: * }} [params]
 */
export async function resolveSplitPercentages(db: any, { productId, productRef, categoryId, salerId, cache, preloaded }: { productId?: any; productRef?: any; categoryId?: any; salerId?: any; cache?: any; preloaded?: any; } = {}) {
  const base = await resolveBaseSplit(db, { productId, productRef, categoryId }, preloaded);
  // WHY not on PRODUCT_OVERRIDE: a per-product rule is an explicit, deliberate number set by an admin;
  // layering a plan rebate on top would silently change what they typed.
  if (!salerId || base.ruleSource === 'PRODUCT_OVERRIDE') return base;
  // WHY no try/catch: a failed lookup must surface, not quietly pay the shop partner the wrong split.
  const withPro = applyRebate(base, await resolveProRebatePct(db, { salerId, cache }));
  // WHY after the plan rebate and through the same capped move: the two stack, but together they can
  // never take more than the platform's own share, so the split still sums to 100.
  return applyRebate(withPro, await resolveSalerTierBonusPct(db, { salerId }), 'TIER_BONUS');
}

/**
 * Loads the commission rules for a whole list of products in three queries (product overrides,
 * category rules, the global default), so pricing a page of N products no longer costs about 3N.
 *
 * WHY this exists and does not change the hierarchy: resolveBaseSplit below is still the ONE place the
 * 1 → 2 → 3 → 4 order is decided; it only reads from these maps instead of the database when it is
 * given them. A key that was not part of the load falls back to its own query, so passing the wrong
 * products costs speed, never correctness. A failed batch is left empty, which — exactly like a failed
 * single lookup — falls through to the next level.
 *
 * @param {object} db
 * @param {{id?: any, category_id?: any}[]} products
 * @returns {Promise<{productRules: Map<string, object>, productKeys: Set<string>, categoryRules: Map<string, object>, categoryKeys: Set<string>, global: {value_json: any}|null}>}
 */
export async function loadSplitRules(db: any, products: { id?: any; category_id?: any; }[]): Promise<{ productRules: Map<string,any>; productKeys: Set<string>; categoryRules: Map<string,any>; categoryKeys: Set<string>; global: { value_json: any; }|null; hasGlobal?: boolean; }> {
  const productKeys = new Set();
  const categoryKeys = new Set();
  for (const p of products || []) {
    if (p?.id) productKeys.add(String(p.id));
    if (p?.category_id) categoryKeys.add(String(p.category_id));
  }
  const loaded: Awaited<ReturnType<typeof loadSplitRules>> = { productRules: new Map(), productKeys: new Set(), categoryRules: new Map(), categoryKeys: new Set(), global: null };
  if (!db) return loaded;

  // DISTINCT ON … ORDER BY id DESC is the batch form of the per-product "ORDER BY id DESC LIMIT 1".
  const byScope = async (scopeType, keys) => {
    const rules = new Map();
    if (!keys.size) return { rules, queried: new Set() };
    try {
      const { rows } = await db.query(
        `SELECT DISTINCT ON (scope_ref) scope_ref, saler_split_pct, platform_split_pct
         FROM commission_rules
         WHERE scope_type = $1 AND scope_ref = ANY($2::text[])
           AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
         ORDER BY scope_ref, id DESC`,
        [scopeType, [...keys]]
      );
      for (const r of rows) rules.set(String(r.scope_ref), r);
      return { rules, queried: keys };
    } catch {
      // A failed lookup falls through to the next level, as a failed single lookup does.
      return { rules, queried: keys };
    }
  };

  const [prod, cat, global] = await Promise.all([
    byScope('PRODUCT', productKeys),
    byScope('CATEGORY', categoryKeys),
    db
      .query(`SELECT value_json FROM platform_settings WHERE key = 'commission.default_splits'`)
      .then(({ rows }) => (rows.length > 0 ? rows[0] : null))
      .catch(() => null),
  ]);
  loaded.productRules = prod.rules;
  loaded.productKeys = prod.queried;
  loaded.categoryRules = cat.rules;
  loaded.categoryKeys = cat.queried;
  loaded.global = global;
  loaded.hasGlobal = true;
  return loaded;
}

async function resolveBaseSplit(db, { productId, productRef, categoryId }, preloaded) {
  // 1. Product-level commission rule override
  if (db && (productId || productRef)) {
    try {
      const scopeRef = String(productId || productRef);
      const { rows } = preloaded?.productKeys?.has(scopeRef)
        ? { rows: preloaded.productRules.has(scopeRef) ? [preloaded.productRules.get(scopeRef)] : [] }
        : await db.query(
            `SELECT saler_split_pct, platform_split_pct
             FROM commission_rules
             WHERE scope_type = 'PRODUCT' AND scope_ref = $1
               AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
             ORDER BY id DESC LIMIT 1`,
            [scopeRef]
          );
      if (rows.length > 0) {
        return {
          salerSplitPct: parseFloat(rows[0].saler_split_pct),
          platformSplitPct: parseFloat(rows[0].platform_split_pct),
          ruleSource: 'PRODUCT_OVERRIDE',
        };
      }
    } catch {
      // Continue to next level
    }
  }

  // 2. Category-level commission rule
  if (db && categoryId) {
    try {
      const key = String(categoryId);
      const { rows } = preloaded?.categoryKeys?.has(key)
        ? { rows: preloaded.categoryRules.has(key) ? [preloaded.categoryRules.get(key)] : [] }
        : await db.query(
            `SELECT saler_split_pct, platform_split_pct
             FROM commission_rules
             WHERE scope_type = 'CATEGORY' AND scope_ref = $1
               AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
             ORDER BY id DESC LIMIT 1`,
            [key]
          );
      if (rows.length > 0) {
        return {
          salerSplitPct: parseFloat(rows[0].saler_split_pct),
          platformSplitPct: parseFloat(rows[0].platform_split_pct),
          ruleSource: 'CATEGORY_RULE',
        };
      }
    } catch {
      // Continue to next level
    }
  }

  // 3. Global platform_settings key
  if (db) {
    try {
      const { rows } = preloaded?.hasGlobal
        ? { rows: preloaded.global ? [preloaded.global] : [] }
        : await db.query(`SELECT value_json FROM platform_settings WHERE key = 'commission.default_splits'`);
      if (rows.length > 0 && rows[0].value_json) {
        const val = rows[0].value_json;
        const salerPct = parseFloat(val.saler_split_pct ?? val.saler ?? 70);
        const platformPct = parseFloat(val.platform_split_pct ?? val.platform ?? 30);
        return {
          salerSplitPct: salerPct,
          platformSplitPct: platformPct,
          ruleSource: 'PLATFORM_SETTINGS',
        };
      }
    } catch {
      // Fallback
    }
  }

  // 4. Default fallback
  return {
    salerSplitPct: 70.0,
    platformSplitPct: 30.0,
    ruleSource: 'DEFAULT_FALLBACK',
  };
}

export { TIER_KEYS };

/**
 * Resolves each trust tier's extra Shop Partner split points from the `finance.tier_bonuses` setting
 * (an array of { tier, bonus_pct }). A tier missing from the setting gets 0.
 *
 * WHY: the bonus is a business number, so it lives in platform_settings, not in code. A read
 * failure propagates rather than silently paying (or showing) the wrong bonus.
 *
 * @param {object} db Database client
 * @returns {Promise<Record<string, number>>}
 */
export async function resolveTierBonuses(db: any): Promise<Record<string,number>> {
  const { rows } = await db.query(
    `SELECT value_json FROM platform_settings WHERE key = 'finance.tier_bonuses'`
  );
  return parseTierBonuses(rows[0]?.value_json);
}

/**
 * Resolves platform-wide pricing configuration parameters from platform_settings.
 *
 * @param {object} db Database client
 * @returns {Promise<{ platformDefaultProfitPct: number, salerDefaultProfitPct: number, extraMarkupPlatformPct: number, salerSplitPct: number, platformSplitPct: number }>}
 */
export async function resolvePlatformPricingConfig(db: any): Promise<{ platformDefaultProfitPct: number; salerDefaultProfitPct: number; extraMarkupPlatformPct: number; salerSplitPct: number; platformSplitPct: number; }> {
  const fallback = {
    platformDefaultProfitPct: 10.0,
    salerDefaultProfitPct: 20.0,
    extraMarkupPlatformPct: 20.0,
    // WHY 70/30: owner decision 2026-10-31 (migration 094 moves a stored 40/60).
    salerSplitPct: 70.0,
    platformSplitPct: 30.0,
  };

  if (!db) return fallback;

  try {
    const { rows } = await db.query(
      `SELECT value_json FROM platform_settings WHERE key = 'commission.default_splits'`
    );
    if (rows.length > 0 && rows[0].value_json) {
      const val = rows[0].value_json;
      return {
        platformDefaultProfitPct: parseFloat(val.platform_default_profit_pct ?? 10.0),
        salerDefaultProfitPct: parseFloat(val.saler_default_profit_pct ?? 20.0),
        extraMarkupPlatformPct: parseFloat(val.extra_markup_platform_pct ?? 20.0),
        salerSplitPct: parseFloat(val.saler_split_pct ?? 70.0),
        platformSplitPct: parseFloat(val.platform_split_pct ?? 30.0),
      };
    }
  } catch {
    // fallback
  }

  return fallback;
}

/**
 * Calculates complete pricing breakdown in integer paisa.
 *
 * Supports two operational modes:
 * 1. 'tiered': Shop Partner model where supplier cost is confidential from shop partners.
 *    - Default retail = supplier cost + platform default profit + saler default profit.
 *    - If shop partner sets retail price < default: only shop partner profit drops; platform profit is preserved.
 *    - If shop partner sets retail price > default: extra markup is split between platform and shop partner.
 * 2. 'split': Legacy proportional split mode (backward compatibility).
 *
 * @param {object} params
 * @param {number|string} params.baseCost
 * @param {number|string} [params.wholesaleMargin=0]
 * @param {number|string} params.retailPrice
 * @param {number|string} [params.defaultRetailPrice]
 * @param {number} [params.salerSplitPct=40]
 * @param {number} [params.platformSplitPct=60]
 * @param {number} [params.platformDefaultProfitPct=10]
 * @param {number} [params.salerDefaultProfitPct=20]
 * @param {number} [params.extraMarkupPlatformPct=20]
 * @param {string} [params.mode='split'] 'tiered' or 'split'
 * @param {string} [params.ruleSource='CALCULATED']
 * @param {number|string|null} [params.partnerProfit] Supplier-set partner share per unit (split mode only);
 *   when given it replaces salerSplitPct.
 * @returns {object} Breakdown in BDT numbers, strings, and integer paisa
 */
export function calculatePricingBreakdown({
  baseCost,
  wholesaleMargin = 0,
  retailPrice,
  defaultRetailPrice = null,
  salerSplitPct = 40,
  platformSplitPct = 60,
  platformDefaultProfitPct = 10,
  salerDefaultProfitPct = 20,
  extraMarkupPlatformPct = 20,
  mode = 'split',
  ruleSource = 'CALCULATED',
  partnerProfit = null,
}: { baseCost: number|string; wholesaleMargin?: number|string; retailPrice: number|string; defaultRetailPrice?: number|string; salerSplitPct?: number; platformSplitPct?: number; platformDefaultProfitPct?: number; salerDefaultProfitPct?: number; extraMarkupPlatformPct?: number; mode?: string; ruleSource?: string; partnerProfit?: number|string|null; }): any {
  const baseCostPaisa = toPaisa(baseCost);
  const wholesaleMarginPaisa = toPaisa(wholesaleMargin);
  const wholesaleCostPaisa = baseCostPaisa + wholesaleMarginPaisa; // P_supplier

  if (mode === 'tiered') {
    // Calculate default margins on top of wholesale cost
    const platformDefaultProfitPaisa = Math.round((wholesaleCostPaisa * platformDefaultProfitPct) / 100);
    const salerDefaultProfitPaisa = Math.round((wholesaleCostPaisa * salerDefaultProfitPct) / 100);

    const calculatedDefaultRetailPaisa = wholesaleCostPaisa + platformDefaultProfitPaisa + salerDefaultProfitPaisa;
    const defaultRetailPricePaisa = defaultRetailPrice ? toPaisa(defaultRetailPrice) : calculatedDefaultRetailPaisa;

    // Minimum retail price floor: wholesale cost + platform default profit (saler profit = 0)
    const minRetailPricePaisa = wholesaleCostPaisa + platformDefaultProfitPaisa;

    const retailPricePaisa = (retailPrice !== undefined && retailPrice !== null && retailPrice !== '')
      ? toPaisa(retailPrice)
      : defaultRetailPricePaisa;

    if (retailPricePaisa < minRetailPricePaisa) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Retail price (BDT ${(retailPricePaisa / 100).toFixed(2)}) cannot be lower than minimum selling price (BDT ${(minRetailPricePaisa / 100).toFixed(2)}).`,
        `খুচরা মূল্য (৳${(retailPricePaisa / 100).toFixed(2)}) সর্বনিম্ন বিক্রয় মূল্যের (৳${(minRetailPricePaisa / 100).toFixed(2)}) চেয়ে কম হতে পারে না।`
      );
    }

    let salerEarningPaisa = 0;
    let platformEarningPaisa = 0;
    let priceStatus = 'DEFAULT';

    if (retailPricePaisa < defaultRetailPricePaisa) {
      // 1. Discount below default: Platform profit is protected; only shop partner profit decreases
      priceStatus = 'DISCOUNTED';
      const dropPaisa = defaultRetailPricePaisa - retailPricePaisa;
      platformEarningPaisa = platformDefaultProfitPaisa;
      salerEarningPaisa = salerDefaultProfitPaisa - dropPaisa;
    } else if (retailPricePaisa === defaultRetailPricePaisa) {
      // 2. Exact default retail price
      priceStatus = 'DEFAULT';
      platformEarningPaisa = platformDefaultProfitPaisa;
      salerEarningPaisa = salerDefaultProfitPaisa;
    } else {
      // 3. Marked up above default: Extra markup shared between platform and shop partner
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

    return {
      base_cost: toBdtNumber(baseCostPaisa),
      wholesale_margin: toBdtNumber(wholesaleMarginPaisa),
      wholesale_cost: toBdtNumber(wholesaleCostPaisa),
      retail_price: toBdtNumber(retailPricePaisa),
      default_retail_price: toBdtNumber(defaultRetailPricePaisa),
      min_retail_price: toBdtNumber(minRetailPricePaisa),
      net_retail_margin: toBdtNumber(netRetailMarginPaisa),
      saler_earning: toBdtNumber(salerEarningPaisa),
      saler_default_earning: toBdtNumber(salerDefaultProfitPaisa),
      platform_earning: toBdtNumber(platformEarningPaisa),
      platform_default_earning: toBdtNumber(platformDefaultProfitPaisa),
      platform_default_profit_pct: platformDefaultProfitPct,
      saler_default_profit_pct: salerDefaultProfitPct,
      extra_markup_platform_pct: extraMarkupPlatformPct,
      price_status: priceStatus,
      pricing_state: priceStatus === 'DISCOUNTED' ? 'discount' : (priceStatus === 'BOOSTED' ? 'boost' : 'standard'),
      saler_split_pct: salerSplitPct,
      ...marginSharePcts(salerEarningPaisa, netRetailMarginPaisa),
      platform_split_pct: platformSplitPct,
      total_margin_pct: totalMarginPct,
      saler_margin_pct: salerMarginPct,
      rule_source: ruleSource,
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
  }

  // Legacy Split Mode
  const retailPricePaisa = toPaisa(retailPrice);

  if (retailPricePaisa < wholesaleCostPaisa) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Retail price (BDT ${(retailPricePaisa / 100).toFixed(2)}) cannot be lower than total wholesale cost (BDT ${(wholesaleCostPaisa / 100).toFixed(2)}).`,
      `খুচরা মূল্য (৳${(retailPricePaisa / 100).toFixed(2)}) পাইকারি খরচের (৳${(wholesaleCostPaisa / 100).toFixed(2)}) চেয়ে কম হতে পারে না।`
    );
  }

  const netRetailMarginPaisa = retailPricePaisa - wholesaleCostPaisa;

  // Exact paisa split arithmetic.
  // WHY partnerProfit wins over the split: since migration 085 the supplier sets the partner's share
  // per unit, and that share goes to the monthly reward pool, not to one partner. Capped at the margin
  // so a stale figure can never make the platform's side negative.
  const salerEarningPaisa = partnerProfit != null && partnerProfit !== ''
    ? Math.min(Math.max(toPaisa(partnerProfit), 0), netRetailMarginPaisa)
    : Math.floor((netRetailMarginPaisa * salerSplitPct) / 100);
  const platformEarningPaisa = netRetailMarginPaisa - salerEarningPaisa;

  const totalMarginPct = retailPricePaisa > 0
    ? parseFloat(((netRetailMarginPaisa / retailPricePaisa) * 100).toFixed(2))
    : 0;

  const salerMarginPct = retailPricePaisa > 0
    ? parseFloat(((salerEarningPaisa / retailPricePaisa) * 100).toFixed(2))
    : 0;

  return {
    base_cost: toBdtNumber(baseCostPaisa),
    wholesale_margin: toBdtNumber(wholesaleMarginPaisa),
    wholesale_cost: toBdtNumber(wholesaleCostPaisa),
    retail_price: toBdtNumber(retailPricePaisa),
    default_retail_price: toBdtNumber(retailPricePaisa),
    min_retail_price: toBdtNumber(wholesaleCostPaisa),
    net_retail_margin: toBdtNumber(netRetailMarginPaisa),
    saler_earning: toBdtNumber(salerEarningPaisa),
    saler_default_earning: toBdtNumber(salerEarningPaisa),
    platform_earning: toBdtNumber(platformEarningPaisa),
    platform_default_earning: toBdtNumber(platformEarningPaisa),
    platform_default_profit_pct: platformDefaultProfitPct,
    saler_default_profit_pct: salerDefaultProfitPct,
    extra_markup_platform_pct: extraMarkupPlatformPct,
    price_status: 'DEFAULT',
    saler_split_pct: salerSplitPct,
    ...marginSharePcts(salerEarningPaisa, netRetailMarginPaisa),
    platform_split_pct: platformSplitPct,
    total_margin_pct: totalMarginPct,
    saler_margin_pct: salerMarginPct,
    rule_source: ruleSource,
    paisa: {
      base_cost: baseCostPaisa,
      wholesale_margin: wholesaleMarginPaisa,
      wholesale_cost: wholesaleCostPaisa,
      retail_price: retailPricePaisa,
      default_retail_price: retailPricePaisa,
      min_retail_price: wholesaleCostPaisa,
      net_retail_margin: netRetailMarginPaisa,
      saler_earning: salerEarningPaisa,
      platform_earning: platformEarningPaisa,
    },
  };
}

/**
 * The split of one unit sold in a SUPPLIER-funded flash sale (migration 096, owner decision 2026-10-31).
 *
 * The supplier pays the whole discount: the platform's and the partner pool's share are what they
 * are at the regular retail price, and the supplier's payout (base cost + wholesale margin) drops by
 * regular − deal. The discount comes off the supplier's wholesale margin first, then their base cost,
 * so `net_retail_margin`, `saler_earning` and `platform_earning` are unchanged and the sub-order's
 * `saler_commission + platform_margin = net_retail_margin` CHECK still holds.
 *
 * Refuses (VALIDATION_FAILED) a deal price that is not below the regular price, or that leaves the
 * supplier nothing per unit.
 *
 * @returns The same shape as calculatePricingBreakdown, priced at the deal, plus `supplier_funded`
 *          (the discount per unit) and `supplier_payout` / `regular_supplier_payout`.
 */
export function calculateSupplierFundedBreakdown({
  regularRetailPrice,
  dealPrice,
  ...splitArgs
}: { regularRetailPrice: number|string; dealPrice: number|string; baseCost: number|string; wholesaleMargin?: number|string; salerSplitPct?: number; platformSplitPct?: number; ruleSource?: string; partnerProfit?: number|string|null; }): any {
  const regular = calculatePricingBreakdown({ ...splitArgs, retailPrice: regularRetailPrice, mode: 'split' });
  const regularPaisa = regular.paisa.retail_price;
  const dealPaisa = toPaisa(dealPrice);
  const fundPaisa = regularPaisa - dealPaisa;
  const regularPayoutPaisa = regular.paisa.wholesale_cost;
  const payoutPaisa = regularPayoutPaisa - fundPaisa;

  if (!(dealPaisa > 0) || fundPaisa <= 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      `The flash price must be above zero and below the regular price (BDT ${(regularPaisa / 100).toFixed(2)}).`,
      `ফ্ল্যাশ দাম শূন্যের বেশি এবং নিয়মিত দামের (৳${(regularPaisa / 100).toFixed(2)}) কম হতে হবে।`,
      { field: 'discount_price' }
    );
  }
  if (payoutPaisa <= 0) {
    const minPaisa = regularPaisa - regularPayoutPaisa + 1;
    throw new AppError(
      'VALIDATION_FAILED',
      `At this flash price you would receive nothing per unit. The lowest flash price is BDT ${(minPaisa / 100).toFixed(2)}.`,
      `এই ফ্ল্যাশ দামে আপনি প্রতি ইউনিটে কিছুই পাবেন না। সর্বনিম্ন ফ্ল্যাশ দাম ৳${(minPaisa / 100).toFixed(2)}।`,
      { field: 'discount_price', min_price: toBdtNumber(minPaisa) }
    );
  }

  const fromMarginPaisa = Math.min(fundPaisa, regular.paisa.wholesale_margin);
  const marginPaisa = regular.paisa.wholesale_margin - fromMarginPaisa;
  const basePaisa = regular.paisa.base_cost - (fundPaisa - fromMarginPaisa);

  return {
    ...regular,
    base_cost: toBdtNumber(basePaisa),
    wholesale_margin: toBdtNumber(marginPaisa),
    wholesale_cost: toBdtNumber(payoutPaisa),
    retail_price: toBdtNumber(dealPaisa),
    default_retail_price: toBdtNumber(regularPaisa),
    supplier_funded: toBdtNumber(fundPaisa),
    supplier_payout: toBdtNumber(payoutPaisa),
    regular_supplier_payout: toBdtNumber(regularPayoutPaisa),
    funded_by: 'SUPPLIER',
    paisa: {
      ...regular.paisa,
      base_cost: basePaisa,
      wholesale_margin: marginPaisa,
      wholesale_cost: payoutPaisa,
      retail_price: dealPaisa,
      default_retail_price: regularPaisa,
      supplier_funded: fundPaisa,
    },
  };
}

/**
 * Throws VALIDATION_FAILED unless a supplier's partner profit fits the product's price.
 *
 * The platform keeps at least `platform_default_profit_pct` of the wholesale cost per unit, so the most
 * a supplier can give the partner pool is the margin above that. A business number, not a constant:
 * it moves with the setting at /admin/finance/splits.
 *
 * @param {object} db
 * @param {{ baseCost: number|string, wholesaleMargin?: number|string, retailPrice: number|string, partnerProfit: number|string }} p
 * @returns {Promise<number>} The largest allowed partner profit, in BDT
 */
export async function assertPartnerProfitFits(db: any, { baseCost, wholesaleMargin = 0, retailPrice, partnerProfit }: { baseCost: number|string; wholesaleMargin?: number|string; retailPrice: number|string; partnerProfit: number|string; }): Promise<number> {
  const { platformDefaultProfitPct } = await resolvePlatformPricingConfig(db);
  const wholesaleCostPaisa = toPaisa(baseCost) + toPaisa(wholesaleMargin);
  const platformFloorPaisa = Math.round((wholesaleCostPaisa * platformDefaultProfitPct) / 100);
  const maxPaisa = Math.max(toPaisa(retailPrice) - wholesaleCostPaisa - platformFloorPaisa, 0);
  const wantedPaisa = toPaisa(partnerProfit);
  if (wantedPaisa < 0 || wantedPaisa > maxPaisa) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Partner profit must be between BDT 0.00 and BDT ${(maxPaisa / 100).toFixed(2)} for this price.`,
      `এই দামে partner profit ৳0.00 থেকে ৳${(maxPaisa / 100).toFixed(2)} এর মধ্যে হতে হবে।`
    );
  }
  return toBdtNumber(maxPaisa);
}

/**
 * Preview endpoint helper combining rule resolution and pricing breakdown.
 */
export async function previewPricing(db, {
  baseCost,
  wholesaleMargin = 0,
  retailPrice,
  defaultRetailPrice = null,
  categoryId,
  productId,
  mode = 'tiered',
}) {
  const config = await resolvePlatformPricingConfig(db);
  const { salerSplitPct, platformSplitPct, ruleSource } = await resolveSplitPercentages(db, {
    productId,
    categoryId,
  });

  return calculatePricingBreakdown({
    baseCost,
    wholesaleMargin,
    retailPrice,
    defaultRetailPrice,
    salerSplitPct,
    platformSplitPct,
    platformDefaultProfitPct: config.platformDefaultProfitPct,
    salerDefaultProfitPct: config.salerDefaultProfitPct,
    extraMarkupPlatformPct: config.extraMarkupPlatformPct,
    mode,
    ruleSource,
  });
}

