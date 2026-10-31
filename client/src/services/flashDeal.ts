/**
 * flashDeal — what a product card may honestly say about a flash sale.
 *
 * Pure (no imports, no DOM) so client/test/flashDeal.test.js can run it directly.
 *
 * WHY this exists: the card used to invent a "was" price as `price × 1.25` whenever a product was
 * flagged as a flash sale, so every deal read "20% OFF" against a price nobody ever charged, and
 * the "Claimed" bar was derived from stock + 15 clamped to 35–95%. The real deal price
 * (`flash_discount_price`) was never shown. A strikethrough is a price claim to the shopper, so it
 * may only ever come from data:
 *  - the deal price is `flash_discount_price` from the live flash sale (GET /products LEFT JOIN);
 *  - the struck price is the product's current regular price (`price`), which is exactly what
 *    checkout charges once the deal is used up (flashSale.service prices against it);
 *  - "Claimed" is `flash_sold_qty / flash_allocated_qty` of that deal.
 * Anything missing means that part is not drawn. Nothing is ever estimated.
 */

export interface FlashDealSource {
  price?: number | string | null;
  /** A caller-supplied real compare-at price (e.g. a markdown). Never computed here. */
  original_price?: number | string | null;
  is_flash_sale?: boolean;
  flash_discount_price?: number | string | null;
  flash_allocated_qty?: number | string | null;
  flash_sold_qty?: number | string | null;
}

export interface FlashDealView {
  /** The price the shopper pays now. */
  price: number;
  /** The struck-through regular price, or null when there is no real one to show. */
  wasPrice: number | null;
  /** Whole-percent saving, or null when there is no struck price. */
  pctOff: number | null;
  /** Share of the deal's allocation already sold (0–100), or null when unknown. */
  claimedPct: number | null;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

export function flashDealView(product: FlashDealSource | null | undefined): FlashDealView {
  const p = product || {};
  const regular = num(p.price);
  let price = regular;
  let wasPrice: number | null = null;

  const deal = num(p.flash_discount_price);
  if (p.is_flash_sale && deal > 0 && deal < regular) {
    price = deal;
    wasPrice = regular;
  } else {
    const original = num(p.original_price);
    if (original > regular && regular > 0) wasPrice = original;
  }

  const pctOff = wasPrice ? Math.round(((wasPrice - price) / wasPrice) * 100) : null;

  let claimedPct: number | null = null;
  const allocated = num(p.flash_allocated_qty);
  if (p.is_flash_sale && allocated > 0) {
    const sold = Math.max(0, num(p.flash_sold_qty));
    claimedPct = Math.min(100, Math.round((sold / allocated) * 100));
  }

  return { price, wasPrice, pctOff: pctOff && pctOff > 0 ? pctOff : null, claimedPct };
}

/** A list row as the home flash strip receives it. */
export interface FlashStripRow extends FlashDealSource {
  isSponsored?: boolean;
  /** The live deal's end (GET /products LEFT JOIN flash_sales, `fs.ends_at`). */
  flash_ends_at?: string | number | Date | null;
}

/** `flash_ends_at` as epoch ms, or null when the row carries no usable end time. */
export function flashEndsAtMs(row: FlashStripRow | null | undefined): number | null {
  const raw = row?.flash_ends_at;
  if (raw == null || raw === '') return null;
  const ms = raw instanceof Date ? raw.getTime() : typeof raw === 'number' ? raw : Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The rows the home flash strip may show as deals: flagged by the server as a live flash sale and
 * not already past their end. Nothing is ever promoted to a deal here — no flagged row, no strip.
 *
 * WHY: the strip used to fall back to the first ten ordinary products (and force `is_flash_sale`
 * on each) when no deal was live, so shoppers saw a SALE tag on products nobody had discounted.
 * A row without `flash_ends_at` is kept (the server already filtered to `now() BETWEEN starts_at
 * AND ends_at`); it simply does not drive the countdown.
 */
export function liveFlashDeals<T extends FlashStripRow>(rows: readonly T[] | null | undefined, now: number = Date.now()): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    if (!row || row.isSponsored || row.is_flash_sale !== true) return false;
    const end = flashEndsAtMs(row);
    return end == null || end > now;
  });
}

/**
 * When the strip's countdown ends: the earliest real `flash_ends_at` among the deals shown, so the
 * timer never runs past a deal on screen. Null when no deal carries an end time — the caller then
 * draws no countdown rather than inventing one.
 */
export function flashStripEndsAt(deals: readonly FlashStripRow[] | null | undefined, now: number = Date.now()): number | null {
  let earliest: number | null = null;
  for (const row of deals || []) {
    const end = flashEndsAtMs(row);
    if (end != null && end > now && (earliest == null || end < earliest)) earliest = end;
  }
  return earliest;
}
