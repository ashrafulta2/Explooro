/**
 * PriceBreakdown — retail price for everyone, full margin breakdown for Shop Partners only (Prompt 4.6).
 *
 * WHY the margin numbers come from the server's `pricing` object (product.service.ts's
 * calculateProductPricing, backed by pricing.service.ts's split arithmetic) rather than being
 * computed here: a divergence between client and server maths is a financial bug (the same
 * invariant Prompt 4.7's profit calculator enforces via POST /pricing/preview) — this component
 * only ever renders numbers it was handed, never derives its own.
 */
import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';

function row(labelKey: string, amount: number | string, lang: string, { emphasize = false }: { emphasize?: boolean } = {}): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `price-breakdown__row${emphasize ? ' price-breakdown__row--emphasis' : ''}`;
  const label = document.createElement('span');
  label.className = 'price-breakdown__label';
  label.textContent = t(labelKey);
  const value = document.createElement('span');
  value.className = 'price-breakdown__value';
  value.textContent = formatCurrency(amount, { lang });
  el.append(label, value);
  return el;
}

/** The server's `pricing` object (product.service.ts calculateProductPricing); this file only renders it. */
export interface ProductPricing {
  base_cost: number | string;
  wholesale_margin: number | string;
  net_retail_margin: number | string;
  saler_earning: number | string;
  /** Shown to admins only. */
  platform_earning?: number | string;
  saler_split_pct?: number | string;
  platform_split_pct?: number | string;
}

export interface PriceBreakdownOptions {
  retailPrice?: number | string | null;
  pricing?: ProductPricing | null;
  role?: 'customer' | 'saler' | 'admin' | 'super_admin' | string;
  /** Which modules are on; the margin block needs `sourcing`. */
  modules?: Record<string, boolean>;
  lang?: string;
}

export function PriceBreakdown({
  retailPrice,
  pricing = null,
  role = 'customer',
  modules = {},
  lang = 'en',
}: PriceBreakdownOptions = {}): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'price-breakdown';

  const retailRow = document.createElement('div');
  retailRow.className = 'price-breakdown__retail';
  retailRow.textContent = formatCurrency(retailPrice, { lang });
  root.append(retailRow);

  const isAdmin = role === 'admin' || role === 'super_admin';
  const canViewMargins = (role === 'saler' || isAdmin) && modules.sourcing && pricing;
  if (!canViewMargins) {
    return root;
  }

  const details = document.createElement('div');
  details.className = 'price-breakdown__details';
  details.setAttribute('data-module', 'sourcing');

  const heading = document.createElement('p');
  heading.className = 'price-breakdown__heading';
  heading.textContent = t('product_detail.price.saler_breakdown_heading');
  details.append(heading);

  details.append(
    row('product_detail.price.base_cost', pricing.base_cost, lang),
    row('product_detail.price.wholesale_margin', pricing.wholesale_margin, lang),
    row('product_detail.price.net_retail_margin', pricing.net_retail_margin, lang),
    row('product_detail.price.your_earning', pricing.saler_earning, lang, { emphasize: true })
  );

  // Platform profit and split percentages are strictly restricted to Super Admin / Admin
  if (isAdmin) {
    details.append(
      row('product_detail.price.platform_earning', pricing.platform_earning, lang)
    );

    const splitNote = document.createElement('p');
    splitNote.className = 'price-breakdown__split-note';
    splitNote.textContent = t('product_detail.price.split_note', {
      saler_pct: pricing.saler_split_pct,
      platform_pct: pricing.platform_split_pct,
    });
    details.append(splitNote);
  }

  root.append(details);
  return root;
}
