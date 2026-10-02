/**
 * InfoTip — a small (i) button that holds an instruction or explanation next to a title.
 *
 * Usage: `InfoTip({ content: 'What this page is for…' })` returns a <button>; place it beside the
 * heading it explains. Hover/focus shows the text (via Tooltip), click/tap pins it open so touch
 * users get it too, Escape or any outside press dismisses it.
 *
 * Invariants:
 *  - It carries explanatory copy only. Anything a user MUST read to avoid a mistake (a warning,
 *    an irreversible-action notice, an error) stays visible in the page — see services/pageInfo.js.
 *  - The accessible name is the content itself, so a screen reader hears the explanation when the
 *    button is focused rather than "more information" followed by a hidden tooltip.
 */

import { Tooltip } from './Tooltip.js';
import { ICONS } from './icons.js';
import { t } from '../../services/i18n.js';

let active = null; // the handle currently pinned open by a click/tap — only one at a time

function dismissActive() {
  if (!active) return;
  active.hide();
  active = null;
}

let globalsBound = false;
function bindGlobals() {
  if (globalsBound) return;
  globalsBound = true;
  document.addEventListener('pointerdown', (event) => {
    if (active && !active.trigger.contains(event.target)) dismissActive();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') dismissActive();
  });
}

export function InfoTip({ content = '', label = '', placement = 'bottom' } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'info-tip';
  btn.innerHTML = ICONS.info;
  btn.setAttribute('aria-label', label || content || t('common.more_info'));

  const handle = Tooltip({ trigger: btn, content, placement });
  handle.element.classList.add('tooltip--info');

  bindGlobals();
  btn.addEventListener('click', (event) => {
    // WHY: the (i) often sits inside a clickable header/summary — pressing it must not also
    // trigger that parent's action.
    event.preventDefault();
    event.stopPropagation();
    if (active && active.trigger !== btn) dismissActive();
    handle.show();
    active = { trigger: btn, hide: handle.hide };
  });

  btn.setContent = (next) => {
    handle.setContent(next);
    btn.setAttribute('aria-label', next || t('common.more_info'));
  };
  return btn;
}
