/**
 * HomeTop — the band above the product feed on the marketplace home page.
 *
 * Replaces the old text-only hero. Two layouts share one component:
 *  - Guest / customer: category rail · campaign slider · side cards (Become a Saler, orders/sign in).
 *  - Signed in: the same, plus a "welcome back" strip of role-specific quick links.
 *
 * WHY: nothing here fetches. The slides are shortcuts into the existing feed tabs and the quick
 * links are plain routes, so the band renders instantly and cannot show a number that is wrong.
 * The Become a Saler CTA keeps the one-click flow: guests go to register, customers to the
 * /account/become-saler page that runs BecomeSalerCta, salers to their dashboard.
 */

import { t } from '../../services/i18n.js';

const SLIDES = [
  { id: 'flash',    feed: 'flash',    key: 'marketplace.top.slide_flash' },
  { id: 'verified', feed: 'verified', key: 'marketplace.top.slide_verified' },
  { id: 'reseller', feed: 'reseller', key: 'marketplace.top.slide_reseller' },
];

const RAIL_LIMIT = 7;
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

export function HomeTop({ role, isAuthenticated, categories, lang, onNavigate, onSelectCategory, onSelectFeed }) {
  const root = el('section', 'home-top');
  root.setAttribute('aria-label', t('marketplace.top.label'));
  const cleanups = [];
  // WHY: the three slides are h2s that rotate; the page still needs one stable h1 for SEO and screen readers.
  root.append(el('h1', 'sr-only', t('marketplace.hero.tagline')));

  // ── Category rail ────────────────────────────────────────────────────────
  const rail = el('nav', 'home-top__rail');
  rail.setAttribute('aria-label', t('marketplace.categories.label'));
  rail.append(el('h2', 'home-top__rail-title', t('marketplace.top.categories')));
  for (const cat of categories.slice(0, RAIL_LIMIT)) {
    const label = lang === 'bn' ? (cat.label_bn || cat.id) : (cat.label_en || cat.id);
    const b = el('button', 'home-top__rail-item', label);
    b.type = 'button';
    b.addEventListener('click', () => onSelectCategory(cat.id));
    rail.append(b);
  }
  const all = el('button', 'home-top__rail-item home-top__rail-item--all', `${t('marketplace.top.all_categories')} ›`);
  all.type = 'button';
  all.addEventListener('click', () => onSelectCategory('all'));
  rail.append(all);

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
    const isSaler = role === 'saler';
    const card = el('div', 'home-top__card home-top__card--saler');
    card.append(
      el('h2', 'home-top__card-title', t(isSaler ? 'marketplace.top.saler_card_saler' : 'marketplace.top.saler_card_title')),
      el('p', 'home-top__card-sub', t(isSaler ? 'marketplace.top.saler_card_saler_sub' : 'marketplace.top.saler_card_sub')),
    );
    const path = isSaler ? '/saler' : isAuthenticated ? '/account/become-saler' : '/auth/register';
    card.append(link('home-top__card-cta', t(isSaler ? 'marketplace.top.open_store' : 'marketplace.hero.cta'), path, onNavigate));
    side.append(card);
  }

  const second = el('div', 'home-top__card');
  if (isAuthenticated) {
    const home = CONSOLE_HOME[role];
    const path = home || (role === 'saler' ? '/saler/orders' : '/account/orders');
    second.append(
      el('h2', 'home-top__card-title', t(home ? 'marketplace.top.console_title' : 'marketplace.top.orders_title')),
      el('p', 'home-top__card-sub', t(home ? 'marketplace.top.console_sub' : 'marketplace.top.orders_sub')),
      link('home-top__card-link', t(home ? 'marketplace.top.q_dashboard' : 'marketplace.top.q_orders') + ' ›', path, onNavigate),
    );
  } else {
    second.append(
      el('h2', 'home-top__card-title', t('marketplace.top.signin_title')),
      el('p', 'home-top__card-sub', t('marketplace.top.signin_sub')),
      link('home-top__card-link', t('marketplace.top.signin_cta') + ' ›', '/auth/login', onNavigate),
    );
  }
  side.append(second);

  const main = el('div', 'home-top__main');
  main.append(rail, slider, side);
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
