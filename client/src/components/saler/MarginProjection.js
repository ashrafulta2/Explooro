/**
 * MarginProjection.js — Zero-dependency inline SVG earnings projection chart (Prompt 4.7).
 *
 * Visualizes projected monthly profits based on unit margin and estimated sales volume.
 * Adheres strictly to the 150KB budget by rendering standard responsive inline SVG.
 */
import { formatCurrency } from '../../services/format.js';
import { t } from '../../services/i18n.js';

const MILESTONES = [10, 25, 50, 100, 250, 500];

/**
 * Creates the Margin Projection Component.
 *
 * @param {object} props
 * @param {number} [props.unitProfit=80] Saler profit per unit
 * @param {number} [props.initialVolume=50] Estimated monthly sales volume
 * @returns {HTMLElement}
 */
export function MarginProjection({
  unitProfit = 80,
  initialVolume = 50,
} = {}) {
  const container = document.createElement('div');
  container.className = 'margin-projection';

  let currentUnitProfit = Math.max(0, Number(unitProfit) || 0);
  let currentVolume = Math.max(1, Number(initialVolume) || 50);

  // Header
  const header = document.createElement('div');
  header.className = 'margin-projection__header';

  const titleWrap = document.createElement('div');
  const title = document.createElement('h4');
  title.className = 'margin-projection__title';
  title.textContent = t('sourcing.projection.title');

  const sub = document.createElement('span');
  sub.className = 'text-xs text-secondary';
  sub.textContent = t('sourcing.projection.subtitle');
  titleWrap.append(title, sub);

  const summary = document.createElement('div');
  summary.className = 'margin-projection__summary';
  const summaryLabel = document.createElement('span');
  summaryLabel.className = 'margin-projection__summary-label';
  summaryLabel.textContent = t('sourcing.projection.projected_monthly');
  const summaryVal = document.createElement('span');
  summaryVal.className = 'margin-projection__summary-val';
  summary.append(summaryLabel, summaryVal);

  header.append(titleWrap, summary);

  // Volume Slider Control
  const volumeControl = document.createElement('div');
  volumeControl.className = 'profit-calc__field';

  const volumeHeader = document.createElement('div');
  volumeHeader.className = 'profit-calc__field-header';

  const volLabel = document.createElement('span');
  volLabel.className = 'profit-calc__field-label';
  volLabel.textContent = t('sourcing.projection.estimated_volume');

  const volVal = document.createElement('span');
  volVal.className = 'profit-calc__field-val';
  volVal.textContent = `${currentVolume} ${t('sourcing.projection.units_per_month')}`;

  volumeHeader.append(volLabel, volVal);

  const volWrap = document.createElement('div');
  volWrap.className = 'profit-calc__input-wrap';

  const volRange = document.createElement('input');
  volRange.type = 'range';
  volRange.className = 'profit-calc__range';
  volRange.min = 5;
  volRange.max = 500;
  volRange.step = 5;
  volRange.value = currentVolume;
  volRange.setAttribute('aria-label', t('sourcing.projection.estimated_volume'));

  const volNum = document.createElement('input');
  volNum.type = 'number';
  volNum.className = 'profit-calc__num-input';
  volNum.min = 1;
  volNum.max = 2000;
  volNum.step = 5;
  volNum.value = currentVolume;
  volNum.setAttribute('aria-label', `${t('sourcing.projection.estimated_volume')} numeric`);

  volWrap.append(volRange, volNum);
  volumeControl.append(volumeHeader, volWrap);

  // SVG Container
  const svgContainer = document.createElement('div');
  svgContainer.className = 'margin-projection__svg-container';

  // Milestone Quick-Pill Buttons
  const milestonesContainer = document.createElement('div');
  milestonesContainer.className = 'margin-projection__milestones';

  const pillButtons = MILESTONES.map((qty) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `margin-milestone-pill ${qty === currentVolume ? 'active' : ''}`;
    btn.textContent = `${qty} ${t('sourcing.projection.units')}`;
    btn.addEventListener('click', () => {
      syncVolume(qty);
    });
    milestonesContainer.append(btn);
    return { qty, btn };
  });

  container.append(header, volumeControl, svgContainer, milestonesContainer);

  function syncVolume(v) {
    currentVolume = Math.max(1, Number(v) || 1);
    volRange.value = Math.min(currentVolume, 500);
    volNum.value = currentVolume;
    volVal.textContent = `${currentVolume} ${t('sourcing.projection.units_per_month')}`;

    pillButtons.forEach(({ qty, btn }) => {
      btn.classList.toggle('active', qty === currentVolume);
    });

    renderChart();
  }

  volRange.addEventListener('input', (e) => syncVolume(e.target.value));
  volNum.addEventListener('input', (e) => syncVolume(e.target.value));

  function renderChart() {
    const monthlyTotal = currentVolume * currentUnitProfit;
    summaryVal.textContent = formatCurrency(monthlyTotal);

    // SVG coordinate space
    const width = 500;
    const height = 180;
    const paddingLeft = 55;
    const paddingRight = 30;
    const paddingTop = 25;
    const paddingBottom = 35;

    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    const maxUnits = Math.max(500, Math.ceil(currentVolume / 100) * 100);
    const maxProfit = maxUnits * currentUnitProfit || 1000;

    // Generate coordinate points for milestones + current volume
    const pointsData = [
      0,
      10,
      25,
      50,
      100,
      250,
      500,
    ];
    if (!pointsData.includes(currentVolume)) {
      pointsData.push(currentVolume);
      pointsData.sort((a, b) => a - b);
    }

    const coordinates = pointsData.map((u) => {
      const x = paddingLeft + (u / maxUnits) * plotWidth;
      const profit = u * currentUnitProfit;
      const y = height - paddingBottom - (profit / maxProfit) * plotHeight;
      return { u, profit, x, y, isCurrent: u === currentVolume };
    });

    const pathD = coordinates.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, '');

    const areaD = `${pathD} L ${paddingLeft + plotWidth} ${height - paddingBottom} L ${paddingLeft} ${height - paddingBottom} Z`;

    // Horizontal grid lines (3 tiers)
    const gridLines = [0.25, 0.5, 0.75, 1.0].map((ratio) => {
      const y = height - paddingBottom - ratio * plotHeight;
      const val = ratio * maxProfit;
      return `
        <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" class="margin-chart-grid" />
        <text x="${paddingLeft - 8}" y="${y + 3}" text-anchor="end" class="margin-chart-text">৳${Math.round(val / 1000)}k</text>
      `;
    }).join('');

    // X-axis milestone labels
    const xLabels = [0, 100, 250, 500].map((u) => {
      const x = paddingLeft + (u / maxUnits) * plotWidth;
      return `<text x="${x}" y="${height - paddingBottom + 18}" text-anchor="middle" class="margin-chart-text">${u}</text>`;
    }).join('');

    // Points
    const circlesSvg = coordinates
      .filter((pt) => pt.u > 0)
      .map((pt) => `
        <g class="margin-chart-point-group" tabindex="0" role="button" aria-label="${pt.u} units: ৳${pt.profit}">
          <circle cx="${pt.x}" cy="${pt.y}" r="${pt.isCurrent ? 6 : 4}" class="margin-chart-point ${pt.isCurrent ? 'active' : ''}" />
          ${pt.isCurrent ? `
            <rect x="${pt.x - 36}" y="${pt.y - 24}" width="72" height="18" rx="4" fill="var(--surface-3)" stroke="var(--border-subtle)" />
            <text x="${pt.x}" y="${pt.y - 12}" text-anchor="middle" class="margin-chart-text" font-weight="700" fill="var(--brand-700)">৳${Math.round(pt.profit)}</text>
          ` : ''}
        </g>
      `).join('');

    svgContainer.innerHTML = `
      <svg class="margin-projection__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${t('sourcing.projection.chart_aria')}">
        <defs>
          <linearGradient id="marginAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--brand-500)" stop-opacity="0.25" />
            <stop offset="100%" stop-color="var(--brand-500)" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        ${gridLines}
        <line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="var(--border-strong)" stroke-width="1" />
        <path d="${areaD}" fill="url(#marginAreaGrad)" />
        <path d="${pathD}" class="margin-chart-line" />
        ${xLabels}
        ${circlesSvg}
        <text x="${paddingLeft + plotWidth / 2}" y="${height - 4}" text-anchor="middle" class="margin-chart-text" font-weight="600">${t('sourcing.projection.units_sold_label')}</text>
      </svg>
    `;
  }

  // Initial render
  renderChart();

  // Public update API
  container.setUnitProfit = (profit) => {
    currentUnitProfit = Math.max(0, Number(profit) || 0);
    renderChart();
  };

  container.setVolume = (vol) => {
    syncVolume(vol);
  };

  return container;
}
