/**
 * floatingScroll.js — Universal Floating Horizontal Scrollbar Service.
 *
 * Responsibility:
 * Monitors wide tables and horizontally scrollable containers across the application.
 * When a container overflows horizontally and its bottom edge is below the screen fold,
 * a floating horizontal scrollbar docks at the bottom of the viewport so users can scroll
 * horizontally without needing to scroll down to the bottom of the page first.
 *
 * Zero runtime dependencies, high performance with requestAnimationFrame + ResizeObserver.
 */

const observedElements = new Set();
let barEl = null;
let barInner = null;
let currentTarget = null;
let isSyncing = false;
let isInteracting = false;
let rafId = null;
let scanTimer = null;
let resizeObserver = null;
let mutationObserver = null;

function onTargetScroll() {
  if (isSyncing || !barEl || !currentTarget) return;
  isSyncing = true;
  barEl.scrollLeft = currentTarget.scrollLeft;
  requestAnimationFrame(() => {
    isSyncing = false;
  });
}

function update() {
  if (!barEl) return;

  const viewportH = window.innerHeight;

  // Offset for mobile navigation if active
  let bottomOffset = 0;
  const mobileNav = document.querySelector('.mobile-nav, .app-shell__mobilenav-slot');
  if (mobileNav) {
    const cs = window.getComputedStyle(mobileNav);
    if (cs.display !== 'none' && cs.visibility !== 'hidden') {
      const navRect = mobileNav.getBoundingClientRect();
      if (navRect.height > 0 && navRect.top < viewportH) {
        bottomOffset = Math.max(0, viewportH - navRect.top);
      }
    }
  }

  const effectiveBottom = viewportH - bottomOffset;

  let bestCandidate = null;
  let maxVisibleHeight = 0;

  for (const el of observedElements) {
    if (!el.isConnected) {
      observedElements.delete(el);
      continue;
    }

    // Check if element has horizontal overflow
    if (el.scrollWidth <= el.clientWidth + 1) continue;

    const rect = el.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, effectiveBottom);
    const visibleHeight = visibleBottom - visibleTop;

    // Conditions to show floating scrollbar:
    // 1. Table bottom is below the visible viewport fold (native scrollbar is off-screen)
    // 2. Table top is above the viewport fold (some content is visible)
    // 3. Meaningful content height in view (> 40px)
    if (rect.bottom > effectiveBottom + 2 && rect.top < effectiveBottom - 40 && visibleHeight > 40) {
      if (visibleHeight > maxVisibleHeight) {
        maxVisibleHeight = visibleHeight;
        bestCandidate = el;
      }
    }
  }

  if (!bestCandidate) {
    if (currentTarget) {
      currentTarget.removeEventListener('scroll', onTargetScroll);
      currentTarget = null;
    }
    barEl.style.display = 'none';
    return;
  }

  // Switch target if different
  if (bestCandidate !== currentTarget) {
    if (currentTarget) {
      currentTarget.removeEventListener('scroll', onTargetScroll);
    }
    currentTarget = bestCandidate;
    currentTarget.addEventListener('scroll', onTargetScroll, { passive: true });
  }

  // Calculate visible horizontal bounds aligned with the table
  const rect = currentTarget.getBoundingClientRect();
  const visibleLeft = Math.max(0, rect.left);
  const visibleRight = Math.min(window.innerWidth, rect.right);
  const visibleWidth = Math.max(0, visibleRight - visibleLeft);

  if (visibleWidth <= 0) {
    barEl.style.display = 'none';
    return;
  }

  barEl.style.display = 'block';
  barEl.style.position = 'fixed';
  barEl.style.bottom = `${bottomOffset}px`;
  barEl.style.left = `${visibleLeft}px`;
  barEl.style.width = `${visibleWidth}px`;

  // Update inner dummy width to mirror target scrollWidth
  barInner.style.width = `${currentTarget.scrollWidth}px`;

  // Sync scrollLeft from target unless user is actively dragging the floating bar
  if (!isInteracting && Math.abs(barEl.scrollLeft - currentTarget.scrollLeft) > 1) {
    isSyncing = true;
    barEl.scrollLeft = currentTarget.scrollLeft;
    requestAnimationFrame(() => {
      isSyncing = false;
    });
  }
}

export function updateFloatingScroll() {
  update();
}

export function scheduleUpdate() {
  if (rafId) return;
  let executed = false;
  rafId = requestAnimationFrame(() => {
    executed = true;
    rafId = null;
    update();
  });
  if (executed) {
    rafId = null;
  }
}

export function registerScrollable(el) {
  if (!el || observedElements.has(el)) return;
  if (el.classList.contains('no-floating-scroll') || el.hasAttribute('data-no-floating-scroll')) return;

  observedElements.add(el);
  resizeObserver?.observe(el);
  scheduleUpdate();
}

export function scanForScrollables() {
  const root = document.getElementById('router-outlet') || document.body;
  if (!root || typeof root.querySelectorAll !== 'function') return;

  const selector = [
    '.saler-table-wrap',
    '.catalog-table-wrap',
    '.table-wrapper',
    '.table-container',
    '.overflow-x-auto',
    '.admin-table-wrap',
    '[data-floating-scroll]',
    '[class*="table-wrap"]',
    '[class*="table-container"]',
  ].join(',');

  const knownList = root.querySelectorAll(selector);
  for (const el of knownList) {
    registerScrollable(el);
  }

  const candidates = root.querySelectorAll('div, section, main');
  for (const el of candidates) {
    if (observedElements.has(el)) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientHeight >= 60) {
      const cs = window.getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && cs.scrollbarWidth !== 'none') {
        registerScrollable(el);
      }
    }
  }

  scheduleUpdate();
}

function scheduleScan() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanForScrollables();
  }, 100);
}

export function initFloatingScroll() {
  if (typeof document === 'undefined') return;
  if (barEl) return; // already initialized

  // Create single shared floating scrollbar element
  barEl = document.createElement('div');
  barEl.className = 'floating-scroll-bar';
  barEl.setAttribute('aria-hidden', 'true');

  barInner = document.createElement('div');
  barInner.className = 'floating-scroll-bar__inner';
  barEl.append(barInner);

  document.body.append(barEl);

  // Sync scroll from floating bar to active target
  barEl.addEventListener('scroll', () => {
    if (isSyncing || !currentTarget) return;
    isSyncing = true;
    currentTarget.scrollLeft = barEl.scrollLeft;
    requestAnimationFrame(() => {
      isSyncing = false;
    });
  }, { passive: true });

  // Mouse wheel over floating bar translates vertical wheel to horizontal scroll
  barEl.addEventListener('wheel', (e) => {
    if (e.deltaY && !e.deltaX && currentTarget) {
      e.preventDefault();
      barEl.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  // Track user interaction state so automated sync doesn't fight dragging
  barEl.addEventListener('mousedown', () => { isInteracting = true; });
  window.addEventListener('mouseup', () => { isInteracting = false; });
  barEl.addEventListener('touchstart', () => { isInteracting = true; }, { passive: true });
  window.addEventListener('touchend', () => { isInteracting = false; }, { passive: true });

  // Observers
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      scheduleUpdate();
    });
  }

  if (typeof MutationObserver !== 'undefined') {
    mutationObserver = new MutationObserver(() => {
      scheduleScan();
    });

    const targetNode = document.getElementById('router-outlet') || document.body;
    mutationObserver.observe(targetNode, {
      childList: true,
      subtree: true,
    });
  }

  // Global window listeners
  window.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true });
  window.addEventListener('resize', () => {
    scheduleScan();
    scheduleUpdate();
  }, { passive: true });

  // Initial scan
  scanForScrollables();
}
