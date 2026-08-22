/**
 * PriceBreakdown — retail price for everyone, full margin breakdown for Salers only (Prompt 4.6).
 *
 * WHY the margin numbers come from the server's `pricing` object (product.service.js's
 * calculateProductPricing, backed by pricing.service.js's split arithmetic) rather than being
 * computed here: a divergence between client and server maths is a financial bug (the same
 * invariant Prompt 4.7's profit calculator enforces via POST /pricing/preview) — this component
 * only ever renders numbers it was handed, never derives its own.
 */
import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';

function row(labelKey, amount, lang, { emphasize = false } = {}) {
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

export function PriceBreakdown({ retailPrice, pricing = null, role = 'customer', modules = {}, lang = 'en' } = {}) {
  const root = document.createElement('div');
  root.className = 'price-breakdown';

  const retailRow = document.createElement('div');
  retailRow.className = 'price-breakdown__retail';
  retailRow.textContent = formatCurrency(retailPrice, { lang });
  root.append(retailRow);

  // WHY: identical gate to ProductCard.js's margin badge — Salers only, and only when the
  // `sourcing` module is on. Showing platform economics to a Customer would be a real leak.
  if (role !== 'saler' || !modules.sourcing || !pricing) {
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
    row('product_detail.price.your_earning', pricing.saler_earning, lang, { emphasize: true }),
    row('product_detail.price.platform_earning', pricing.platform_earning, lang)
  );

  const splitNote = document.createElement('p');
  splitNote.className = 'price-breakdown__split-note';
  splitNote.textContent = t('product_detail.price.split_note', {
    saler_pct: pricing.saler_split_pct,
    platform_pct: pricing.platform_split_pct,
  });
  details.append(splitNote);

  root.append(details);
  return root;
}
