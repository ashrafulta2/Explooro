/**
 * Badge — compact status, identity, and count indicator.
 *
 * Responsibility: the small trust and state markers that appear beside names, products, and
 * stores — verified sellers, elite tier, open/closed shops, unread counts.
 *
 * Invariants:
 *  - Colour is never the sole carrier of meaning (WCAG 1.4.1). Every variant pairs its colour
 *    with a glyph or with text: verified has a tick, status has a dot AND a word. A colour-blind
 *    user must be able to read the same information a sighted one does.
 *  - Counts are `tabular-nums` and capped ("99+"), so a badge cannot grow unbounded and shove
 *    the layout of whatever sits beside it.
 */

/** Verified tick. Inline SVG per design-system §13: 1.5px stroke, round caps, currentColor. */
function createTick() {
  const wrap = document.createElement('span');
  wrap.className = 'badge__icon';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 2.5 14.6 5l3.5-.4 1 3.4 3 1.9-1.6 3.1 1.6 3.1-3 1.9-1 3.4-3.5-.4L12 21.5 9.4 19l-3.5.4-1-3.4-3-1.9L4.5 11 2.9 7.9l3-1.9 1-3.4L10.4 3Z"/>' +
    '<path d="m8.8 12.2 2.2 2.2 4.2-4.4"/></svg>';
  return wrap;
}

/** Elite star. */
function createStar() {
  const wrap = document.createElement('span');
  wrap.className = 'badge__icon';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9Z"/></svg>';
  return wrap;
}

export function Badge({
  variant = 'neutral',
  label = '',
  status = 'open',
  count = 0,
  maxCount = 99,
  tier = '',
  size = 'md',
} = {}) {
  const badge = document.createElement('span');
  badge.className = `badge badge--${variant} badge--${size}`;

  if (variant === 'verified') {
    badge.append(createTick());
    const text = document.createElement('span');
    text.textContent = label || 'Verified';
    badge.append(text);
    return badge;
  }

  if (variant === 'elite') {
    badge.append(createStar());
    const text = document.createElement('span');
    text.textContent = label || 'Elite';
    badge.append(text);
    return badge;
  }

  if (variant === 'status') {
    badge.dataset.status = status;
    const dot = document.createElement('span');
    dot.className = 'badge__dot';
    dot.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    // The word is not decoration — it is what makes the dot's colour redundant rather than load-bearing.
    text.textContent = label || (status === 'open' ? 'Open' : 'Closed');
    badge.append(dot, text);
    return badge;
  }

  if (variant === 'count') {
    badge.classList.add('badge--numeric');
    const shown = count > maxCount ? `${maxCount}+` : String(count);
    badge.textContent = shown;
    // The raw number stays available to assistive tech even when the visible text is capped.
    badge.setAttribute('aria-label', `${count}`);
    return badge;
  }

  if (variant === 'tier') {
    badge.dataset.tier = tier.toLowerCase();
    badge.textContent = label || tier;
    return badge;
  }

  badge.textContent = label;
  return badge;
}
