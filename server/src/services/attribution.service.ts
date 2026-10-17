/**
 * attribution.service.ts — decides which shop partner's promotion a sale belongs to.
 *
 * A shopper's "touch" is the last place a shop partner sent them from: their storefront
 * (`STORE`, by store slug) or one of their tracked short links (`LINK`, by link code). The client
 * keeps the last touch and sends it with every add-to-cart; this file is the only place that turns
 * a touch into a shop partner. The client never sends a user id, so a touch can only name a shop
 * partner through something that partner published.
 *
 * A touch counts only when all of these hold:
 *   1. it is younger than `attribution.rules.window_days`;
 *   2. it resolves to a live store or an existing link;
 *   3. that shop partner has the product active in their store (they are actually selling it);
 *   4. the shopper is not that shop partner (no commission on your own purchase).
 *
 * WHY a forged touch is harmless: it can only name a partner who already sells the product, and it
 * pays that partner, never the shopper. That is exactly what clicking the partner's link does.
 */

export const SOURCE = Object.freeze({ STOREFRONT: 'STOREFRONT', SHORT_LINK: 'SHORT_LINK' });

export const RULES_KEY = 'attribution.rules';

// The bounds an admin may set. A stored value outside them is ignored in favour of the default.
export const WINDOW_LIMITS = Object.freeze({ min: 1, max: 90 });

// WHY a default in code: it is only the reader's fallback when the setting row is missing or
// malformed, and it equals the value migration 076 seeds.
export const DEFAULT_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REF_LENGTH = 120;

/** @param {unknown} value */
export function resolveWindowDays(value: unknown): number {
  const n = Number((value as any)?.window_days);
  if (!Number.isInteger(n) || n < WINDOW_LIMITS.min || n > WINDOW_LIMITS.max) return DEFAULT_WINDOW_DAYS;
  return n;
}

/**
 * Validates the touch the client sent. Anything malformed is treated as no touch at all.
 * @returns {{ type: 'STORE'|'LINK', ref: string, at: Date } | null}
 */
export function normalizeTouch(raw: any): { type: 'STORE' | 'LINK'; ref: string; at: Date } | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type === 'STORE' || raw.type === 'LINK' ? raw.type : null;
  const ref = typeof raw.ref === 'string' ? raw.ref.trim().toLowerCase() : '';
  const at = new Date(raw.at);
  if (!type || !ref || ref.length > MAX_REF_LENGTH || Number.isNaN(at.getTime())) return null;
  return { type, ref, at };
}

/** True while a touch made at `touchedAt` still counts at `now`. A touch from the future does not. */
export function isWithinWindow(touchedAt: Date, now: Date, windowDays: number): boolean {
  const age = now.getTime() - touchedAt.getTime();
  return age >= 0 && age <= windowDays * DAY_MS;
}

export async function loadWindowDays(db: any): Promise<number> {
  const { rows } = await db.query(`SELECT value_json FROM platform_settings WHERE key = $1`, [RULES_KEY]);
  return resolveWindowDays(rows[0]?.value_json);
}

/**
 * Turns a client touch into the shop partner it credits for one product, or null.
 * @returns {Promise<{ salerId: number, shortLinkId: number|null, source: string } | null>}
 */
export async function resolveTouch(
  db: any,
  { touch, productId, buyerId = null, now = new Date(), windowDays = null }:
    { touch: any; productId: number; buyerId?: number | null; now?: Date; windowDays?: number | null }
): Promise<{ salerId: number; shortLinkId: number | null; source: string } | null> {
  const t = normalizeTouch(touch);
  if (!t || !productId) return null;
  const days = windowDays ?? await loadWindowDays(db);
  if (!isWithinWindow(t.at, now, days)) return null;

  let credit = null;
  if (t.type === 'STORE') {
    const { rows } = await db.query(
      `SELECT saler_id FROM virtual_stores WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
      [t.ref]
    );
    if (rows[0]) credit = { salerId: Number(rows[0].saler_id), shortLinkId: null, source: SOURCE.STOREFRONT };
  } else {
    const { rows } = await db.query(`SELECT id, saler_id FROM short_links WHERE code = $1 LIMIT 1`, [t.ref]);
    if (rows[0]) credit = { salerId: Number(rows[0].saler_id), shortLinkId: Number(rows[0].id), source: SOURCE.SHORT_LINK };
  }
  if (!credit) return null;
  if (buyerId != null && Number(buyerId) === credit.salerId) return null;

  const carries = await salerCarriesProduct(db, credit.salerId, productId);
  return carries ? credit : null;
}

export async function salerCarriesProduct(db: any, salerId: number, productId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM saler_store_items WHERE saler_id = $1 AND product_id = $2 AND is_active LIMIT 1`,
    [salerId, productId]
  );
  return rows.length > 0;
}

/**
 * Picks the one shop partner a supplier's parcel pays. A parcel pays one partner (sub_orders.saler_id),
 * so when its lines came through different partners the one whose lines are worth most wins; a tie
 * goes to the line added first. Unattributed lines never win over an attributed one.
 *
 * WHY not split the parcel per partner: the delivery charge, the coupon share and the courier
 * shipment are all per supplier parcel. Mixed parcels are rare, the per-line partner is kept on
 * order_items.saler_id, and the earning engine (Phase C) pays per line from it.
 *
 * @param {{ salerId: number|null, shortLinkId?: number|null, source?: string|null, lineTotalPaisa: number }[]} lines
 * @returns {{ salerId: number|null, shortLinkId: number|null, source: string|null }}
 */
export function pickParcelSaler(
  lines: { salerId: number | null; shortLinkId?: number | null; source?: string | null; lineTotalPaisa: number }[]
): { salerId: number | null; shortLinkId: number | null; source: string | null } {
  const bySaler = new Map();
  for (const line of lines) {
    if (line.salerId == null) continue;
    const entry = bySaler.get(line.salerId) || { total: 0, first: line };
    entry.total += line.lineTotalPaisa;
    bySaler.set(line.salerId, entry);
  }
  let best = null;
  for (const [salerId, entry] of bySaler) {
    if (!best || entry.total > best.total) best = { salerId, ...entry };
  }
  if (!best) return { salerId: null, shortLinkId: null, source: null };
  return { salerId: best.salerId, shortLinkId: best.first.shortLinkId ?? null, source: best.first.source ?? null };
}

/**
 * The page a short link opens, carrying the link code so the client can record the touch.
 * Old links stored `?saler_ref=<user id>` in their target; that parameter is dropped so a user id
 * never reaches the address bar.
 */
export function landingPathFor(targetUrl: string, code: string): string {
  // WHY a placeholder base: URL needs one to parse a relative target; only path and query are kept.
  const url = new URL(targetUrl || '/', 'http://placeholder.invalid');
  url.searchParams.delete('saler_ref');
  url.searchParams.set('ref', code);
  return `${url.pathname}${url.search}`;
}
