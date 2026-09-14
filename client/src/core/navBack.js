/**
 * navBack.js — the "← Back" affordance on interior pages.
 *
 * When the user reached the current page by navigating inside the app, step back through real
 * browser history so Back returns them to wherever they actually came from — a product page,
 * checkout, search results — instead of a hardcoded parent. When the current page is the FIRST
 * entry in the history stack (opened from a typed URL, a bookmark, a shared link, or an external
 * site), `history.back()` would leave Explooro or dead-end, so route to `fallback` instead.
 *
 * Depth is read from `history.state.idx`, which core/router.js stamps on every pushState and the
 * browser preserves across a reload — so refreshing a deep page keeps Back working.
 */
import { t } from '../services/i18n.js';

export const CHEVRON_LEFT_SVG = `<svg class="back-btn__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>`;

/**
 * Resolves the destination page title and fallback path based on the origin URL `fromPath`.
 */
export function getBackDestination(fromPath, lang = 'en') {
  if (!fromPath || fromPath === '/' || fromPath.startsWith('/marketplace')) {
    return {
      name: t('common.marketplace') || (lang === 'bn' ? 'মার্কেটপ্লেস' : 'Marketplace'),
      path: '/',
    };
  }
  if (fromPath.startsWith('/wishlist') || fromPath.startsWith('/account/wishlist')) {
    return {
      name: t('common.wishlist') || (lang === 'bn' ? 'উইশলিস্ট' : 'Wishlist'),
      path: '/account/wishlist',
    };
  }
  if (fromPath.startsWith('/orders') || fromPath.startsWith('/account/orders')) {
    return {
      name: t('common.orders') || (lang === 'bn' ? 'অর্ডারসমূহ' : 'Orders'),
      path: '/account/orders',
    };
  }
  if (fromPath.startsWith('/cart')) {
    return {
      name: t('nav.cart') || (lang === 'bn' ? 'কার্ট' : 'Cart'),
      path: '/cart',
    };
  }
  if (fromPath.startsWith('/search')) {
    return {
      name: t('common.search') || (lang === 'bn' ? 'অনুসন্ধান' : 'Search'),
      path: fromPath,
    };
  }
  if (fromPath.startsWith('/category')) {
    return {
      name: t('common.category') || (lang === 'bn' ? 'ক্যাটাগরি' : 'Category'),
      path: fromPath,
    };
  }
  if (fromPath.startsWith('/account/team-purchases') || fromPath.startsWith('/team')) {
    return {
      name: t('common.team_purchases') || (lang === 'bn' ? 'টিম পারচেজ' : 'Team Purchases'),
      path: '/account/team-purchases',
    };
  }
  if (fromPath.startsWith('/account')) {
    return {
      name: t('common.account') || (lang === 'bn' ? 'অ্যাকাউন্ট' : 'Account'),
      path: '/account',
    };
  }
  if (fromPath.startsWith('/supplier')) {
    return {
      name: t('common.dashboard') || (lang === 'bn' ? 'ড্যাশবোর্ড' : 'Dashboard'),
      path: '/supplier',
    };
  }
  if (fromPath.startsWith('/saler')) {
    return {
      name: t('common.dashboard') || (lang === 'bn' ? 'ড্যাশবোর্ড' : 'Dashboard'),
      path: '/saler',
    };
  }
  return {
    name: t('common.marketplace') || (lang === 'bn' ? 'মার্কেটপ্লেস' : 'Marketplace'),
    path: '/',
  };
}

/**
 * Renders HTML string for a back link with the '<' chevron icon and label.
 */
export function renderBackLink({ href = '/account', label = '', className = 'account-page__back', id = '' } = {}) {
  return `<a href="${href}" class="${className}"${id ? ` id="${id}"` : ''} data-nav-back>
    ${CHEVRON_LEFT_SVG}
    <span>${label}</span>
  </a>`;
}

/**
 * Creates a DOM element for a back link with the '<' chevron icon, label, and wired click handler.
 */
export function createBackButton({ href = '/account', label = '', className = 'account-page__back', id = '', navigate } = {}) {
  const a = document.createElement('a');
  a.href = href;
  a.className = className;
  if (id) a.id = id;
  a.setAttribute('data-nav-back', '');
  a.innerHTML = `${CHEVRON_LEFT_SVG}<span>${label}</span>`;
  bindBackControl(a, navigate, href);
  return a;
}

export function goBack(navigate, fallback = '/account') {
  const depth = window.history.state?.idx ?? 0;

  if (depth > 0) {
    window.history.back();
    return;
  }

  if (typeof navigate === 'function') {
    navigate(fallback, { replace: true });
  } else {
    // No SPA navigate in scope (called from a bare handler) — fall back to a full load.
    window.location.assign(fallback);
  }
}

/**
 * Wires a "← Back" element: keeps its href as the no-JS / middle-click fallback, but intercepts
 * plain left-clicks to run {@link goBack}. Returns nothing; safe to call with a missing element.
 */
export function bindBackControl(el, navigate, fallback = '/account') {
  if (!el) return;
  el.addEventListener('click', (event) => {
    // Let the browser handle new-tab / new-window / download intents.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goBack(navigate, fallback);
  });
}

