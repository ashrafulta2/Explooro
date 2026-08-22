/**
 * EmptyState — the designed "nothing here yet" surface.
 *
 * Responsibility: every list, table, and search result in the app renders this when it has no
 * rows. Empty is not a fallback (design-system §16) — it is the state a new user sees FIRST and
 * a frustrated user sees MOST, so it gets the same care as the populated view.
 *
 * Invariants:
 *  - Exactly ONE primary action. A void offering three equally-weighted choices gives the user no
 *    push at all; the whole job of this surface is to make the next step obvious.
 *  - `firstRun` is a distinct tone from `empty`. A new store is an opportunity, not a void —
 *    "Add your first product and start earning", never "No products".
 */

export function EmptyState({
  icon = null,
  title = '',
  description = '',
  action = null,
  secondaryAction = null,
  variant = 'empty',
  compact = false,
} = {}) {
  const root = document.createElement('div');
  root.className = `empty-state empty-state--${variant}`;
  if (compact) root.classList.add('empty-state--compact');

  if (icon) {
    const iconWrap = document.createElement('div');
    iconWrap.className = 'empty-state__icon';
    // Decorative: the title already carries the meaning.
    iconWrap.setAttribute('aria-hidden', 'true');
    iconWrap.append(icon);
    root.append(iconWrap);
  }

  if (title) {
    const titleEl = document.createElement('p');
    titleEl.className = 'empty-state__title';
    titleEl.textContent = title;
    root.append(titleEl);
  }

  if (description) {
    const descEl = document.createElement('p');
    descEl.className = 'empty-state__description';
    descEl.textContent = description;
    root.append(descEl);
  }

  if (action || secondaryAction) {
    const actions = document.createElement('div');
    actions.className = 'empty-state__actions';
    if (action) actions.append(action);
    if (secondaryAction) actions.append(secondaryAction);
    root.append(actions);
  }

  return root;
}
