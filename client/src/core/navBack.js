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
import { t, getLanguage } from '../services/i18n.js';

export const CHEVRON_LEFT_SVG = `<svg class="back-btn__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>`;

/**
 * Safely resolves a localized label ensuring the result matches the intended language script.
 */
function resolveLabel(key, bnDefault, enDefault, activeLang) {
  if (activeLang === 'bn') {
    const translated = t(key);
    return (translated && /[\u0980-\u09FF]/.test(translated)) ? translated : bnDefault;
  }
  return enDefault;
}

/**
 * Resolves the destination page title and fallback path based on the origin URL `fromPath`.
 */
export function getBackDestination(fromPath, lang = 'en') {
  const activeLang = lang || getLanguage() || 'en';

  if (!fromPath) {
    return {
      name: resolveLabel('common.marketplace', 'মার্কেটপ্লেস', 'Marketplace', activeLang),
      path: '/',
    };
  }

  // Strip query string and hash for path matching
  const pathname = fromPath.split('?')[0].split('#')[0] || '/';

  // 1. Marketplace root
  if (pathname === '/' || pathname === '/marketplace' || pathname.startsWith('/marketplace/')) {
    return {
      name: resolveLabel('common.marketplace', 'মার্কেটপ্লেস', 'Marketplace', activeLang),
      path: '/',
    };
  }

  // 2. Shopping & Commerce flows
  if (pathname === '/cart' || pathname.startsWith('/cart/')) {
    return {
      name: resolveLabel('common.cart', 'কার্ট', 'Cart', activeLang),
      path: '/cart',
    };
  }
  if (pathname === '/checkout' || pathname.startsWith('/checkout/')) {
    return {
      name: resolveLabel('common.checkout', 'চেকআউট', 'Checkout', activeLang),
      path: '/checkout',
    };
  }
  if (pathname === '/search' || pathname.startsWith('/search/')) {
    return {
      name: resolveLabel('common.search', 'অনুসন্ধান', 'Search', activeLang),
      path: fromPath,
    };
  }
  if (pathname.startsWith('/category')) {
    return {
      name: resolveLabel('common.category', 'ক্যাটাগরি', 'Category', activeLang),
      path: fromPath,
    };
  }
  if (pathname.startsWith('/product/')) {
    return {
      name: resolveLabel('common.product', 'পণ্য', 'Product', activeLang),
      path: fromPath,
    };
  }
  if (pathname === '/live' || pathname.startsWith('/live/')) {
    return {
      name: resolveLabel('common.live', 'লাইভ শপিং', 'Live Shopping', activeLang),
      path: '/live',
    };
  }
  if (pathname === '/stories' || pathname.startsWith('/stories/')) {
    return {
      name: resolveLabel('common.stories', 'স্টোরিজ', 'Stories', activeLang),
      path: '/stories',
    };
  }

  // 3. Customer Account sub-surfaces (Specific pages matched BEFORE generic /account)
  if (pathname === '/account/orders' || pathname.startsWith('/account/orders/') || pathname === '/orders' || pathname.startsWith('/orders/')) {
    return {
      name: resolveLabel('common.orders', 'অর্ডারসমূহ', 'Orders', activeLang),
      path: '/account/orders',
    };
  }
  if (pathname === '/account/wishlist' || pathname.startsWith('/account/wishlist/') || pathname === '/wishlist' || pathname.startsWith('/wishlist/')) {
    return {
      name: resolveLabel('common.wishlist', 'উইশলিস্ট', 'Wishlist', activeLang),
      path: '/account/wishlist',
    };
  }
  if (pathname === '/account/coupons' || pathname.startsWith('/account/coupons/') || pathname === '/coupons' || pathname.startsWith('/coupons/')) {
    return {
      name: resolveLabel('common.coupons', 'কুপন ও ভাউচার', 'Coupons', activeLang),
      path: '/account/coupons',
    };
  }
  if (pathname === '/account/coins' || pathname.startsWith('/account/coins/')) {
    return {
      name: resolveLabel('common.coins', 'কয়েন ও স্ট্রিক', 'Coins & Streak', activeLang),
      path: '/account/coins',
    };
  }
  if (pathname === '/account/team-purchases' || pathname.startsWith('/account/team-purchases/') || pathname.startsWith('/team')) {
    return {
      name: resolveLabel('common.team_purchases', 'টিম পারচেজ', 'Team Purchases', activeLang),
      path: '/account/team-purchases',
    };
  }
  if (pathname === '/account/warranties' || pathname.startsWith('/account/warranties/')) {
    return {
      name: resolveLabel('common.warranties', 'ওয়ারেন্টি', 'Warranties', activeLang),
      path: '/account/warranties',
    };
  }
  if (pathname === '/account/returns' || pathname.startsWith('/account/returns/')) {
    return {
      name: resolveLabel('common.returns', 'রিটার্ন', 'Returns', activeLang),
      path: '/account/returns',
    };
  }
  if (pathname === '/account/reviews' || pathname.startsWith('/account/reviews/')) {
    return {
      name: resolveLabel('common.reviews', 'রিভিউ', 'Reviews', activeLang),
      path: '/account/reviews',
    };
  }
  if (pathname === '/account/following' || pathname.startsWith('/account/following/')) {
    return {
      name: resolveLabel('common.following', 'পছন্দের দোকান', 'Following', activeLang),
      path: '/account/following',
    };
  }
  if (pathname === '/account/addresses' || pathname.startsWith('/account/addresses/')) {
    return {
      name: resolveLabel('common.addresses', 'ডেলিভারি ঠিকানা', 'Addresses', activeLang),
      path: '/account/addresses',
    };
  }
  if (pathname === '/account/profile' || pathname.startsWith('/account/profile/') || pathname === '/profile' || pathname.startsWith('/profile/')) {
    return {
      name: resolveLabel('common.profile', 'প্রোফাইল', 'Profile', activeLang),
      path: '/account/profile',
    };
  }
  if (pathname === '/account/settings' || pathname.startsWith('/account/settings/') || pathname === '/settings' || pathname.startsWith('/settings/')) {
    return {
      name: resolveLabel('common.settings', 'সেটিংস', 'Settings', activeLang),
      path: '/account/settings',
    };
  }
  if (pathname === '/account/become-saler' || pathname.startsWith('/account/become-saler/')) {
    return {
      name: resolveLabel('nav.customer.become_saler', 'সেলার একাউন্ট', 'Become a Saler', activeLang),
      path: '/account/become-saler',
    };
  }

  // 4. Customer Account Dashboard hub
  if (pathname === '/account' || pathname === '/customer') {
    return {
      name: resolveLabel('common.account', 'অ্যাকাউন্ট', 'Account', activeLang),
      path: '/account',
    };
  }

  // 5. Saler & Supplier Portals
  if (pathname.startsWith('/supplier')) {
    return {
      name: resolveLabel('common.dashboard', 'ড্যাশবোর্ড', 'Dashboard', activeLang),
      path: '/supplier',
    };
  }
  if (pathname.startsWith('/saler')) {
    return {
      name: resolveLabel('common.dashboard', 'ড্যাশবোর্ড', 'Dashboard', activeLang),
      path: '/saler',
    };
  }
  if (pathname.startsWith('/admin')) {
    return {
      name: resolveLabel('common.admin', 'অ্যাডমিন', 'Admin', activeLang),
      path: '/admin',
    };
  }

  return {
    name: resolveLabel('common.marketplace', 'মার্কেটপ্লেস', 'Marketplace', activeLang),
    path: '/',
  };
}

/**
 * Checks whether a label passed to renderBackLink is a generic fallback ("Account", "Back", etc.)
 * that should be replaced with the dynamically detected origin destination name.
 */
function isGenericFallbackLabel(label) {
  if (!label) return true;
  const trimmed = label.trim();
  const genericStrings = [
    'Account',
    'অ্যাকাউন্ট',
    'Back',
    'ফিরে যান',
    'Account Dashboard',
    'ড্যাশবোর্ড',
    'Back to Account',
    t('common.account'),
    t('common.back'),
    t('wishlist.back_to_account'),
    t('gamification.back_to_account'),
    t('customer_returns.back_to_account'),
    t('order_tracking.back_to_account'),
    t('customer.orders.back_to_account'),
    t('customer.following.back_to_account', 'Account Dashboard'),
  ];
  return genericStrings.includes(trimmed);
}

/**
 * Renders HTML string for a back link with the '<' chevron icon and label.
 * Dynamically resolves the origin page name when navigating inside the app.
 */
export function renderBackLink({ href = '/account', label = '', className = 'account-page__back', id = '' } = {}) {
  const lang = getLanguage();
  const fromPath = typeof window !== 'undefined' ? window.history?.state?.fromPath : null;

  // Resolve destination based on real navigation history, falling back to href
  const dest = getBackDestination(fromPath || href, lang);
  const effectiveLabel = isGenericFallbackLabel(label) ? dest.name : label;
  const effectiveHref = fromPath || href || dest.path;

  return `<a href="${effectiveHref}" class="${className}"${id ? ` id="${id}"` : ''} data-nav-back>
    ${CHEVRON_LEFT_SVG}
    <span>${effectiveLabel}</span>
  </a>`;
}

/**
 * Creates a DOM element for a back link with the '<' chevron icon, label, and wired click handler.
 */
export function createBackButton({ href = '/account', label = '', className = 'account-page__back', id = '', navigate } = {}) {
  const lang = getLanguage();
  const fromPath = typeof window !== 'undefined' ? window.history?.state?.fromPath : null;
  const dest = getBackDestination(fromPath || href, lang);
  const effectiveLabel = isGenericFallbackLabel(label) ? dest.name : label;
  const effectiveHref = fromPath || href || dest.path;

  const a = document.createElement('a');
  a.href = effectiveHref;
  a.className = className;
  if (id) a.id = id;
  a.setAttribute('data-nav-back', '');
  a.innerHTML = `${CHEVRON_LEFT_SVG}<span>${effectiveLabel}</span>`;
  bindBackControl(a, navigate, effectiveHref);
  return a;
}

export function goBack(navigate, fallback = '/account') {
  const depth = window.history.state?.idx ?? 0;
  const fromPath = window.history.state?.fromPath;

  if (depth > 0) {
    window.history.back();
    return;
  }

  const target = fromPath || fallback;
  if (typeof navigate === 'function') {
    navigate(target, { replace: true });
  } else {
    window.location.assign(target);
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

