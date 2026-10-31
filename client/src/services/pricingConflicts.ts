/**
 * pricingConflicts.ts — finds price and discount settings that work against each other, so an admin
 * is told while setting them instead of finding out from a sale that paid nobody.
 *
 * Owner request 2026-10-31: a 25% team discount on top of a 15% markup sold every team at the
 * supplier's price, and nothing on either admin page said so. Each setting was valid on its own; the
 * conflict only exists between them. This file is the one place those cross-setting rules live:
 *   - the retail markup (`pricing.markup`, per-category `category_markups`)       /admin/finance/splits
 *   - the partner pool's share and the platform minimum (`commission.default_splits`) same page
 *   - the 2- and 3-member team discounts (`group_buying` module)                   /admin/growth/group-buy
 * and, at the end of the file, the one price an admin types for a single flash sale or coupon
 * (/admin/growth/campaigns, /admin/growth/coupons), judged against those same settings.
 *
 * Pure: the pages pass their (possibly unsaved) form values, so a conflict shows while typing.
 * Rounding to `round_to_bdt` only ever widens a margin, so the rules ignore it and describe the worst
 * case (a price that needs no rounding). `server/test/pricingConflicts.test.js` runs each rule against
 * the server's own pricing functions and fails if a prediction is wrong.
 *
 * Every percentage here is of the SUPPLIER price, the way the platform minimum is set:
 *   markup m → margin m% · platform minimum f% · partner share s% of the margin · team discount d% of retail.
 */

export type ConflictSeverity = 'error' | 'warning';

export type ConflictCode =
  | 'MARKUP_BELOW_FLOOR'
  | 'SPLIT_CAPPED'
  | 'TEAM_AT_COST'
  | 'TEAM_BELOW_FLOOR'
  | 'DEAL_NOT_A_DISCOUNT'
  | 'DEAL_BELOW_SUPPLIER'
  | 'DEAL_BELOW_FLOOR'
  | 'COUPON_PERCENT_ABOVE_SHARE'
  | 'COUPON_FIXED_ABOVE_SHARE';

export interface PricingPolicyInput {
  markup: { default_markup_pct: number; categories?: Record<string, number> };
  split: { saler_split_pct: number; platform_default_profit_pct: number };
  /** null when team buying is switched off: its discounts then cannot conflict with anything. */
  team?: { discount_pct_2: number; discount_pct_3: number } | null;
  /** Category names, for the message. Ids missing here still count. */
  categoryNames?: Array<{ id: number | string; name_en?: string; name_bn?: string }>;
}

export interface PricingConflict {
  code: ConflictCode;
  severity: ConflictSeverity;
  /** Stable identity: same conflict, same key, so a page can tell a new one from an old one. */
  key: string;
  /** The markup group a settings conflict belongs to. Absent on a single deal or coupon. */
  markup_pct?: number;
  /** True when the markup is the default one (it then covers every category without its own). */
  is_default?: boolean;
  categories?: Array<{ id: string; name_en: string; name_bn: string }>;
  /** Numbers the message and the fix need, already rounded for display. */
  params: Record<string, number>;
  /** Where to change each side of the conflict. */
  links: string[];
  /** The fix message's key when it is not `<code>_fix` (a conflict with more than one way out). */
  fix?: string;
}

const SPLITS_PAGE = '/admin/finance/splits';
const GROUP_BUY_PAGE = '/admin/growth/group-buy';

// One decimal for display. Bounds round inward so a suggested fix really fixes it.
const down1 = (n: number) => Math.floor(n * 10 + 1e-9) / 10;
const up1 = (n: number) => Math.ceil(n * 10 - 1e-9) / 10;
const round1 = (n: number) => Math.round(n * 10) / 10;

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Team margin as a % of the supplier price after a team discount of `d`% off retail. */
export function teamMarginPct(markupPct: number, discountPct: number): number {
  return ((100 + markupPct) * (100 - discountPct)) / 100 - 100;
}

/**
 * Every markup in use, each with the categories it prices. The default markup is always checked, even
 * when every category has its own, because a new category starts on it.
 */
function markupGroups(policy: PricingPolicyInput) {
  const overrides = policy.markup.categories || {};
  const names = new Map((policy.categoryNames || []).map((c) => [String(c.id), c]));
  const label = (id: string) => {
    const c = names.get(id);
    return { id, name_en: c?.name_en || `#${id}`, name_bn: c?.name_bn || c?.name_en || `#${id}` };
  };
  const groups = [{ markup: num(policy.markup.default_markup_pct), isDefault: true, categories: [] as ReturnType<typeof label>[] }];
  for (const c of policy.categoryNames || []) {
    if (overrides[String(c.id)] === undefined) groups[0].categories.push(label(String(c.id)));
  }
  for (const [id, pct] of Object.entries(overrides)) {
    groups.push({ markup: num(pct), isDefault: false, categories: [label(id)] });
  }
  return groups;
}

export function findPricingConflicts(policy: PricingPolicyInput): PricingConflict[] {
  const floor = num(policy.split.platform_default_profit_pct);
  const share = num(policy.split.saler_split_pct);
  const out: PricingConflict[] = [];

  for (const g of markupGroups(policy)) {
    const m = g.markup;
    const scope = g.isDefault ? 'default' : `cat:${g.categories[0].id}`;
    const base = { markup_pct: m, is_default: g.isDefault, categories: g.categories };

    if (m < floor) {
      // The margin is smaller than the platform minimum: the pool gets nothing and the platform less
      // than it set for itself (assertPartnerProfitFits caps the partner profit at 0).
      out.push({
        ...base, code: 'MARKUP_BELOW_FLOOR', severity: 'error', key: `MARKUP_BELOW_FLOOR:${scope}`,
        params: { markup: m, floor },
        links: [SPLITS_PAGE],
      });
    } else if ((share * m) / 100 > m - floor + 1e-9) {
      // The pool's share would eat into the platform minimum, so the minimum wins and the pool gets
      // less than the share the admin set (product.service defaultPartnerProfit caps it).
      out.push({
        ...base, code: 'SPLIT_CAPPED', severity: 'warning', key: `SPLIT_CAPPED:${scope}`,
        params: {
          markup: m,
          floor,
          share,
          effective_share: m > 0 ? down1(((m - floor) * 100) / m) : 0,
          need_markup: share < 100 ? up1((floor * 100) / (100 - share)) : 0,
          max_floor: down1((m * (100 - share)) / 100),
        },
        links: [SPLITS_PAGE],
      });
    }

    if (!policy.team || m < floor) continue;
    // The largest team discount that still leaves the platform its minimum: following the fix clears
    // both team conflicts, not just the worse one.
    const maxDiscount = down1(100 - (100 * (100 + floor)) / (100 + m));
    for (const size of [2, 3] as const) {
      const d = num(size === 2 ? policy.team.discount_pct_2 : policy.team.discount_pct_3);
      if (d <= 0) continue;
      const teamMargin = teamMarginPct(m, d);
      if (teamMargin <= 1e-9) {
        // teamPurchase.service computeGroupPrice floors the price at the supplier's: the team buys at
        // cost and neither the platform nor the partner pool earns anything.
        out.push({
          ...base, code: 'TEAM_AT_COST', severity: 'error', key: `TEAM_AT_COST:${size}:${scope}`,
          params: { size, discount: d, markup: m, floor, cost_discount: down1((100 * m) / (100 + m)), max_discount: maxDiscount },
          links: [GROUP_BUY_PAGE, SPLITS_PAGE],
        });
      } else if (teamMargin < floor - 1e-9) {
        out.push({
          ...base, code: 'TEAM_BELOW_FLOOR', severity: 'warning', key: `TEAM_BELOW_FLOOR:${size}:${scope}`,
          params: { size, discount: d, markup: m, floor, team_margin: round1(teamMargin), max_discount: maxDiscount },
          links: [GROUP_BUY_PAGE, SPLITS_PAGE],
        });
      }
    }
  }

  // Errors first, then by markup so the worst category leads.
  return out.sort((a, b) => (a.severity === b.severity ? (a.markup_pct ?? 0) - (b.markup_pct ?? 0) : a.severity === 'error' ? -1 : 1));
}

/** Conflicts in `next` that `current` does not have: what a save would newly cause. */
export function newConflicts(current: PricingConflict[], next: PricingConflict[]): PricingConflict[] {
  const known = new Set(current.map((c) => c.key));
  return next.filter((c) => !known.has(c.key));
}

// ---- One deal or one coupon ----------------------------------------------------------------------
// The rules above judge settings that apply to every sale. These judge one price an admin types: a
// flash sale's price, or a platform-funded coupon. Same severities, same panel.

const toPaisa = (v: unknown) => Math.round(num(v) * 100);
const fromPaisa = (p: number) => p / 100;

export interface DealPriceInput {
  /** The deal price for one unit. */
  price: number;
  /** base_cost + wholesale_margin: what the supplier is paid per unit. */
  supplierPrice: number;
  retailPrice: number;
  /** products.partner_profit: what the partner pool takes per unit. */
  partnerProfit: number;
  /** platform_default_profit_pct: the platform's minimum, % of the supplier price. */
  floorPct: number;
}

/**
 * A sale at `price` splits the way checkout splits it (pricing.service calculatePricingBreakdown, split
 * mode): the supplier is paid in full, the partner pool takes its partner_profit capped at the margin,
 * and the platform keeps what is left. So a deal price comes out of the platform's side first.
 */
export function findDealPriceConflicts(deal: DealPriceInput): PricingConflict[] {
  const price = toPaisa(deal.price);
  const supplier = toPaisa(deal.supplierPrice);
  const retail = toPaisa(deal.retailPrice);
  if (!(price > 0) || !(supplier > 0)) return [];
  const make = (code: ConflictCode, severity: ConflictSeverity, params: Record<string, number>): PricingConflict =>
    ({ code, severity, key: code, params, links: [] });

  if (retail > 0 && price >= retail) {
    // flashSale.service refuses this: a "deal" at or above the normal price is not a deal.
    return [make('DEAL_NOT_A_DISCOUNT', 'error', { price: fromPaisa(price), retail: fromPaisa(retail) })];
  }
  if (price < supplier) {
    // Checkout refuses to sell under the supplier's price, so nobody could buy this deal.
    return [make('DEAL_BELOW_SUPPLIER', 'error', { price: fromPaisa(price), supplier: fromPaisa(supplier) })];
  }
  const margin = price - supplier;
  const pool = Math.min(Math.max(toPaisa(deal.partnerProfit), 0), margin);
  const platform = margin - pool;
  const floor = Math.round((supplier * num(deal.floorPct)) / 100);
  if (platform < floor) {
    // The lowest price that pays the pool in full and still leaves the platform its minimum.
    const minPrice = Math.ceil(fromPaisa(supplier + Math.max(toPaisa(deal.partnerProfit), 0) + floor));
    const conflict = make('DEAL_BELOW_FLOOR', 'warning', {
      price: fromPaisa(price),
      platform: fromPaisa(platform),
      pool: fromPaisa(pool),
      floor_amount: fromPaisa(floor),
      min_price: minPrice,
      retail: fromPaisa(retail),
    });
    // WHY a second fix: when the retail price itself leaves no room (the pool's profit already takes
    // everything above the platform minimum), no deal price can keep it, so naming one would mislead.
    if (retail > 0 && toPaisa(minPrice) >= retail) conflict.fix = 'deal_below_floor_fix_no_room';
    return [conflict];
  }
  return [];
}

export interface CouponInput {
  discount_type: string;
  discount_value: number;
  min_spend?: number;
  max_discount?: number | null;
  /** Only a platform-funded coupon costs the platform; anyone else's comes out of their own pocket. */
  funded_by?: string;
}

/** What the platform keeps of a sale, as a % of the retail price, at markup `m`. */
export function platformShareOfRetail(m: number, share: number, floor: number): number {
  const partner = Math.min((share * m) / 100, Math.max(m - floor, 0));
  return ((m - partner) * 100) / (100 + m);
}

/**
 * A platform-funded coupon is paid by the platform (escrow is locked on the price before the coupon).
 * When it gives more than the platform keeps of a sale, every order it fully applies to costs the
 * platform money. Judged at the lowest markup in use (the worst category) and at the smallest order
 * the coupon accepts. A warning: a loss-leading coupon can be a deliberate marketing spend.
 */
export function findCouponConflicts(coupon: CouponInput, policy: PricingPolicyInput): PricingConflict[] {
  if ((coupon.funded_by || 'PLATFORM') !== 'PLATFORM') return [];
  const value = num(coupon.discount_value);
  const minSpend = num(coupon.min_spend);
  const maxDiscount = coupon.max_discount == null ? 0 : num(coupon.max_discount);
  if (!(value > 0)) return [];

  const share = num(policy.split.saler_split_pct);
  const floor = num(policy.split.platform_default_profit_pct);
  let worst = { markup: 0, pct: Infinity };
  for (const g of markupGroups(policy)) {
    const pct = platformShareOfRetail(g.markup, share, floor);
    if (pct < worst.pct) worst = { markup: g.markup, pct };
  }

  if (coupon.discount_type === 'PERCENT') {
    const effective = maxDiscount > 0 && minSpend > 0 ? Math.min(value, (maxDiscount * 100) / minSpend) : value;
    if (effective <= worst.pct + 1e-9) return [];
    return [{
      code: 'COUPON_PERCENT_ABOVE_SHARE', severity: 'warning', key: 'COUPON_PERCENT_ABOVE_SHARE', links: [],
      params: { coupon_pct: round1(effective), platform_pct: down1(worst.pct), markup: worst.markup },
    }];
  }
  if (coupon.discount_type === 'FIXED') {
    const effective = minSpend > 0 ? (value * 100) / minSpend : 100;
    if (effective <= worst.pct + 1e-9) return [];
    return [{
      code: 'COUPON_FIXED_ABOVE_SHARE', severity: 'warning', key: 'COUPON_FIXED_ABOVE_SHARE', links: [],
      params: {
        amount: value,
        min_spend: minSpend,
        coupon_pct: round1(Math.min(effective, 100)),
        platform_pct: down1(worst.pct),
        markup: worst.markup,
        min_spend_needed: worst.pct > 0 ? Math.ceil((value * 100) / worst.pct) : 0,
      },
    }];
  }
  return [];
}
