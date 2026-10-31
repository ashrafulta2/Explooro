/**
 * splitSimulator.ts — the Profit Split page's simulator arithmetic, the way a sale is really split.
 *
 * WHY its own file: the old simulator modelled shop partners pricing above a suggested retail
 * (default/discount/boost tiers with an 80/20 surplus split). Partner prices are locked since
 * migration 085, so that arithmetic described sales that cannot happen. This mirrors the live path:
 *   - the supplier product form turns retail price + share % into the supplier payout
 *     (CatalogProductsPage `wireSupplierPayout`, base_cost on the server);
 *   - the partner share defaults to `saler_split_pct` of the margin, capped so the platform keeps
 *     `platform_default_profit_pct` of the payout (product.service `defaultPartnerProfit` +
 *     pricing.service `assertPartnerProfitFits`);
 *   - checkout escrows that share to the partner reward pool and the rest of the margin to the platform.
 * Everything is in paisa so the three parts always add up to the retail price.
 */

export interface SplitInput {
  /** Retail price the customer pays, BDT. */
  price: number;
  /** "Platform & partner share %" from the supplier form: the margin as a % of retail. */
  marginPct: number;
  /** `saler_split_pct`: the partner pool's % of the margin. */
  partnerSharePct: number;
  /** `platform_default_profit_pct`: the platform's minimum, as a % of the supplier payout. */
  platformFloorPct: number;
}

export interface SplitResult {
  supplier: number;
  margin: number;
  partnerPool: number;
  platform: number;
  platformFloor: number;
  /** The partner share was cut so the platform keeps its floor. */
  partnerCapped: boolean;
  /** The whole margin is smaller than the platform floor, so the platform gets less than its minimum. */
  marginBelowFloor: boolean;
  /** Whole-number shares of the retail price for the bar; they add up to 100. */
  pct: { supplier: number; partnerPool: number; platform: number };
}

const toPaisa = (bdt: number) => Math.round((Number(bdt) || 0) * 100);

/** Returns null when the inputs cannot describe a product (no price, share outside 0–99). */
export function simulateSplit({ price, marginPct, partnerSharePct, platformFloorPct }: SplitInput): SplitResult | null {
  if (!(price > 0) || !(marginPct >= 0 && marginPct < 100)) return null;
  const retailPaisa = toPaisa(price);
  // Same rounding as the supplier form, so the simulator quotes the payout the supplier is shown.
  const supplierPaisa = toPaisa(Math.round(price * (1 - marginPct / 100) * 100) / 100);
  const marginPaisa = retailPaisa - supplierPaisa;
  const floorPaisa = Math.round((supplierPaisa * (Number(platformFloorPct) || 0)) / 100);
  const maxPartnerPaisa = Math.max(marginPaisa - floorPaisa, 0);
  const fromSplitPaisa = Math.floor((marginPaisa * (Number(partnerSharePct) || 0)) / 100);
  const partnerPaisa = Math.min(fromSplitPaisa, maxPartnerPaisa);
  const platformPaisa = marginPaisa - partnerPaisa;

  const supplierPct = Math.round((supplierPaisa / retailPaisa) * 100);
  const partnerPct = Math.min(100 - supplierPct, Math.round((partnerPaisa / retailPaisa) * 100));
  return {
    supplier: supplierPaisa / 100,
    margin: marginPaisa / 100,
    partnerPool: partnerPaisa / 100,
    platform: platformPaisa / 100,
    platformFloor: floorPaisa / 100,
    partnerCapped: partnerPaisa < fromSplitPaisa,
    marginBelowFloor: marginPaisa < floorPaisa,
    pct: { supplier: supplierPct, partnerPool: partnerPct, platform: 100 - supplierPct - partnerPct },
  };
}
