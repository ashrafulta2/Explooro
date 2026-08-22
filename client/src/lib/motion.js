/**
 * motion.js — Lightweight (< 3KB) Motion Utility (Prompt 1.10, docs/design-system.md §6, §15).
 *
 * All helpers are interruptible and become no-ops under prefers-reduced-motion.
 * Zero dependencies.
 */

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Attaches physical scale(0.97) press feedback to any tappable element (§15).
 * Uses Web Animations API with an instant duration so it remains interruptible.
 */
export function press(el) {
  if (!el || typeof el.addEventListener !== 'function') return () => {};
  if (prefersReducedMotion()) return () => {};

  let activeAnim = null;

  function handlePointerDown() {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    if (activeAnim) activeAnim.cancel();
    activeAnim = el.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(0.97)' },
      ],
      {
        duration: 90,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards',
      }
    );
  }

  function handlePointerUp() {
    if (activeAnim) {
      activeAnim.cancel();
      activeAnim = el.animate(
        [
          { transform: 'scale(0.97)' },
          { transform: 'scale(1)' },
        ],
        {
          duration: 140,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards',
        }
      );
      activeAnim.onfinish = () => {
        el.style.transform = '';
        activeAnim = null;
      };
    }
  }

  el.addEventListener('pointerdown', handlePointerDown);
  el.addEventListener('pointerup', handlePointerUp);
  el.addEventListener('pointercancel', handlePointerUp);
  el.addEventListener('pointerleave', handlePointerUp);

  return () => {
    el.removeEventListener('pointerdown', handlePointerDown);
    el.removeEventListener('pointerup', handlePointerUp);
    el.removeEventListener('pointercancel', handlePointerUp);
    el.removeEventListener('pointerleave', handlePointerUp);
    if (activeAnim) activeAnim.cancel();
  };
}

/**
 * Choreographs list entrances staggered at 20-30ms per item, capped at 8 items (§6.3).
 * Beyond the cap, all remaining items appear together without crawl.
 */
export function stagger(elements, { delayMs = 25, durationMs = 200, maxItems = 8 } = {}) {
  const list = Array.isArray(elements) ? elements : Array.from(elements || []);
  if (!list.length) return Promise.resolve();

  if (prefersReducedMotion()) {
    list.forEach((el) => {
      if (el && el.style) {
        el.style.opacity = '1';
        el.style.transform = 'none';
      }
    });
    return Promise.resolve();
  }

  const animations = [];

  list.forEach((el, index) => {
    if (!el || typeof el.animate !== 'function') return;
    const effectiveIndex = Math.min(index, maxItems);
    const itemDelay = effectiveIndex * delayMs;

    const anim = el.animate(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: durationMs,
        delay: itemDelay,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)', // --ease-out-quart
        fill: 'both',
      }
    );

    animations.push(
      new Promise((resolve) => {
        anim.onfinish = () => {
          el.style.opacity = '1';
          el.style.transform = 'none';
          resolve();
        };
        anim.oncancel = resolve;
      })
    );
  });

  return Promise.all(animations);
}

/**
 * Computes and sets transform-origin so an overlay animates directly FROM its trigger's position (§6.2).
 */
export function originTransition(overlayEl, triggerEl) {
  if (!overlayEl || !triggerEl || prefersReducedMotion()) return;

  const triggerRect = triggerEl.getBoundingClientRect();
  const overlayRect = overlayEl.getBoundingClientRect();

  if (!overlayRect.width || !overlayRect.height) return;

  // Calculate relative center of trigger within overlay coordinate space
  const triggerCenterX = triggerRect.left + triggerRect.width / 2;
  const triggerCenterY = triggerRect.top + triggerRect.height / 2;

  const originX = Math.max(0, Math.min(100, ((triggerCenterX - overlayRect.left) / overlayRect.width) * 100));
  const originY = Math.max(0, Math.min(100, ((triggerCenterY - overlayRect.top) / overlayRect.height) * 100));

  overlayEl.style.transformOrigin = `${originX.toFixed(1)}% ${originY.toFixed(1)}%`;
}

/**
 * Smooth rolling numeric counter animation (§15).
 * Uses requestAnimationFrame with ease-out timing.
 */
export function countUp(el, from = 0, to = 0, { durationMs = 400, formatter = (n) => Math.round(n).toString() } = {}) {
  if (!el) return;
  const startVal = Number(from) || 0;
  const targetVal = Number(to) || 0;

  if (prefersReducedMotion() || durationMs <= 0 || startVal === targetVal) {
    el.textContent = formatter(targetVal);
    return;
  }

  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    // ease-out-quart curve
    const eased = 1 - Math.pow(1 - progress, 4);
    const currentVal = startVal + (targetVal - startVal) * eased;

    el.textContent = formatter(currentVal);

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = formatter(targetVal);
    }
  }

  requestAnimationFrame(step);
}
