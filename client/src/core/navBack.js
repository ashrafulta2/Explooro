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
