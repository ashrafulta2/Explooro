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

/** A list row as the home flash strip reads it. */
export interface FlashStripSource extends FlashDealSource {
  isSponsored?: boolean;
  /** When the live deal ends (ISO string from GET /products). */
  flash_ends_at?: string | number | null;
}

function endsAtMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The products the home flash strip may show: ones with a live flash sale that has not ended.
 * WHY: the strip used to fill itself with the first ten ordinary products, tagged SALE, whenever no
 * deal was running. A product whose deal has no known end is kept (the server only lists live
 * deals); one whose end has passed is dropped, since a loaded page outlives its deals.
 */
export function liveFlashDeals<T extends FlashStripSource>(products: T[] | null | undefined, now: number = Date.now()): T[] {
  return (products || []).filter((p) => {
    if (!p || p.isSponsored || !p.is_flash_sale) return false;
    const end = endsAtMs(p.flash_ends_at);
    return end === null || end > now;
  });
}

/**
 * When the strip's countdown reaches zero: the earliest end among the deals it shows, or null when
 * none carries an end time (then no countdown is drawn). WHY: it used to be a fixed now + 4 hours.
 */
export function flashStripEndsAt(products: FlashStripSource[] | null | undefined, now: number = Date.now()): number | null {
  let earliest: number | null = null;
  for (const p of liveFlashDeals(products, now)) {
    const end = endsAtMs(p.flash_ends_at);
    if (end !== null && (earliest === null || end < earliest)) earliest = end;
  }
  return earliest;
}
