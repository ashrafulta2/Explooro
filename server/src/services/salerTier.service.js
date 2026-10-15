// @ts-check
/**
 * salerTier.service.js — puts every shop partner in a commission tier by what they sold, and shows them where
 * they stand.
 *
 * The tier is a rolling-window figure (`window_days`, default 30) of DELIVERED sales, goods only
 * (`total_amount - shipping_amount`), the same measure the supplier Volume Incentive uses, so a returned
 * or cancelled order never counts. Because the window rolls, a shop partner who stops selling drifts back down:
 * a tier is earned continuously, not kept.
 *
 * What a tier pays is NOT decided here - `finance.tier_bonuses` owns that (see salerTierBonus.ts).
 * This file only decides who is in which tier, and the pricing step reads the result.
 */

import { writeAudit } from '../lib/audit.js';
import {
  RULES_KEY, TIER_KEYS, nextTierInfo, parseTierBonuses, pickTierKey, resolveRules,
} from './salerTierBonus.ts';

async function loadSettings(db) {
  const { rows } = await db.query(
    `SELECT key, value_json FROM platform_settings WHERE key IN ($1, 'finance.tier_bonuses')`,
    [RULES_KEY]
  );
  const byKey = new Map(rows.map((r) => [r.key, r.value_json]));
  return { rules: resolveRules(byKey.get(RULES_KEY)), bonuses: parseTierBonuses(byKey.get('finance.tier_bonuses')) };
}

/**
 * Recomputes every shop partner's tier. Safe to run as often as the scheduler likes: it is a pure function of
 * the delivered orders in the window, and it writes (and audits) only the rows that change.
 * @returns {Promise<{ evaluated: number, changed: number, skipped: boolean }>}
 */
export async function recomputeAll(db) {
  const { rules } = await loadSettings(db);
  // WHY nothing is written while off: the rows would be unused, and switching it on later runs the job
  // once before any order is priced against a stale tier.
  if (!rules.enabled) return { evaluated: 0, changed: 0, skipped: true };

  const { rows: volumes } = await db.query(
    `SELECT saler_id, SUM(total_amount - shipping_amount) AS volume
       FROM sub_orders
      WHERE status = 'DELIVERED'
        AND saler_id IS NOT NULL AND saler_id <> supplier_id
        AND delivered_at >= now() - ($1::int * INTERVAL '1 day')
      GROUP BY saler_id`,
    [rules.window_days]
  );
  const { rows: existing } = await db.query(`SELECT saler_id, tier FROM saler_commission_tiers`);
  const current = new Map(existing.map((r) => [String(r.saler_id), r.tier]));

  const next = new Map();
  for (const v of volumes) next.set(String(v.saler_id), { volume: Number(v.volume), tier: pickTierKey(v.volume, rules.thresholds) });
  // A shop partner with a row but no sales in the window has fallen out of it: back to BRONZE with volume 0.
  for (const id of current.keys()) if (!next.has(id)) next.set(id, { volume: 0, tier: 'BRONZE' });

  let changed = 0;
  for (const [salerId, { volume, tier }] of next) {
    const before = current.get(salerId) ?? 'BRONZE';
    await db.query(
      `INSERT INTO saler_commission_tiers (saler_id, tier, volume, window_days, computed_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (saler_id) DO UPDATE
         SET tier = EXCLUDED.tier, volume = EXCLUDED.volume,
             window_days = EXCLUDED.window_days, computed_at = now()`,
      [salerId, tier, volume.toFixed(2), rules.window_days]
    );
    if (tier !== before) {
      changed += 1;
      await writeAudit(db, {
        action: 'saler.commission_tier.changed',
        targetType: 'users',
        targetRef: salerId,
        before: { tier: before },
        after: { tier, volume: volume.toFixed(2), window_days: rules.window_days },
        actorId: null,
        actorRole: 'system',
      });
    }
  }
  return { evaluated: next.size, changed, skipped: false };
}

/** A shop partner's standing for their own card: tier, what it pays, and the way to the next one. */
export async function getSalerView(db, salerId) {
  const { rules, bonuses } = await loadSettings(db);
  const { rows } = await db.query(
    `SELECT tier, volume, computed_at FROM saler_commission_tiers WHERE saler_id = $1`,
    [salerId]
  );
  const row = rows[0];
  const tier = row && TIER_KEYS.includes(row.tier) ? row.tier : 'BRONZE';
  const volume = row ? Number(row.volume) : 0;
  const step = rules.enabled ? nextTierInfo(tier, volume, rules.thresholds) : null;
  return {
    enabled: rules.enabled,
    window_days: rules.window_days,
    tier,
    bonus_pct: bonuses[tier],
    volume: volume.toFixed(2),
    computed_at: row?.computed_at ?? null,
    next: step && { ...step, bonus_pct: bonuses[step.tier] },
    ladder: TIER_KEYS.map((k) => ({ tier: k, min_volume: k === 'BRONZE' ? 0 : rules.thresholds[k], bonus_pct: bonuses[k] })),
  };
}
