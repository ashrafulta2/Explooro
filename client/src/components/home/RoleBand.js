/**
 * RoleBand — draws the panels `homeBands.js` describes and fills them with the numbers from
 * GET /home/summary.
 *
 * WHY panels render immediately with a placeholder and are filled afterwards: the band must not
 * wait on the network (it sits above the fold on the most visited page), and a failed or slow
 * request must leave working links rather than an empty box. A figure that cannot be loaded shows
 * "–", never 0, because 0 would read as "all clear".
 */

import { t } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { ROLE_BANDS } from './homeBands.js';

const PENDING = '…';
const MISSING = '–';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function anchor(className, label, path, onNavigate) {
  const a = el('a', className);
  if (label != null) a.textContent = label;
  a.href = path;
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    onNavigate(path);
  });
  return a;
}

const labelOf = (item) => t(item.stat ? `marketplace.top.band.stat.${item.stat}` : `marketplace.top.band.link.${item.link}`);

export function formatStat(item, value) {
  if (value == null) return MISSING;
  return item.money ? formatCurrency(String(value)) : formatNumber(Number(value));
}

function buildPanel(role, position, def, onNavigate, valueNodes) {
  // WHY: a super admin reads the same words as an admin; only the third figure differs (homeBands.js).
  const base = `marketplace.top.band.${role === 'super_admin' ? 'admin' : role}.${position}`;
  const tone = def.tone || 'plain';
  const panel = el('section', `home-band home-band--${tone} home-band--${position}`);
  const title = t(`${base}.title`);
  panel.setAttribute('aria-label', title);
  panel.append(el('p', 'home-band__kicker', t(`${base}.kicker`)), el('h2', 'home-band__title', title));

  const register = (item, valueNode) => {
    if (item.stat) valueNodes.push({ item, node: valueNode });
  };

  if (def.kind === 'metrics') {
    const grid = el('div', 'home-band__metrics');
    grid.style.setProperty('--metric-count', String(def.metrics.length));
    for (const item of def.metrics) {
      const m = anchor(`home-band__metric${item.tone ? ` home-band__metric--${item.tone}` : ''}`, null, item.path, onNavigate);
      const value = el('strong', 'home-band__metric-value', PENDING);
      m.append(el('span', 'home-band__metric-label', labelOf(item)), value);
      register(item, value);
      grid.append(m);
    }
    panel.append(grid);
  } else if (def.kind === 'links') {
    const grid = el('div', 'home-band__tiles');
    for (const item of def.links) grid.append(anchor(`home-band__tile${item.tone ? ` home-band__tile--${item.tone}` : ''}`, labelOf(item), item.path, onNavigate));
    panel.append(grid);
  } else {
    const list = el('div', 'home-band__rows');
    for (const item of def.rows) {
      const row = anchor('home-band__row', null, item.path, onNavigate);
      row.append(el('span', 'home-band__row-label', labelOf(item)));
      if (item.stat) {
        const value = el('strong', 'home-band__row-value', PENDING);
        row.append(value);
        register(item, value);
      } else {
        row.append(el('span', 'home-band__row-go', '›'));
      }
      list.append(row);
    }
    panel.append(list);
  }

  panel.append(anchor('home-band__cta', `${t(`${base}.cta`)} ›`, def.cta, onNavigate));
  return panel;
}

/**
 * @returns {null | { panels: {left?: Element, center?: Element, right?: Element}, fill(stats: object|null): void }}
 * null when the role has no band (guests, finance, unknown roles keep the default layout).
 */
export function RoleBand(role, { onNavigate }) {
  const def = ROLE_BANDS[role];
  if (!def) return null;
  const valueNodes = [];
  const panels = {};
  for (const position of ['left', 'center', 'right']) {
    if (def[position]) panels[position] = buildPanel(role, position, def[position], onNavigate, valueNodes);
  }

  function fill(stats) {
    for (const { item, node } of valueNodes) {
      const value = stats ? stats[item.stat] : undefined;
      node.textContent = formatStat(item, value);
      node.classList.toggle('is-alert', Boolean(item.alert) && Number(value) > 0);
    }
  }

  return { panels, fill };
}
