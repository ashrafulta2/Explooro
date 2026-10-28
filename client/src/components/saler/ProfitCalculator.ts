/**
 * ProfitCalculator.ts — Interactive profit calculator driven strictly by the server
 * pricing preview API (Prompt 4.7).
 *
 * Invariant: The client NEVER calculates split arithmetic locally. All breakdown numbers
 * (wholesale cost, net margin, shop partner earnings, platform earnings) come directly from
 * previewPricing (POST /api/v1/pricing/preview).
 */
import { previewPricing } from '../../services/catalog.api.ts';
import { formatCurrency } from '../../services/format.ts';
import { t, getLanguage } from '../../services/i18n.ts';

/** The answer to POST /pricing/preview: the fields the calculator draws. */
export interface PricingBreakdown {
  min_retail_price?: number;
  retail_price: number;
  saler_earning: number;
  saler_default_earning: number;
  saler_margin_pct: number | string;
  price_status: 'DISCOUNTED' | 'BOOSTED' | 'STANDARD' | string;
  [field: string]: unknown;
}

export interface ProfitCalculatorOptions {
  initialBaseCost?: number;
  initialWholesaleMargin?: number;
  initialRetailPrice?: number;
  initialDefaultRetailPrice?: number;
  productId?: string | number | null;
  categoryId?: number | null;
  /** Called whenever the breakdown updates. */
  onChange?: ((breakdown: PricingBreakdown) => void) | null;
}

/** The root element, with the control API callers (e.g. AddToStoreDrawer) drive it by. */
export interface ProfitCalculatorElement extends HTMLDivElement {
  setValues(base?: number | string, wholesale?: number | string, retail?: number | string, defaultRetail?: number | string): void;
  getBreakdown(): PricingBreakdown | null;
}

/** Creates an interactive profit calculator component. */
export function ProfitCalculator({
  initialBaseCost = 500,
  initialWholesaleMargin = 0,
  initialRetailPrice = 700,
  initialDefaultRetailPrice = 700,
  productId = null,
  categoryId = null,
  onChange = null,
}: ProfitCalculatorOptions = {}): ProfitCalculatorElement {
  const container = document.createElement('div') as ProfitCalculatorElement;
  container.className = 'profit-calc';

  let baseCost = Number(initialBaseCost) || 500;
  let wholesaleMargin = Number(initialWholesaleMargin) || 0;
  let retailPrice = Number(initialRetailPrice) || 700;
  let defaultRetailPrice = Number(initialDefaultRetailPrice) || retailPrice;
  let minRetailPrice = Math.round((baseCost + wholesaleMargin) * 1.1);

  let currentBreakdown: PricingBreakdown | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingAbort: AbortController | null = null;

  // Header
  const header = document.createElement('div');
  header.className = 'profit-calc__header';

  const title = document.createElement('h3');
  title.className = 'profit-calc__title';
  title.textContent = t('sourcing.calc.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'profit-calc__subtitle';
  subtitle.textContent = t('sourcing.calc.subtitle');

  header.append(title, subtitle);

  // Status Banner for Dynamic Pricing Feedback
  const statusBanner = document.createElement('div');
  statusBanner.className = 'profit-calc__status profit-calc__status--standard';
  statusBanner.textContent = `✨ ${t('sourcing.calc.standard_hint', 'Standard Suggested Price: You earn the full default profit.')}`;

  // Sliders Section
  const slidersSec = document.createElement('div');
  slidersSec.className = 'profit-calc__sliders';

  // Desired Retail Price Field
  const retailPriceField = createSliderField({
    label: t('sourcing.calc.retail_price'),
    min: minRetailPrice || 100,
    max: Math.max(15000, retailPrice * 2),
    step: 10,
    value: retailPrice,
    onInput: (val) => {
      retailPrice = val;
      triggerCalculation();
    },
  });

  slidersSec.append(retailPriceField.element);

  // Error Banner
  const errorBanner = document.createElement('div');
  errorBanner.className = 'profit-calc__error';
  errorBanner.style.display = 'none';

  // Breakdown Cards (Confidential wholesale: shows Min Floor, Customer Price, and Your Profit)
  const breakdownGrid = document.createElement('div');
  breakdownGrid.className = 'profit-calc__breakdown';

  const minPriceCard = createCard(
    t('sourcing.calc.min_selling_price', 'Minimum Selling Price'),
    '৳ 0.00',
    t('sourcing.drawer.min_price_hint', 'Must be at least minimum selling price')
  );
  const retailPriceCard = createCard(
    t('sourcing.calc.customer_retail_price', 'Customer Retail Price'),
    '৳ 0.00',
    t('sourcing.calc.your_selling_price', 'Your Selling Price')
  );
  const salerEarningCard = createCard(
    t('sourcing.calc.your_profit'),
    '৳ 0.00',
    '',
    true
  );

  breakdownGrid.append(minPriceCard.element, retailPriceCard.element, salerEarningCard.element);

  // Split Visual Bar
  const barWrap = document.createElement('div');
  barWrap.className = 'profit-calc__bar-wrap';

  const barLabel = document.createElement('div');
  barLabel.className = 'profit-calc__bar-label';
  const barLabelLeft = document.createElement('span');
  barLabelLeft.textContent = t('sourcing.calc.margin_performance', 'Shop Partner Profit Margin');
  const barLabelRight = document.createElement('span');
  barLabelRight.textContent = '';
  barLabel.append(barLabelLeft, barLabelRight);

  const bar = document.createElement('div');
  bar.className = 'profit-calc__bar';

  const segSaler = document.createElement('div');
  segSaler.className = 'profit-calc__bar-seg profit-calc__bar-seg--saler';
  segSaler.style.width = '0%';

  bar.append(segSaler);

  // Legend
  const legend = document.createElement('div');
  legend.className = 'profit-calc__legend';

  legend.append(
    createLegendItem('var(--brand-600)', t('sourcing.calc.your_profit'))
  );

  barWrap.append(barLabel, bar, legend);

  container.append(header, statusBanner, slidersSec, errorBanner, breakdownGrid, barWrap);

  async function fetchPreview() {
    if (pendingAbort) {
      pendingAbort.abort();
    }
    const ac = new AbortController();
    pendingAbort = ac;

    try {
      const breakdown = await previewPricing({
        baseCost,
        wholesaleMargin,
        retailPrice,
        defaultRetailPrice,
        categoryId,
        productId,
        mode: 'tiered',
      });

      if (ac.signal.aborted) return;

      currentBreakdown = breakdown;
      errorBanner.style.display = 'none';

      // Update minimum floor if returned
      if (breakdown.min_retail_price) {
        minRetailPrice = breakdown.min_retail_price;
        retailPriceField.setMin?.(minRetailPrice);
      }

      // Update Breakdown cards with server-authoritative numbers
      minPriceCard.setValue(formatCurrency(breakdown.min_retail_price));
      retailPriceCard.setValue(formatCurrency(breakdown.retail_price));
      retailPriceCard.setSub(t('sourcing.calc.your_selling_price', 'Your Selling Price'));
      salerEarningCard.setValue(formatCurrency(breakdown.saler_earning));
      salerEarningCard.setSub(
        `${t('sourcing.calc.saler_margin')}: ${breakdown.saler_margin_pct}%`
      );

      // Update Dynamic Status Feedback
      if (breakdown.price_status === 'DISCOUNTED') {
        statusBanner.className = 'profit-calc__status profit-calc__status--discount';
        statusBanner.textContent = `🏷️ ${t('sourcing.calc.discount_hint', 'Discounted Price: Platform cost is protected. Only your profit is adjusted.')}`;
      } else if (breakdown.price_status === 'BOOSTED') {
        statusBanner.className = 'profit-calc__status profit-calc__status--boost';
        const extraProfit = Math.max(0, breakdown.saler_earning - breakdown.saler_default_earning);
        statusBanner.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 3.81-2 24.36 24.36 0 0 1 5.9-2c3.55-1 6-4 6-4s-3 2.45-4 6a24.36 24.36 0 0 1-2 5.9A22 22 0 0 1 15 12z"></path><path d="M9 11l.01-.01"></path></svg> ${t('sourcing.calc.boost_hint', 'Extra Markup Bonus: Extra profit added to your earnings!')} (+${formatCurrency(extraProfit)})`;
      } else {
        statusBanner.className = 'profit-calc__status profit-calc__status--standard';
        statusBanner.textContent = `✨ ${t('sourcing.calc.standard_hint', 'Standard Suggested Price: You earn the full default profit.')}`;
      }

      // Update Visual Margin Bar
      const marginPct = Math.min(100, Math.max(0, parseFloat(breakdown.saler_margin_pct) || 0));
      segSaler.style.width = `${marginPct}%`;
      segSaler.title = `${t('sourcing.calc.your_profit')}: ${formatCurrency(breakdown.saler_earning)} (${marginPct}%)`;

      barLabelRight.textContent = `${marginPct}% (${formatCurrency(breakdown.saler_earning)})`;

      if (typeof onChange === 'function') {
        onChange(breakdown);
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      const isBn = getLanguage() === 'bn';
      const msg = (isBn && err?.message_bn) ? err.message_bn : (err?.message || err?.message_en || t('sourcing.calc.error_below_min'));
      errorBanner.textContent = `⚠️ ${msg}`;
      errorBanner.style.display = 'flex';

      minPriceCard.setValue('—');
      retailPriceCard.setValue('—');
      salerEarningCard.setValue('—');
      segSaler.style.width = '0%';
      barLabelRight.textContent = '';
    }
  }

  function triggerCalculation() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchPreview, 150);
  }

  // Initial calculation
  fetchPreview();

  // Public control API for external callers (e.g. AddToStoreDrawer)
  container.setValues = (newBase?: number | string, newWholesale?: number | string, newRetail?: number | string, newDefaultRetail?: number | string) => {
    if (newBase !== undefined) {
      baseCost = Number(newBase);
    }
    if (newWholesale !== undefined) {
      wholesaleMargin = Number(newWholesale);
    }
    if (newRetail !== undefined) {
      retailPrice = Number(newRetail);
      retailPriceField.setValue(retailPrice);
    }
    if (newDefaultRetail !== undefined) {
      defaultRetailPrice = Number(newDefaultRetail);
    } else if (newRetail !== undefined) {
      defaultRetailPrice = Number(newRetail);
    }
    triggerCalculation();
  };

  container.getBreakdown = () => currentBreakdown;

  return container;
}

interface SliderFieldOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onInput: (value: number) => void;
}

function createSliderField({ label, min, max, step, value, onInput }: SliderFieldOptions) {
  const element = document.createElement('div');
  element.className = 'profit-calc__field';

  const header = document.createElement('div');
  header.className = 'profit-calc__field-header';

  const lbl = document.createElement('span');
  lbl.className = 'profit-calc__field-label';
  lbl.textContent = label;

  const displayVal = document.createElement('span');
  displayVal.className = 'profit-calc__field-val';
  displayVal.textContent = formatCurrency(value);

  header.append(lbl, displayVal);

  const wrap = document.createElement('div');
  wrap.className = 'profit-calc__input-wrap';

  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'profit-calc__range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);
  range.setAttribute('aria-label', label);

  const numInput = document.createElement('input');
  numInput.type = 'number';
  numInput.className = 'profit-calc__num-input';
  numInput.min = String(min);
  numInput.max = String(max * 2);
  numInput.step = String(step);
  numInput.value = String(value);
  numInput.setAttribute('aria-label', `${label} numeric input`);

  function sync(v: number | string) {
    const num = Math.max(0, Number(v) || 0);
    range.value = String(Math.min(num, max));
    numInput.value = String(num);
    displayVal.textContent = formatCurrency(num);
    onInput(num);
  }

  range.addEventListener('input', (e) => sync((e.target as HTMLInputElement).value));
  numInput.addEventListener('input', (e) => sync((e.target as HTMLInputElement).value));

  wrap.append(range, numInput);
  element.append(header, wrap);

  return {
    element,
    setValue: (val: number) => {
      range.value = String(Math.min(val, max));
      numInput.value = String(val);
      displayVal.textContent = formatCurrency(val);
    },
    setMin: (minVal: number) => {
      range.min = String(minVal);
      numInput.min = String(minVal);
    },
  };
}

function createCard(title: string, initialValue: string, initialSub: string, isHighlight = false) {
  const element = document.createElement('div');
  element.className = `profit-calc__card ${isHighlight ? 'profit-calc__card--highlight' : ''}`;

  const lbl = document.createElement('span');
  lbl.className = 'profit-calc__card-label';
  lbl.textContent = title;

  const val = document.createElement('span');
  val.className = 'profit-calc__card-val';
  val.textContent = initialValue;

  const sub = document.createElement('span');
  sub.className = 'profit-calc__card-sub';
  sub.textContent = initialSub;

  element.append(lbl, val, sub);

  return {
    element,
    setValue: (v: string) => { val.textContent = v; },
    setSub: (s: string) => { sub.textContent = s; },
  };
}

function createLegendItem(color: string, label: string) {
  const item = document.createElement('div');
  item.className = 'profit-calc__legend-item';

  const dot = document.createElement('span');
  dot.className = 'profit-calc__legend-dot';
  dot.style.background = color;

  const text = document.createElement('span');
  text.textContent = label;

  item.append(dot, text);
  return item;
}
