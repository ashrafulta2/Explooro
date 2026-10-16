/**
 * RoleBand — draws the panels `homeBands.js` describes and fills them with the numbers and rankings
 * from GET /home/summary.
 *
 * WHY panels render immediately with a placeholder and are filled afterwards: the band must not
 * wait on the network (it sits above the fold on the most visited page), and a failed or slow
 * request must leave working links rather than an empty box. A figure that cannot be loaded shows
 * "–", never 0, because 0 would read as "all clear".
 *
 * The centre panel is a slider of rankings and figures, rotated the same way as the customer's
 * campaign slider (HomeTop.js): it pauses under the pointer or keyboard focus and never moves for a
 * visitor who asked for reduced motion.
 */

import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { ROLE_BANDS } from './homeBands.js';

const PENDING = '…';
const MISSING = '–';
const ROTATE_MS = 7000;

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
// WHY: a super admin reads the same words as an admin; only the third figure differs (homeBands.js).
const textRoleOf = (role) => (role === 'super_admin' ? 'admin' : role);

export function formatStat(item, value) {
  if (value == null) return MISSING;
  return item.money ? formatCurrency(String(value)) : formatNumber(Number(value));
}

/** The body of a panel or slide: figures, a ranking, shortcut tiles or plain rows. */
function buildBody(def, ctx, base) {
  const { onNavigate, valueNodes, leaderboards } = ctx;
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
    return grid;
  }
  if (def.kind === 'leaderboard') {
    // The list is drawn later by fill(); until then (and if the request fails) the slide shows one
    // empty-state line, never invented rows.
    const list = el('ol', 'home-band__board');
    list.dataset.board = def.board;
    leaderboards.push({ def, node: list, emptyKey: `${base}.empty` });
    return list;
  }
  if (def.kind === 'links') {
    const grid = el('div', 'home-band__tiles');
    for (const item of def.links) grid.append(anchor(`home-band__tile${item.tone ? ` home-band__tile--${item.tone}` : ''}`, labelOf(item), item.path, onNavigate));
    return grid;
  }
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
  return list;
}

function buildPanel(role, position, def, ctx) {
  if (def.slides) return buildSlider(role, position, def, ctx);
  const base = `marketplace.top.band.${textRoleOf(role)}.${position}`;
  const panel = el('section', `home-band home-band--${def.tone || 'plain'} home-band--${position}`);
  const title = t(`${base}.title`);
  panel.setAttribute('aria-label', title);
  panel.append(el('p', 'home-band__kicker', t(`${base}.kicker`)), el('h2', 'home-band__title', title));
  panel.append(buildBody(def, ctx, base));
  panel.append(anchor('home-band__cta', `${t(`${base}.cta`)} ›`, def.cta, ctx.onNavigate));
  return panel;
}

function buildSlider(role, position, def, ctx) {
  const panel = el('section', `home-band home-band--slider home-band--${position}`);
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-roledescription', 'carousel');
  panel.setAttribute('aria-label', t('marketplace.top.band.slider_label'));

  const track = el('div', 'home-band__slides');
  const dots = el('div', 'home-band__dots');
  const slides = def.slides.map((s, i) => {
    const base = `marketplace.top.band.${textRoleOf(role)}.${position}.${s.id}`;
    const slide = el('div', `home-band__slide home-band__slide--${s.tone}`);
    slide.dataset.slide = s.id;
    const head = el('div', 'home-band__slide-head');
    head.append(el('p', 'home-band__kicker', t(`${base}.kicker`)), el('h2', 'home-band__title', t(`${base}.title`)));
    slide.append(head, buildBody(s, ctx, base), anchor('home-band__cta', `${t(`${base}.cta`)} ›`, s.cta, ctx.onNavigate));
    track.append(slide);

    const dot = el('button', 'home-band__dot');
    dot.type = 'button';
    dot.setAttribute('aria-label', t(`${base}.title`));
    dot.addEventListener('click', () => show(i, true));
    dots.append(dot);
    return { slide, dot };
  });
  panel.append(track);
  if (slides.length > 1) panel.append(dots);

  let index = 0;
  function show(next, userPicked = false) {
    index = (next + slides.length) % slides.length;
    slides.forEach(({ slide, dot }, i) => {
      const active = i === index;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', active ? 'false' : 'true');
      // WHY inert: hidden slides keep their links in the DOM (they are stacked, not removed), and
      // without it a keyboard user would tab into rows they cannot see.
      slide.inert = !active;
      dot.setAttribute('aria-current', active ? 'true' : 'false');
    });
    if (userPicked) restart();
  }

  let timer = null;
  const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function stop() { clearInterval(timer); timer = null; }
  function restart() {
    stop();
    if (!reduced && slides.length > 1) timer = setInterval(() => show(index + 1), ROTATE_MS);
  }
  panel.addEventListener('pointerenter', stop);
  panel.addEventListener('pointerleave', restart);
  panel.addEventListener('focusin', stop);
  panel.addEventListener('focusout', restart);
  ctx.cleanups.push(stop);
  show(0);
  restart();
  return panel;
}

/**
 * One ranked row: rank badge, name, its count, the amount (when the board is about money) and a bar
 * sized against the leader. `entry` is `{ name_en, name_bn, count, amount|null, code? }` from
 * GET /home/summary `insights`.
 */
export function boardRow(def, entry, top, lang = getLanguage()) {
  const row = el('li', 'home-band__board-row');
  const name = def.nameKey && entry.code
    ? t(`${def.nameKey}.${entry.code}`)
    : (lang === 'bn' ? entry.name_bn : entry.name_en) || entry.name_en || entry.name_bn || t('marketplace.top.band.board.unnamed');
  const measure = entry.amount != null ? Number(entry.amount) : Number(entry.count);
  const share = top > 0 ? Math.max(4, Math.round((measure / top) * 100)) : 0;
  const bar = el('span', 'home-band__board-bar');
  bar.style.setProperty('--share', `${share}%`);
  // WHY the count sits under the name: the centre panel narrows to ~400px beside the sidebar, and a
  // fourth column left product names cut to three letters.
  const text = el('span', 'home-band__board-text');
  text.append(
    el('span', 'home-band__board-name', name),
    el('span', 'home-band__board-count', t(`marketplace.top.band.board.count.${def.count}`, { n: formatNumber(Number(entry.count) || 0) })),
  );
  row.append(el('span', 'home-band__board-rank'), text);
  if (entry.amount != null) row.append(el('strong', 'home-band__board-amount', formatCurrency(String(entry.amount))));
  row.append(bar);
  return row;
}

/**
 * @returns {null | { panels: {left?: Element, center?: Element, right?: Element},
 *   fill(stats: object|null, insights?: object|null): void, cleanup(): void }}
 * null when the role has no band (guests, finance, unknown roles keep the default layout).
 */
export function RoleBand(role, { onNavigate }) {
  const def = ROLE_BANDS[role];
  if (!def) return null;
  const ctx = { onNavigate, valueNodes: [], leaderboards: [], cleanups: [] };
  const panels = {};
  for (const position of ['left', 'center', 'right']) {
    if (def[position]) panels[position] = buildPanel(role, position, def[position], ctx);
  }

  function fill(stats, insights = null) {
    for (const { item, node } of ctx.valueNodes) {
      const value = stats ? stats[item.stat] : undefined;
      node.textContent = formatStat(item, value);
      node.classList.toggle('is-alert', Boolean(item.alert) && Number(value) > 0);
    }

    for (const { def: boardDef, node, emptyKey } of ctx.leaderboards) {
      const list = insights?.[boardDef.board] ?? [];
      node.replaceChildren();
      node.classList.toggle('is-empty', list.length === 0);
      if (list.length === 0) {
        node.append(el('li', 'home-band__board-empty', t(emptyKey)));
        continue;
      }
      const top = Math.max(...list.map((e) => Number(e.amount ?? e.count) || 0));
      for (const entry of list) node.append(boardRow(boardDef, entry, top));
    }
  }

  return { panels, fill, cleanup: () => ctx.cleanups.forEach((fn) => fn()) };
}
