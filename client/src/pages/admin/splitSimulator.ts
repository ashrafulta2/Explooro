/**
 * splitSimulator.ts — the Profit Split page's simulator arithmetic, the way a sale is really split.
 *
 * WHY its own file: the old simulator modelled shop partners pricing above a suggested retail
 * (default/discount/boost tiers with an 80/20 surplus split). Partner prices are locked since
 * migration 085, so that arithmetic described sales that cannot happen. This mirrors the live path:
 *   - the supplier enters their own price; the platform adds the markup and rounds the retail price up
 *     (services/retailMarkup.ts, the client copy of retailMarkup.service.ts);
 *   - the partner share defaults to `saler_split_pct` of the margin, capped so the platform keeps
 *     `platform_default_profit_pct` of the supplier price (product.service `defaultPartnerProfit` +
 *     pricing.service `assertPartnerProfitFits`);
 *   - checkout escrows that share to the partner reward pool and the rest of the margin to the platform.
 * Everything is in paisa so the three parts always add up to the retail price.
 */

import { retailFromSupplierPrice } from '../../services/retailMarkup.ts';

export interface SplitInput {
  /** The supplier's own price per unit, BDT. */
  supplierPrice: number;
  /** The markup the platform adds, % of the supplier price. */
  markupPct: number;
  /** Retail is rounded up to this many taka; 0 = exact. */
  roundToBdt: number;
  /** `saler_split_pct`: the partner pool's % of the margin. */
  partnerSharePct: number;
  /** `platform_default_profit_pct`: the platform's minimum, as a % of the supplier price. */
  platformFloorPct: number;
}

export interface SplitResult {
  retail: number;
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

/** Returns null when the inputs cannot describe a product (no price, a negative markup). */
export function simulateSplit({ supplierPrice, markupPct, roundToBdt, partnerSharePct, platformFloorPct }: SplitInput): SplitResult | null {
  if (!(supplierPrice > 0) || !(markupPct >= 0)) return null;
  const supplierPaisa = Math.round(supplierPrice * 100);
  const retailPaisa = Math.round(retailFromSupplierPrice(supplierPrice, markupPct, roundToBdt) * 100);
  const marginPaisa = retailPaisa - supplierPaisa;
  const floorPaisa = Math.round((supplierPaisa * (Number(platformFloorPct) || 0)) / 100);
  const maxPartnerPaisa = Math.max(marginPaisa - floorPaisa, 0);
  const fromSplitPaisa = Math.floor((marginPaisa * (Number(partnerSharePct) || 0)) / 100);
  const partnerPaisa = Math.min(fromSplitPaisa, maxPartnerPaisa);
  const platformPaisa = marginPaisa - partnerPaisa;

  const supplierPct = Math.round((supplierPaisa / retailPaisa) * 100);
  const partnerPct = Math.min(100 - supplierPct, Math.round((partnerPaisa / retailPaisa) * 100));
  return {
    retail: retailPaisa / 100,
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
