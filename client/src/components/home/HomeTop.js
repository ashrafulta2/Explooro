/**
 * HomeTop — the band above the product feed on the marketplace home page.
 *
 * Replaces the old text-only hero. The layout depends on the account type:
 *  - Guest: how-a-Shop Partner-earns panel · campaign slider · shortcut tiles.
 *  - Customer: a "for you" panel (price drops, coins, team buys) · campaign slider · orders card + tiles,
 *    plus a "welcome back" strip of quick links.
 *  - Shop Partner, supplier, moderator, editor, admin, super admin: three panels of their own
 *    (components/home/homeBands.js). A supplier has no use for "start earning with zero stock" and an
 *    admin is never a Shop Partner, so none of them get the earn panel, slider or tiles.
 *
 * WHY: the band renders instantly and never waits on the network. The slides and links are static
 * routes; the only fetch is the signed-in role's few numbers (GET /home/summary), filled in after
 * first paint, and a failed request leaves working links with "–" instead of a number.
 * The Become a Shop Partner CTA keeps the one-click flow, now on the earn panel: guests go to register,
 * customers to the /account/become-saler page that runs BecomeSalerCta, shop partners to their dashboard.
 */

import { t } from '../../services/i18n.js';
import { ICONS } from '../ui/icons.js';
import { getHomeSummary } from '../../services/homeSummary.api.js';
import { RoleBand } from './RoleBand.js';
import { FULL_BAND_ROLES } from './homeBands.js';

const SLIDES = [
  { id: 'flash',    feed: 'flash',    key: 'marketplace.top.slide_flash' },
  { id: 'verified', feed: 'verified', key: 'marketplace.top.slide_verified' },
  { id: 'saler', feed: 'saler', key: 'marketplace.top.slide_saler' },
];

// i18n keys in the order a Shop Partner experiences them; the number is drawn by a CSS counter.
const EARN_STEPS = ['marketplace.top.earn_step_pick', 'marketplace.top.earn_step_share', 'marketplace.top.earn_step_keep'];
// Shortcut tiles on the right. `feed` tiles switch the feed tab below; the rest are plain routes
// (the router sends a signed-out visitor to sign in first). Flash sales has no tile: it is a slide.
const TILES = [
  { id: 'chat',      icon: 'engage',      path: '/chat' },
  { id: 'verified',  icon: 'check_circle', feed: 'verified' },
  { id: 'team',      icon: 'users',       path: '/account/team-purchases' },
  { id: 'live',      icon: 'circle_play', path: '/live' },
  { id: 'coupons',   icon: 'tag',         path: '/account/coupons' },
  { id: 'salers', icon: 'my_store',    feed: 'saler' },
];

const ROTATE_MS = 6000;

// Customer quick links under the band. The other signed-in roles have their own panels instead.
const QUICK_LINKS = {
  customer: [
    ['marketplace.top.q_orders', '/account/orders'],
    ['marketplace.top.q_wishlist', '/account/wishlist'],
    ['marketplace.top.q_coupons', '/account/coupons'],
    ['marketplace.top.q_live', '/live'],
  ],
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function link(className, label, path, onNavigate) {
  const a = el('a', className, label);
  a.href = path;
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    onNavigate(path);
  });
  return a;
}

export function HomeTop({ role, isAuthenticated, onNavigate, onSelectFeed }) {
  const root = el('section', 'home-top');
  root.setAttribute('aria-label', t('marketplace.top.label'));
  const cleanups = [];
  // WHY: the three slides are h2s that rotate; the page still needs one stable h1 for SEO and screen readers.
  root.append(el('h1', 'sr-only', t('marketplace.hero.tagline')));

  // Role panels (null for guests and for roles without a band, which keep the default layout).
  const band = isAuthenticated ? RoleBand(role, { onNavigate }) : null;
  const fullBand = Boolean(band) && FULL_BAND_ROLES.includes(role);

  // ── Earn panel ───────────────────────────────────────────────────────────
  // WHY: this used to be a category rail, but the category chips under the feed tabs already list
  // the same names. Showing how a Shop Partner earns tells a shopper the platform is also a way to earn.
  // WHY no Shop Partner branch: a Shop Partner has a band of their own, so this panel only reaches guests
  // and roles without a band. A signed-in role without one is a customer-like account, hence become-saler.
  const salerPath = isAuthenticated ? '/account/become-saler' : '/auth/register';
  const earn = el('aside', 'home-top__earn');
  earn.setAttribute('aria-label', t('marketplace.top.earn_label'));
  earn.append(
    el('p', 'home-top__earn-kicker', t('marketplace.top.earn_kicker')),
    el('h2', 'home-top__earn-title', t('marketplace.top.earn_title')),
  );
  const steps = el('ol', 'home-top__earn-steps');
  for (const key of EARN_STEPS) steps.append(el('li', 'home-top__earn-step', t(key)));
  earn.append(steps);
  earn.append(link('home-top__earn-cta', t('marketplace.top.earn_cta'), salerPath, onNavigate));

  // ── Slider ───────────────────────────────────────────────────────────────
  const slider = el('div', 'home-top__slider');
  slider.setAttribute('role', 'group');
  slider.setAttribute('aria-roledescription', 'carousel');
  slider.setAttribute('aria-label', t('marketplace.top.slider_label'));
  const slides = [];
  const dots = el('div', 'home-top__dots');
  let index = 0;

  SLIDES.forEach((s, i) => {
    const slide = el('div', `home-top__slide home-top__slide--${s.id}`);
    slide.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
    const title = el('h2', 'home-top__slide-title', t(`${s.key}.title`));
    const sub = el('p', 'home-top__slide-sub', t(`${s.key}.sub`));
    const go = el('button', 'home-top__slide-cta', t(`${s.key}.cta`));
    go.type = 'button';
    go.tabIndex = i === 0 ? 0 : -1;
    go.addEventListener('click', () => onSelectFeed(s.feed));
    slide.append(title, sub, go);
    slides.push({ slide, go });
    slider.append(slide);

    const dot = el('button', 'home-top__dot');
    dot.type = 'button';
    dot.setAttribute('aria-label', t('marketplace.top.go_to_slide', { n: i + 1 }));
    dot.setAttribute('aria-current', i === 0 ? 'true' : 'false');
    dot.addEventListener('click', () => show(i, true));
    dots.append(dot);
  });
  slider.append(dots);

  function show(next, userPicked = false) {
    index = (next + SLIDES.length) % SLIDES.length;
    slides.forEach(({ slide, go }, i) => {
      slide.classList.toggle('is-active', i === index);
      slide.setAttribute('aria-hidden', i === index ? 'false' : 'true');
      go.tabIndex = i === index ? 0 : -1;
    });
    [...dots.children].forEach((d, i) => d.setAttribute('aria-current', i === index ? 'true' : 'false'));
    if (userPicked) restart();
  }

  let timer = null;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function stop() { clearInterval(timer); timer = null; }
  function restart() {
    stop();
    if (!reduced) timer = setInterval(() => show(index + 1), ROTATE_MS);
  }
  slider.addEventListener('pointerenter', stop);
  slider.addEventListener('pointerleave', restart);
  slider.addEventListener('focusin', stop);
  slider.addEventListener('focusout', restart);
  cleanups.push(stop);
  show(0);
  // WHY: the slider is not mounted for the role bands, so its rotation timer must not run for them.
  if (!fullBand) restart();

  // ── Side cards ───────────────────────────────────────────────────────────
  const side = el('div', 'home-top__side');

  // WHY: the card sits ABOVE the tiles. The side column has a fixed height (`contain: size`), so the tiles
  // must be the flexible part; with the card below, taller Bangla tile labels overflowed and covered it.
  // No sign-in card for guests. The topbar already has Sign In / Sign Up, and the card only
  // made the band taller. Signed-in users keep a card that points at their orders or console.
  if (isAuthenticated && !fullBand) {
    const second = el('div', 'home-top__card home-top__card--info');
    second.append(
      el('h2', 'home-top__card-title', t('marketplace.top.orders_title')),
      el('p', 'home-top__card-sub', t('marketplace.top.orders_sub')),
      link('home-top__card-link', t('marketplace.top.orders_cta') + ' ›', '/account/orders', onNavigate),
    );
    side.append(second);
  }

  if (!fullBand) {
    const tiles = el('nav', 'home-top__tiles');
    tiles.setAttribute('aria-label', t('marketplace.top.tiles_title'));
    const grid = el('div', 'home-top__tile-grid');
    for (const tile of TILES) {
      const label = t(`marketplace.top.tile_${tile.id}`);
      const node = tile.feed
        ? el('button', `home-top__tile home-top__tile--${tile.id}`)
        : link(`home-top__tile home-top__tile--${tile.id}`, '', tile.path, onNavigate);
      if (tile.feed) {
        node.type = 'button';
        node.addEventListener('click', () => onSelectFeed(tile.feed));
      }
      const icon = el('span', 'home-top__tile-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = ICONS[tile.icon]; // trusted constant SVG from icons.js
      node.append(icon, el('span', null, label));
      grid.append(node);
    }
    tiles.append(grid);
    // WHY: with no card above them (guests) the tiles are the only child of a grid whose first row is `auto`,
    // so they hugged their content and left the column's lower half empty. The modifier lets them fill it.
    if (!side.children.length) side.classList.add('home-top__side--solo');
    side.append(tiles);
  }

  const main = el('div', `home-top__main${fullBand ? ' home-top__main--band' : ''}${band && !fullBand ? ' home-top__main--for-you' : ''}`);
  if (fullBand) {
    main.append(...['left', 'center', 'right'].map((position) => band.panels[position]));
  } else {
    main.append(band ? band.panels.left : earn, slider, side);
  }
  root.append(main);

  if (band) {
    let alive = true;
    cleanups.push(() => { alive = false; }, band.cleanup);
    getHomeSummary()
      .then((summary) => { if (alive) band.fill(summary?.stats ?? null, summary?.insights ?? null); })
      .catch(() => { if (alive) band.fill(null); });
  }

  // ── Welcome back strip (signed in only) ──────────────────────────────────
  if (isAuthenticated && !fullBand) {
    const links = QUICK_LINKS[role];
    if (links) {
      const strip = el('div', 'home-top__welcome');
      strip.append(el('span', 'home-top__welcome-title', t('marketplace.top.welcome_back')));
      const row = el('div', 'home-top__welcome-links');
      for (const [key, path] of links) row.append(link('home-top__quick', t(key), path, onNavigate));
      strip.append(row);
      root.append(strip);
    }
  }

  return { el: root, cleanup: () => cleanups.forEach((fn) => fn()) };
}
