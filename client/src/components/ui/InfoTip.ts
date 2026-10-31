/**
 * InfoTip — a small (i) button that holds an instruction or explanation next to a title.
 *
 * Usage: `InfoTip({ content: 'What this page is for…' })` returns a <button>; place it beside the
 * heading it explains. Hover/focus shows the text in a popup (via Tooltip). Click/tap expands the
 * text in place, as a panel under the title, and a second click folds it away again — so touch
 * users get it too, and a long instruction can be read without holding the pointer still.
 *
 * The panel is `panel` when given (pageInfo passes the folded subtitle itself, so the expanded
 * text sits exactly where the subtitle used to be); otherwise one is created on the first click
 * and placed right after the heading/label the button sits in.
 *
 * Invariants:
 *  - It carries explanatory copy only. Anything a user MUST read to avoid a mistake (a warning,
 *    an irreversible-action notice, an error) stays visible in the page — see services/pageInfo.ts.
 *  - The accessible name is the content itself, so a screen reader hears the explanation when the
 *    button is focused rather than "more information" followed by a hidden tooltip.
 *  - While expanded, the hover popup stays shut (Tooltip skips an `aria-expanded="true"`
 *    trigger): the same text twice on screen is noise.
 */

import { Tooltip } from './Tooltip.ts';
import type { TooltipPlacement } from './Tooltip.ts';
import { ICONS } from './icons.ts';
import { t } from '../../services/i18n.ts';

const PANEL_ANCHOR = 'h1,h2,h3,h4,h5,h6,label,legend';
let panelSeq = 0;

/** The (i) button; `setContent` replaces the tip text, the panel text and the accessible name. */
export interface InfoTipElement extends HTMLButtonElement {
  setContent(next: string): void;
}

export function InfoTip({
  content = '',
  label = '',
  placement = 'bottom',
  panel = null,
}: {
  content?: string;
  label?: string;
  placement?: TooltipPlacement | string;
  /** The element that shows the text when expanded; toggled with `data-info-open`. */
  panel?: HTMLElement | null;
} = {}): InfoTipElement {
  const btn = document.createElement('button') as InfoTipElement;
  btn.type = 'button';
  btn.className = 'info-tip';
  btn.innerHTML = ICONS.info;
  btn.setAttribute('aria-label', label || content || t('common.more_info'));
  btn.setAttribute('aria-expanded', 'false');

  let text = content;
  let own: HTMLElement | null = null; // the panel this tip created, when none was passed in

  const handle = Tooltip({ trigger: btn, content, placement });
  handle.element.classList.add('tooltip--info');

  function target(): HTMLElement {
    if (panel) return panel;
    if (!own) {
      own = document.createElement('div');
      own.className = 'info-tip__panel';
      own.textContent = text;
    }
    if (!own.isConnected) {
      // WHY: inside a heading the panel would inherit heading type and break the title row, so
      // it goes after the heading/label the (i) belongs to.
      const anchor = btn.closest(PANEL_ANCHOR) || btn.parentElement;
      anchor?.insertAdjacentElement('afterend', own);
    }
    return own;
  }

  function setOpen(open: boolean) {
    const el = target();
    if (!el.id) el.id = `info-panel-${(panelSeq += 1)}`;
    btn.setAttribute('aria-controls', el.id);
    btn.setAttribute('aria-expanded', String(open));
    el.toggleAttribute('data-info-open', open);
    if (open) handle.hide();
  }

  btn.addEventListener('click', (event) => {
    // WHY: the (i) often sits inside a clickable header/summary — pressing it must not also
    // trigger that parent's action.
    event.preventDefault();
    event.stopPropagation();
    setOpen(btn.getAttribute('aria-expanded') !== 'true');
  });
  btn.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') setOpen(false);
  });

  btn.setContent = (next) => {
    text = next;
    handle.setContent(next);
    if (own) own.textContent = next;
    btn.setAttribute('aria-label', next || t('common.more_info'));
  };
  return btn;
}
