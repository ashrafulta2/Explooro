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
    const box = el('div', `home-band__board home-band__board--${def.view || 'list'}`);
    box.dataset.board = def.board;
    leaderboards.push({ def, node: box, emptyKey: `${base}.empty` });
    return box;
  }
  if (def.kind === 'links') {
    const grid = el('div', 'home-band__tiles');
    for (const item of def.links) grid.append(anchor(`home-band__tile${item.tone ? ` home-band__tile--${item.tone}` : ''}`, labelOf(item), item.path, onNavigate));
    return grid;
  }
  const list = el('div', 'home-band__rows');
  for (const item of def.rows) {
    const row = anchor(`home-band__row${item.stat ? ' home-band__row--stat' : ''}`, null, item.path, onNavigate);
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

// ── Ranking views ────────────────────────────────────────────────────────────────────────────────
// WHY several views instead of one list: every slide drawn as the same five rows made the slider feel
// like one panel repeating itself. Each view suits its data: a spotlight for "who leads", bars for a
// comparison, chips for search phrases, tiles for categories, a share bar for "what the queue is made of".
// Every view is sized to fit the band's fixed height with no row shrinking below its content (the bug
// that made the bar strike through "38 sold": rows were `flex: 1 1 0` with a 2.5rem floor, so the
// two-line text was clipped and the bar, absolutely placed, sat on top of it).

const nameOf = (def, entry, lang) => (def.nameKey && entry.code
  ? t(`${def.nameKey}.${entry.code}`)
  : (lang === 'bn' ? entry.name_bn : entry.name_en) || entry.name_en || entry.name_bn || t('marketplace.top.band.board.unnamed'));
const countOf = (def, entry) => t(`marketplace.top.band.board.count.${def.count}`, { n: formatNumber(Number(entry.count) || 0) });
const measureOf = (entry) => (entry.amount != null ? Number(entry.amount) : Number(entry.count)) || 0;
const moneyOf = (entry) => (entry.amount != null ? formatCurrency(String(entry.amount)) : null);

/**
 * Whole-number percentages that always add up to 100 (largest remainder), so a share legend never
 * reads 99% or 101%. Pure, for the test.
 */
export function percentShares(values) {
  const total = values.reduce((a, v) => a + (Number(v) || 0), 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => ((Number(v) || 0) / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, v) => a + v, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    if (left > 0) { out[i] += 1; left -= 1; }
  });
  return out;
}

/** Bar length against the leader, with a visible floor so the last entry never reads as zero. */
const shareOf = (entry, top) => (top > 0 ? Math.max(6, Math.round((measureOf(entry) / top) * 100)) : 0);

function rank(n) {
  return el('span', 'home-band__rank', String(n));
}

const VIEWS = {
  // A data bar behind each one-line row: the length is in the row's own tint, never on top of text.
  list(def, list, lang, top) {
    const ol = el('ol', 'home-band__list');
    list.forEach((entry, i) => {
      const li = el('li', 'home-band__list-row');
      li.style.setProperty('--share', `${shareOf(entry, top)}%`);
      li.append(rank(i + 1), el('span', 'home-band__list-name', nameOf(def, entry, lang)), el('span', 'home-band__list-count', countOf(def, entry)));
      const money = moneyOf(entry);
      if (money) li.append(el('strong', 'home-band__list-amount', money));
      ol.append(li);
    });
    return ol;
  },

  // The leader gets a card of its own; the runners-up line up beside it.
  spotlight(def, list, lang) {
    const wrap = el('div', 'home-band__spot');
    const [lead, ...rest] = list;
    const card = el('div', 'home-band__spot-lead');
    card.append(
      el('span', 'home-band__spot-badge', t('marketplace.top.band.board.leader')),
      el('strong', 'home-band__spot-name', nameOf(def, lead, lang)),
      el('span', 'home-band__spot-amount', moneyOf(lead) ?? countOf(def, lead)),
      el('span', 'home-band__spot-count', moneyOf(lead) ? countOf(def, lead) : ''),
    );
    const ol = el('ol', 'home-band__spot-rest');
    rest.forEach((entry, i) => {
      const li = el('li', 'home-band__spot-row');
      li.append(rank(i + 2), el('span', 'home-band__spot-row-name', nameOf(def, entry, lang)), el('span', 'home-band__spot-row-value', moneyOf(entry) ?? countOf(def, entry)));
      ol.append(li);
    });
    wrap.append(card, ol);
    return wrap;
  },

  // A small horizontal bar chart on one white card: label and value above each bar.
  bars(def, list, lang, top) {
    const ol = el('ol', 'home-band__bars');
    list.forEach((entry) => {
      const li = el('li', 'home-band__bars-row');
      const head = el('span', 'home-band__bars-head');
      head.append(el('span', 'home-band__bars-name', nameOf(def, entry, lang)), el('span', 'home-band__bars-value', moneyOf(entry) ?? countOf(def, entry)));
      const track = el('span', 'home-band__bars-track');
      const fillBar = el('span', 'home-band__bars-fill');
      fillBar.style.width = `${shareOf(entry, top)}%`;
      track.append(fillBar);
      li.append(head, track);
      ol.append(li);
    });
    return ol;
  },

  // Search phrases as chips, biggest first, so the slide reads like a word cloud ranked by demand.
  chips(def, list, lang) {
    const ol = el('ol', 'home-band__chips');
    list.forEach((entry, i) => {
      const li = el('li', `home-band__chip home-band__chip--${Math.min(i + 1, 4)}`);
      li.append(el('span', 'home-band__chip-name', nameOf(def, entry, lang)), el('span', 'home-band__chip-count', countOf(def, entry)));
      ol.append(li);
    });
    return ol;
  },

  // A mosaic: the leader is the tall tile, the next four share the rest.
  tiles(def, list, lang, top) {
    const ol = el('ol', 'home-band__tilegrid');
    list.forEach((entry, i) => {
      const li = el('li', `home-band__tilecard${i === 0 ? ' home-band__tilecard--lead' : ''}`);
      const money = moneyOf(entry);
      li.append(
        rank(i + 1),
        el('span', 'home-band__tilecard-name', nameOf(def, entry, lang)),
        el('strong', 'home-band__tilecard-value', money ?? countOf(def, entry)),
        el('span', 'home-band__tilecard-meta', money ? countOf(def, entry) : t('marketplace.top.band.board.of_leader', { n: shareOf(entry, top) })),
      );
      ol.append(li);
    });
    return ol;
  },

  // One stacked bar of the whole, then a legend: for "what is the queue made of", not "who is first".
  share(def, list, lang) {
    const wrap = el('div', 'home-band__share');
    const pct = percentShares(list.map((e) => e.count));
    const bar = el('div', 'home-band__share-bar');
    bar.setAttribute('aria-hidden', 'true');
    const legend = el('ol', 'home-band__share-legend');
    list.forEach((entry, i) => {
      const seg = el('span', `home-band__share-seg home-band__share-seg--${Math.min(i + 1, 6)}`);
      seg.style.flexGrow = String(Math.max(Number(entry.count) || 0, 0.0001));
      bar.append(seg);
      const li = el('li', 'home-band__share-item');
      li.append(
        el('span', `home-band__share-swatch home-band__share-seg--${Math.min(i + 1, 6)}`),
        el('span', 'home-band__share-name', nameOf(def, entry, lang)),
        el('span', 'home-band__share-count', countOf(def, entry)),
        el('strong', 'home-band__share-pct', `${formatNumber(pct[i])}%`),
      );
      legend.append(li);
    });
    wrap.append(bar, legend);
    return wrap;
  },
};

export const BOARD_VIEWS = Object.keys(VIEWS);

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

    const lang = getLanguage();
    for (const { def: boardDef, node, emptyKey } of ctx.leaderboards) {
      const list = insights?.[boardDef.board] ?? [];
      node.replaceChildren();
      node.classList.toggle('is-empty', list.length === 0);
      if (list.length === 0) {
        node.append(el('p', 'home-band__board-empty', t(emptyKey)));
        continue;
      }
      const top = Math.max(...list.map(measureOf));
      const view = VIEWS[boardDef.view] || VIEWS.list;
      node.append(view(boardDef, list, lang, top));
    }
  }

  return { panels, fill, cleanup: () => ctx.cleanups.forEach((fn) => fn()) };
}
