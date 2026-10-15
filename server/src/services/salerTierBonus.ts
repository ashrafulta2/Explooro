/**
 * salerTierBonus.ts — the sales-volume commission tier a shop partner has EARNED, as the pricing step sees it.
 *
 * WHY a separate file: pricing.service.ts resolves the split and subscriptionRebate.ts is its sibling
 * for the Shop Partner Pro rebate; this follows the same shape so pricing can import it without a cycle.
 *
 * How a tier works (BRONZE < SILVER < GOLD < PLATINUM):
 *   - `saler.commission_tiers` (platform_settings) holds the switch, the rolling window and the monthly
 *     volume each tier above BRONZE asks for.
 *   - `finance.tier_bonuses` (platform_settings, already edited at /admin/finance/splits) holds the extra
 *     saler split points each tier pays. Thresholds and bonuses are separate settings on purpose: the
 *     screen that already owns the bonuses keeps owning them.
 *   - the daily `saler_tier` job writes each shop partner's tier to `saler_commission_tiers`. Checkout only READS
 *     that row, so the split an order is priced with never depends on a sum computed mid-checkout, and a
 *     tier is the same for every item of the same order.
 *
 * With the switch off, no row, or no bonus configured the result is 0, i.e. today's behaviour exactly.
 */

/** Trust tiers a bonus can be set for, lowest first. */
export const TIER_KEYS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];

/** Volume each tier above BRONZE asks for; null means the stored value was unusable. */
export type Thresholds = Record<string, number | null>;

export interface TierRules {
  enabled: boolean;
  window_days: number;
  thresholds: Thresholds;
}

export const RULES_KEY = 'saler.commission_tiers';

export const DEFAULT_RULES = Object.freeze({
  enabled: false,
  window_days: 30,
  thresholds: Object.freeze({ SILVER: 50000, GOLD: 150000, PLATINUM: 400000 }),
});

/**
 * Pure. Reads the `finance.tier_bonuses` list ({ tier, bonus_pct }[]) into a map; a tier that is missing
 * or malformed gets 0. Shared with the Finance splits screen so both read one definition.
 */
export function parseTierBonuses(list: unknown): Record<string, number> {
  const bonuses: Record<string, number> = Object.fromEntries(TIER_KEYS.map((k) => [k, 0]));
  if (Array.isArray(list)) {
    for (const row of list) {
      const pct = parseFloat(row?.bonus_pct);
      if (TIER_KEYS.includes(row?.tier) && Number.isFinite(pct) && pct >= 0) bonuses[row.tier] = pct;
    }
  }
  return bonuses;
}

/**
 * Pure. Merges a stored rules object over the defaults field by field. A malformed field falls back to
 * its default rather than failing: one bad edit must not stop every shop partner from being tiered.
 * Thresholds that do not rise (GOLD <= SILVER) are discarded as a set, because a ladder that does not
 * rise would promote a shop partner past a tier they have not reached.
 */
export function resolveRules(raw: unknown): TierRules {
  const r: any = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_RULES;
  const windowDays = Number.isInteger(r.window_days) && r.window_days >= 7 && r.window_days <= 365 ? r.window_days : d.window_days;

  let thresholds: Thresholds = { ...d.thresholds };
  const t = r.thresholds && typeof r.thresholds === 'object' ? r.thresholds : null;
  if (t) {
    const next: Thresholds = {};
    for (const k of TIER_KEYS.slice(1)) {
      const v = Number(t[k]);
      next[k] = Number.isFinite(v) && v > 0 ? v : null;
    }
    const vals = TIER_KEYS.slice(1).map((k) => next[k]);
    const rises = vals.every((v, i) => v != null && (i === 0 || v > vals[i - 1]));
    if (rises) thresholds = next;
  }
  return { enabled: r.enabled === true, window_days: windowDays, thresholds };
}

/**
 * Strict form of `resolveRules` for an admin write: out-of-range input is refused, never clamped, so what
 * an admin saves is what shop partners see. Returns the clean object or throws an Error with a message.
 */
export function validateRules(input: any): TierRules {
  const bad = (m: string) => Object.assign(new Error(m), { code: 'VALIDATION_FAILED' });
  if (!input || typeof input !== 'object') throw bad('Rules must be an object.');
  if (typeof input.enabled !== 'boolean') throw bad('"enabled" must be true or false.');
  if (!Number.isInteger(input.window_days) || input.window_days < 7 || input.window_days > 365) {
    throw bad('"window_days" must be a whole number from 7 to 365.');
  }
  const thresholds: Thresholds = {};
  let prev = 0;
  for (const k of TIER_KEYS.slice(1)) {
    const v = Number(input.thresholds?.[k]);
    if (!Number.isFinite(v) || v <= prev) throw bad(`${k} must ask for more volume than the tier below it.`);
    if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) throw bad(`${k}: use at most two decimal places.`);
    thresholds[k] = v;
    prev = v;
  }
  return { enabled: input.enabled, window_days: input.window_days, thresholds };
}

/** Pure. The highest tier a volume reaches. BRONZE is the floor, never null. */
export function pickTierKey(volume: unknown, thresholds: Thresholds | null | undefined): string {
  const v = Number(volume);
  let tier = 'BRONZE';
  if (!Number.isFinite(v)) return tier;
  for (const k of TIER_KEYS.slice(1)) {
    if (Number.isFinite(Number(thresholds?.[k])) && v >= Number(thresholds[k])) tier = k;
  }
  return tier;
}

/** Pure. The tier after `tier` and how much more volume reaches it, or null at the top. */
export function nextTierInfo(
  tier: string,
  volume: unknown,
  thresholds: Thresholds
): { tier: string; min_volume: number; remaining: number } | null {
  const i = TIER_KEYS.indexOf(tier);
  const nextKey = i >= 0 ? TIER_KEYS[i + 1] : null;
  if (!nextKey) return null;
  const min = Number(thresholds[nextKey]);
  return { tier: nextKey, min_volume: min, remaining: Math.max(0, min - Number(volume || 0)) };
}

/**
 * Extra shop partner split points this shop partner's earned tier pays, 0 when none applies.
 * One query reads the switch, the shop partner's tier and the bonus list together, so a checkout of N items
 * costs N cheap lookups, not 3N.
 */
export async function resolveSalerTierBonusPct(
  db: any,
  { salerId }: { salerId?: number | string | null } = {}
): Promise<number> {
  if (!db || !salerId) return 0;
  const { rows } = await db.query(
    `SELECT (SELECT value_json FROM platform_settings WHERE key = 'saler.commission_tiers') AS rules,
            (SELECT value_json FROM platform_settings WHERE key = 'finance.tier_bonuses') AS bonuses,
            (SELECT tier FROM saler_commission_tiers WHERE saler_id = $1) AS tier`,
    [salerId]
  );
  const row = rows[0];
  if (!row || !resolveRules(row.rules).enabled || !TIER_KEYS.includes(row.tier)) return 0;
  return parseTierBonuses(row.bonuses)[row.tier] || 0;
}

/** The stored rules, merged over the defaults. */
export async function loadRules(db: any): Promise<TierRules> {
  const { rows } = await db.query(`SELECT value_json FROM platform_settings WHERE key = '${RULES_KEY}'`);
  return resolveRules(rows[0]?.value_json);
}

/** Writes rules that have already passed `validateRules`. */
export async function saveRules(db: any, rules: TierRules): Promise<void> {
  await db.query(
    `INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, updated_at)
     VALUES ($1, $2::jsonb, 'OBJECT', 'Shop Partner commission tiers', 'শপ পার্টনার কমিশন টিয়ার', 'finance', now())
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = now()`,
    [RULES_KEY, JSON.stringify(rules)]
  );
}
