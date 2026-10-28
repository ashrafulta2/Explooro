/**
 * Card — the base content surface.
 *
 * Responsibility: every panel that groups related data — product tiles, dashboard stats,
 * settings sections.
 *
 * Invariants:
 *  - SOLID surface, 1px border, elevation-1. No glass, no gradient, ever (design-system §0).
 *    Depth comes from three tokens working together — surface lightness, border, shadow — never
 *    from a colour transition.
 *  - An interactive card renders as a <button>/<a>, not a <div> with a click handler, so it is
 *    reachable by keyboard and announced as actionable without any extra aria.
 *  - Nested radius rule (§5.2): media inside a padded card gets `outer - padding`, or the curves
 *    run non-concentric and the image visibly bulges out of its container.
 */

export interface CardOptions {
  title?: string;
  subtitle?: string;
  /** Bleeds to the card's edge, outside the padded body. */
  media?: Node | null;
  body?: Node | string | null;
  /** Replaces the title/subtitle/actions heading entirely. */
  header?: Node | null;
  footer?: Node | string | null;
  actions?: Node | null;
  /** Renders an <a> (with `href`) or a <button>, never a clickable <div>. */
  interactive?: boolean;
  href?: string;
  elevation?: number;
  padding?: 'none' | 'sm' | 'md' | 'lg' | string;
  onClick?: ((event: MouseEvent) => void) | null;
  ariaLabel?: string;
}

export function Card({
  title = '',
  subtitle = '',
  media = null,
  body = null,
  header = null,
  footer = null,
  actions = null,
  interactive = false,
  href = '',
  elevation = 1,
  padding = 'md',
  onClick = null,
  ariaLabel = '',
}: CardOptions = {}): HTMLElement {
  const tag = interactive ? (href ? 'a' : 'button') : 'div';
  const root = document.createElement(tag);
  root.className = `card card--pad-${padding} card--elevation-${elevation}`;

  if (interactive) {
    root.classList.add('card--interactive');
    if (href) (root as HTMLAnchorElement).href = href;
    else (root as HTMLButtonElement).type = 'button';
    if (ariaLabel) root.setAttribute('aria-label', ariaLabel);
    if (onClick) root.addEventListener('click', onClick);
  }

  // Media sits outside the padded body so it can bleed to the card's edge.
  if (media) {
    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'card__media';
    mediaWrap.append(media);
    root.append(mediaWrap);
  }

  if (header || title || subtitle) {
    const headerEl = document.createElement('div');
    headerEl.className = 'card__header';

    if (header) {
      headerEl.append(header);
    } else {
      const text = document.createElement('div');
      text.className = 'card__heading';
      if (title) {
        const titleEl = document.createElement('h3');
        titleEl.className = 'card__title';
        titleEl.textContent = title;
        text.append(titleEl);
      }
      if (subtitle) {
        const subEl = document.createElement('p');
        subEl.className = 'card__subtitle';
        subEl.textContent = subtitle;
        text.append(subEl);
      }
      headerEl.append(text);
      if (actions) {
        const actionsEl = document.createElement('div');
        actionsEl.className = 'card__actions';
        actionsEl.append(actions);
        headerEl.append(actionsEl);
      }
    }
    root.append(headerEl);
  }

  if (body) {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'card__body';
    bodyEl.append(body);
    root.append(bodyEl);
  }

  if (footer) {
    const footerEl = document.createElement('div');
    footerEl.className = 'card__footer';
    footerEl.append(footer);
    root.append(footerEl);
  }

  return root;
}
