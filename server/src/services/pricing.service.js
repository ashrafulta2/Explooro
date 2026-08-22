/**
 * pricing.service.js — Dynamic pricing engine & profit split calculator (Prompt 4.3).
 *
 * Rules:
 *   retail_price = base_cost + wholesale_margin + net_retail_margin
 *   saler_earning    = net_retail_margin × saler_split_pct
 *   platform_earning = net_retail_margin × platform_split_pct
 *
 * Resolution hierarchy:
 *   1. Product-specific commission override in commission_rules (scope_type = 'PRODUCT')
 *   2. Category-specific commission rule in commission_rules (scope_type = 'CATEGORY')
 *   3. Global commission rule in commission_rules (scope_type = 'GLOBAL')
 *   4. Global platform_settings key ('commission.default_splits')
 *   5. Hard fallback (40% saler / 60% platform)
 *
 * Precision & Rounding Invariant:
 *   All arithmetic is strictly performed in integer paisa (1 BDT = 100 paisa) to eliminate
 *   floating-point drift. Rounding remainders (fractional paisa) always go to the platform.
 */

import { AppError } from '../plugins/errorHandler.js';

/**
 * Converts a decimal BDT amount into integer paisa.
 * @param {number|string} amount
 * @returns {number} Integer paisa
 */
export function toPaisa(amount) {
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
export function toBdtString(paisa) {
  return (paisa / 100).toFixed(2);
}

/**
 * Converts integer paisa to numeric decimal BDT.
 * @param {number} paisa
 * @returns {number} e.g. 120.00
 */
export function toBdtNumber(paisa) {
  return parseFloat((paisa / 100).toFixed(2));
}

/**
 * Resolves the active commission split percentages for a product/category context.
 *
 * @param {object} db Database client
 * @param {object} context { productId, productRef, categoryId }
 * @returns {Promise<{ salerSplitPct: number, platformSplitPct: number, ruleSource: string }>}
 */
export async function resolveSplitPercentages(db, { productId, productRef, categoryId } = {}) {
  // 1. Product-level commission rule override
  if (db && (productId || productRef)) {
    try {
      const scopeRef = String(productId || productRef);
      const { rows } = await db.query(
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
      const { rows } = await db.query(
        `SELECT saler_split_pct, platform_split_pct
         FROM commission_rules
         WHERE scope_type = 'CATEGORY' AND scope_ref = $1
           AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
         ORDER BY id DESC LIMIT 1`,
        [String(categoryId)]
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

  // 3. Global commission rule
  if (db) {
    try {
      const { rows } = await db.query(
        `SELECT saler_split_pct, platform_split_pct
         FROM commission_rules
         WHERE scope_type = 'GLOBAL'
           AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
         ORDER BY id DESC LIMIT 1`
      );
      if (rows.length > 0) {
        return {
          salerSplitPct: parseFloat(rows[0].saler_split_pct),
          platformSplitPct: parseFloat(rows[0].platform_split_pct),
          ruleSource: 'GLOBAL_COMMISSION_RULE',
        };
      }
    } catch {
      // Continue to next level
    }
  }

  // 4. Global platform_settings key
  if (db) {
    try {
      const { rows } = await db.query(
        `SELECT value_json FROM platform_settings WHERE key = 'commission.default_splits'`
      );
      if (rows.length > 0 && rows[0].value_json) {
        const val = rows[0].value_json;
        const salerPct = parseFloat(val.saler_split_pct ?? val.saler ?? 40);
        const platformPct = parseFloat(val.platform_split_pct ?? val.platform ?? 60);
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

  // 5. Default fallback
  return {
    salerSplitPct: 40.0,
    platformSplitPct: 60.0,
    ruleSource: 'DEFAULT_FALLBACK',
  };
}

/**
 * Calculates complete pricing breakdown in integer paisa.
 *
 * @param {object} params
 * @param {number|string} params.baseCost
 * @param {number|string} [params.wholesaleMargin=0]
 * @param {number|string} params.retailPrice
 * @param {number} [params.salerSplitPct=40]
 * @param {number} [params.platformSplitPct=60]
 * @param {string} [params.ruleSource='CALCULATED']
 * @returns {object} Breakdown in BDT numbers, strings, and integer paisa
 */
export function calculatePricingBreakdown({
  baseCost,
  wholesaleMargin = 0,
  retailPrice,
  salerSplitPct = 40,
  platformSplitPct = 60,
  ruleSource = 'CALCULATED',
}) {
  const baseCostPaisa = toPaisa(baseCost);
  const wholesaleMarginPaisa = toPaisa(wholesaleMargin);
  const retailPricePaisa = toPaisa(retailPrice);

  const wholesaleCostPaisa = baseCostPaisa + wholesaleMarginPaisa;

  if (retailPricePaisa < wholesaleCostPaisa) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Retail price (BDT ${(retailPricePaisa / 100).toFixed(2)}) cannot be lower than total wholesale cost (BDT ${(wholesaleCostPaisa / 100).toFixed(2)}).`,
      `খুচরা মূল্য (৳${(retailPricePaisa / 100).toFixed(2)}) পাইকারি খরচের (৳${(wholesaleCostPaisa / 100).toFixed(2)}) চেয়ে কম হতে পারে না।`
    );
  }

  const netRetailMarginPaisa = retailPricePaisa - wholesaleCostPaisa;

  // Exact paisa split arithmetic
  // Saler gets Math.floor of their share; the platform absorbs the rounding remainder
  const salerEarningPaisa = Math.floor((netRetailMarginPaisa * salerSplitPct) / 100);
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
    net_retail_margin: toBdtNumber(netRetailMarginPaisa),
    saler_earning: toBdtNumber(salerEarningPaisa),
    platform_earning: toBdtNumber(platformEarningPaisa),
    saler_split_pct: salerSplitPct,
    platform_split_pct: platformSplitPct,
    total_margin_pct: totalMarginPct,
    saler_margin_pct: salerMarginPct,
    rule_source: ruleSource,
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
}

/**
 * Preview endpoint helper combining rule resolution and pricing breakdown.
 */
export async function previewPricing(db, { baseCost, wholesaleMargin = 0, retailPrice, categoryId, productId }) {
  const { salerSplitPct, platformSplitPct, ruleSource } = await resolveSplitPercentages(db, {
    productId,
    categoryId,
  });

  return calculatePricingBreakdown({
    baseCost,
    wholesaleMargin,
    retailPrice,
    salerSplitPct,
    platformSplitPct,
    ruleSource,
  });
}
