/**
 * ProfitCalculator.js — Interactive profit calculator driven strictly by the server
 * pricing preview API (Prompt 4.7).
 *
 * Invariant: The client NEVER calculates split arithmetic locally. All breakdown numbers
 * (wholesale cost, net margin, saler earnings, platform earnings) come directly from
 * previewPricing (POST /api/v1/pricing/preview).
 */
import { previewPricing } from '../../services/catalog.api.js';
import { formatCurrency } from '../../services/format.js';
import { t, getLanguage } from '../../services/i18n.js';

/**
 * Creates an interactive profit calculator component.
 *
 * @param {object} props
 * @param {number} [props.initialBaseCost=500]
 * @param {number} [props.initialWholesaleMargin=0]
 * @param {number} [props.initialRetailPrice=700]
 * @param {string|number} [props.productId]
 * @param {number} [props.categoryId]
 * @param {Function} [props.onChange] Callback when breakdown updates
 * @returns {HTMLElement}
 */
export function ProfitCalculator({
  initialBaseCost = 500,
  initialWholesaleMargin = 0,
  initialRetailPrice = 700,
  productId = null,
  categoryId = null,
  onChange = null,
} = {}) {
  const container = document.createElement('div');
  container.className = 'profit-calc';

  let baseCost = Number(initialBaseCost) || 500;
  let wholesaleMargin = Number(initialWholesaleMargin) || 0;
  let retailPrice = Number(initialRetailPrice) || 700;
  let currentBreakdown = null;
  let debounceTimer = null;
  let pendingAbort = null;

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

  // Sliders Section
  const slidersSec = document.createElement('div');
  slidersSec.className = 'profit-calc__sliders';

  // Base Cost Field
  const baseCostField = createSliderField({
    label: t('sourcing.calc.base_cost'),
    min: 50,
    max: 10000,
    step: 10,
    value: baseCost,
    onInput: (val) => {
      baseCost = val;
      triggerCalculation();
    },
  });

  // Wholesale Margin Field
  const wholesaleMarginField = createSliderField({
    label: t('sourcing.calc.wholesale_margin'),
    min: 0,
    max: 5000,
    step: 5,
    value: wholesaleMargin,
    onInput: (val) => {
      wholesaleMargin = val;
      triggerCalculation();
    },
  });

  // Desired Retail Price Field
  const retailPriceField = createSliderField({
    label: t('sourcing.calc.retail_price'),
    min: 50,
    max: 15000,
    step: 10,
    value: retailPrice,
    onInput: (val) => {
      retailPrice = val;
      triggerCalculation();
    },
  });

  slidersSec.append(baseCostField.element, wholesaleMarginField.element, retailPriceField.element);

  // Error Banner
  const errorBanner = document.createElement('div');
  errorBanner.className = 'profit-calc__error';
  errorBanner.style.display = 'none';

  // Breakdown Cards
  const breakdownGrid = document.createElement('div');
  breakdownGrid.className = 'profit-calc__breakdown';

  const wholesaleCostCard = createCard(t('sourcing.calc.wholesale_cost'), '৳ 0.00', t('sourcing.calc.base_plus_wholesale'));
  const salerEarningCard = createCard(t('sourcing.calc.your_profit'), '৳ 0.00', '40% split', true);
  const platformEarningCard = createCard(t('sourcing.calc.platform_share'), '৳ 0.00', '60% split');

  breakdownGrid.append(wholesaleCostCard.element, salerEarningCard.element, platformEarningCard.element);

  // Split Visual Bar
  const barWrap = document.createElement('div');
  barWrap.className = 'profit-calc__bar-wrap';

  const barLabel = document.createElement('div');
  barLabel.className = 'profit-calc__bar-label';
  const barLabelLeft = document.createElement('span');
  barLabelLeft.textContent = t('sourcing.calc.price_distribution');
  const barLabelRight = document.createElement('span');
  barLabelRight.textContent = '';
  barLabel.append(barLabelLeft, barLabelRight);

  const bar = document.createElement('div');
  bar.className = 'profit-calc__bar';

  const segBase = document.createElement('div');
  segBase.className = 'profit-calc__bar-seg profit-calc__bar-seg--base';
  const segWholesale = document.createElement('div');
  segWholesale.className = 'profit-calc__bar-seg profit-calc__bar-seg--wholesale';
  const segSaler = document.createElement('div');
  segSaler.className = 'profit-calc__bar-seg profit-calc__bar-seg--saler';
  const segPlatform = document.createElement('div');
  segPlatform.className = 'profit-calc__bar-seg profit-calc__bar-seg--platform';

  bar.append(segBase, segWholesale, segSaler, segPlatform);

  // Legend
  const legend = document.createElement('div');
  legend.className = 'profit-calc__legend';

  legend.append(
    createLegendItem('#94a3b8', t('sourcing.calc.base_cost')),
    createLegendItem('#cbd5e1', t('sourcing.calc.wholesale_margin')),
    createLegendItem('var(--brand-600)', t('sourcing.calc.saler_share')),
    createLegendItem('#a855f7', t('sourcing.calc.platform_share'))
  );

  barWrap.append(barLabel, bar, legend);

  container.append(header, slidersSec, errorBanner, breakdownGrid, barWrap);

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
        categoryId,
        productId,
      });

      if (ac.signal.aborted) return;

      currentBreakdown = breakdown;
      errorBanner.style.display = 'none';

      // Update Breakdown cards with server-authoritative numbers
      wholesaleCostCard.setValue(formatCurrency(breakdown.wholesale_cost));
      salerEarningCard.setValue(formatCurrency(breakdown.saler_earning));
      salerEarningCard.setSub(
        `${t('sourcing.calc.saler_margin')}: ${breakdown.saler_margin_pct}% (${breakdown.saler_split_pct}% ${t('sourcing.calc.split')})`
      );
      platformEarningCard.setValue(formatCurrency(breakdown.platform_earning));
      platformEarningCard.setSub(
        `${breakdown.platform_split_pct}% ${t('sourcing.calc.platform_split')}`
      );

      // Update Visual Split Bar
      const total = breakdown.retail_price || 1;
      const basePct = ((breakdown.base_cost / total) * 100).toFixed(1);
      const wsPct = ((breakdown.wholesale_margin / total) * 100).toFixed(1);
      const salerPct = ((breakdown.saler_earning / total) * 100).toFixed(1);
      const platformPct = ((breakdown.platform_earning / total) * 100).toFixed(1);

      segBase.style.width = `${basePct}%`;
      segBase.title = `${t('sourcing.calc.base_cost')}: ${formatCurrency(breakdown.base_cost)}`;
      segWholesale.style.width = `${wsPct}%`;
      segWholesale.title = `${t('sourcing.calc.wholesale_margin')}: ${formatCurrency(breakdown.wholesale_margin)}`;
      segSaler.style.width = `${salerPct}%`;
      segSaler.title = `${t('sourcing.calc.saler_share')}: ${formatCurrency(breakdown.saler_earning)}`;
      segPlatform.style.width = `${platformPct}%`;
      segPlatform.title = `${t('sourcing.calc.platform_share')}: ${formatCurrency(breakdown.platform_earning)}`;

      barLabelRight.textContent = `${t('sourcing.calc.total_retail')}: ${formatCurrency(breakdown.retail_price)}`;

      if (typeof onChange === 'function') {
        onChange(breakdown);
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      const isBn = getLanguage() === 'bn';
      const msg = (isBn && err?.message_bn) ? err.message_bn : (err?.message || err?.message_en || t('sourcing.calc.error_invalid_price'));
      errorBanner.textContent = `⚠️ ${msg}`;
      errorBanner.style.display = 'flex';

      wholesaleCostCard.setValue('—');
      salerEarningCard.setValue('—');
      platformEarningCard.setValue('—');
      segBase.style.width = '0%';
      segWholesale.style.width = '0%';
      segSaler.style.width = '0%';
      segPlatform.style.width = '0%';
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
  container.setValues = (newBase, newWholesale, newRetail) => {
    if (newBase !== undefined) {
      baseCost = Number(newBase);
      baseCostField.setValue(baseCost);
    }
    if (newWholesale !== undefined) {
      wholesaleMargin = Number(newWholesale);
      wholesaleMarginField.setValue(wholesaleMargin);
    }
    if (newRetail !== undefined) {
      retailPrice = Number(newRetail);
      retailPriceField.setValue(retailPrice);
    }
    triggerCalculation();
  };

  container.getBreakdown = () => currentBreakdown;

  return container;
}

function createSliderField({ label, min, max, step, value, onInput }) {
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
  range.min = min;
  range.max = max;
  range.step = step;
  range.value = value;
  range.setAttribute('aria-label', label);

  const numInput = document.createElement('input');
  numInput.type = 'number';
  numInput.className = 'profit-calc__num-input';
  numInput.min = min;
  numInput.max = max * 2;
  numInput.step = step;
  numInput.value = value;
  numInput.setAttribute('aria-label', `${label} numeric input`);

  function sync(v) {
    const num = Math.max(0, Number(v) || 0);
    range.value = Math.min(num, max);
    numInput.value = num;
    displayVal.textContent = formatCurrency(num);
    onInput(num);
  }

  range.addEventListener('input', (e) => sync(e.target.value));
  numInput.addEventListener('input', (e) => sync(e.target.value));

  wrap.append(range, numInput);
  element.append(header, wrap);

  return {
    element,
    setValue: (val) => {
      range.value = Math.min(val, max);
      numInput.value = val;
      displayVal.textContent = formatCurrency(val);
    },
  };
}

function createCard(title, initialValue, initialSub, isHighlight = false) {
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
    setValue: (v) => { val.textContent = v; },
    setSub: (s) => { sub.textContent = s; },
  };
}

function createLegendItem(color, label) {
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
