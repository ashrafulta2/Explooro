/**
 * HomeTop — the band above the product feed on the marketplace home page.
 *
 * Replaces the old text-only hero. Two layouts share one component:
 *  - Guest / customer: how-a-Saler-earns panel · campaign slider · shortcut tiles + sign-in/orders card.
 *  - Signed in: the same, plus a "welcome back" strip of role-specific quick links.
 *
 * WHY: nothing here fetches. The slides are shortcuts into the existing feed tabs and the quick
 * links are plain routes, so the band renders instantly and cannot show a number that is wrong.
 * The Become a Saler CTA keeps the one-click flow, now on the earn panel: guests go to register,
 * customers to the /account/become-saler page that runs BecomeSalerCta, salers to their dashboard.
 */

import { t } from '../../services/i18n.js';
import { ICONS } from '../ui/icons.js';

const SLIDES = [
  { id: 'flash',    feed: 'flash',    key: 'marketplace.top.slide_flash' },
  { id: 'verified', feed: 'verified', key: 'marketplace.top.slide_verified' },
  { id: 'reseller', feed: 'reseller', key: 'marketplace.top.slide_reseller' },
];

// i18n keys in the order a Saler experiences them; the number is drawn by a CSS counter.
const EARN_STEPS = ['marketplace.top.earn_step_pick', 'marketplace.top.earn_step_share', 'marketplace.top.earn_step_keep'];
// Shortcut tiles on the right. `feed` tiles switch the feed tab below; the rest are plain routes
// (the router sends a signed-out visitor to sign in first). Flash sales has no tile: it is a slide.
const TILES = [
  { id: 'chat',      icon: 'engage',      path: '/chat' },
  { id: 'verified',  icon: 'check_circle', feed: 'verified' },
  { id: 'team',      icon: 'users',       path: '/account/team-purchases' },
  { id: 'live',      icon: 'circle_play', path: '/live' },
  { id: 'coupons',   icon: 'tag',         path: '/account/coupons' },
  { id: 'resellers', icon: 'my_store',    feed: 'reseller' },
];

const ROTATE_MS = 6000;

// Role -> [label key, path]. Roles with their own console get one link to it.
const QUICK_LINKS = {
  customer: [
    ['marketplace.top.q_orders', '/account/orders'],
    ['marketplace.top.q_wishlist', '/account/wishlist'],
    ['marketplace.top.q_coupons', '/account/coupons'],
    ['marketplace.top.q_live', '/live'],
  ],
  saler: [
    ['marketplace.top.q_dashboard', '/saler'],
    ['marketplace.top.q_my_products', '/saler/products'],
    ['marketplace.top.q_saler_orders', '/saler/orders'],
    ['marketplace.top.q_earnings', '/saler/vault'],
  ],
};
const CONSOLE_HOME = {
  super_admin: '/admin', admin: '/admin', moderator: '/moderator', editor: '/editor', supplier: '/supplier',
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

  // ── Earn panel ───────────────────────────────────────────────────────────
  // WHY: this used to be a category rail, but the category chips under the feed tabs already list
  // the same names. Showing how a Saler earns tells a shopper the platform is also a way to earn.
  const isSaler = role === 'saler';
  const salerPath = isSaler ? '/saler' : isAuthenticated ? '/account/become-saler' : '/auth/register';
  const earn = el('aside', 'home-top__earn');
  earn.setAttribute('aria-label', t('marketplace.top.earn_label'));
  earn.append(
    el('p', 'home-top__earn-kicker', t('marketplace.top.earn_kicker')),
    el('h2', 'home-top__earn-title', t('marketplace.top.earn_title')),
  );
  const steps = el('ol', 'home-top__earn-steps');
  for (const key of EARN_STEPS) steps.append(el('li', 'home-top__earn-step', t(key)));
  earn.append(steps);
  if (!CONSOLE_HOME[role]) {
    earn.append(link('home-top__earn-cta', t(isSaler ? 'marketplace.top.open_store' : 'marketplace.top.earn_cta'), salerPath, onNavigate));
  }

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
  restart();

  // ── Side cards ───────────────────────────────────────────────────────────
  const side = el('div', 'home-top__side');

  if (!CONSOLE_HOME[role]) {
    const tiles = el('nav', 'home-top__tiles');
    tiles.setAttribute('aria-label', t('marketplace.top.tiles_title'));
    tiles.append(el('h2', 'home-top__tiles-title', t('marketplace.top.tiles_title')));
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
    side.append(tiles);
  }

  // WHY: no sign-in card for guests. The topbar already has Sign In / Sign Up, and the card only
  // made the band taller. Signed-in users keep a card that points at their orders or console.
  if (isAuthenticated) {
    const second = el('div', 'home-top__card home-top__card--info');
    const home = CONSOLE_HOME[role];
    const path = home || (role === 'saler' ? '/saler/orders' : '/account/orders');
    second.append(
      el('h2', 'home-top__card-title', t(home ? 'marketplace.top.console_title' : 'marketplace.top.orders_title')),
      el('p', 'home-top__card-sub', t(home ? 'marketplace.top.console_sub' : 'marketplace.top.orders_sub')),
      link('home-top__card-link', t(home ? 'marketplace.top.q_dashboard' : 'marketplace.top.q_orders') + ' ›', path, onNavigate),
    );
    side.append(second);
  }

  const main = el('div', 'home-top__main');
  main.append(earn, slider, side);
  root.append(main);

  // ── Welcome back strip (signed in only) ──────────────────────────────────
  if (isAuthenticated) {
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
