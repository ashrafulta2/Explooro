/**
 * retailMarkup.ts — the client copy of the retail price rule, so the supplier form can quote it live.
 *
 * The server (`server/src/services/retailMarkup.service.ts`) is the one that stores the price; this
 * only previews it. `server/test/retailMarkup.test.js` runs both on the same inputs and fails if they
 * ever disagree. Retail = supplier price + markup %, rounded UP to `round_to_bdt` taka (0 = no rounding).
 */

export interface MarkupPolicy {
  default_markup_pct: number;
  round_to_bdt: number;
  /** category id → markup %, only categories with an override. */
  categories: Record<string, number>;
}

/** Retail price (BDT) for a supplier price. Paisa throughout, like the NUMERIC(14,2) column. */
export function retailFromSupplierPrice(supplierPrice: number | string, markupPct: number, roundToBdt: number): number {
  const pricePaisa = Math.round((Number(supplierPrice) || 0) * 100);
  const rawPaisa = Math.round((pricePaisa * (100 + Number(markupPct || 0))) / 100);
  const stepPaisa = Math.round(Number(roundToBdt || 0) * 100);
  const retailPaisa = stepPaisa > 0 ? Math.ceil(rawPaisa / stepPaisa) * stepPaisa : rawPaisa;
  return retailPaisa / 100;
}

/** The markup a category uses: its override, else the default. */
export function markupForCategory(policy: MarkupPolicy, categoryId: unknown): number {
  const key = categoryId == null ? '' : String(categoryId);
  return key && policy.categories?.[key] !== undefined ? policy.categories[key] : policy.default_markup_pct;
}
