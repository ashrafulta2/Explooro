/**
 * ActionResult — the panel that ends a key action (Prompt 13.3): what was done, who the user is
 * waiting on, and what to do next. It replaces the bare toast those actions used to end on.
 *
 * The panel's data is the action's entry in DEAD_ENDS (client/src/config/journeys.ts). Its buttons:
 *  - primary   the user's next journey step, from GET /me/next-step, when that step can be done now;
 *              otherwise the dead end's follow-up page
 *  - secondary the follow-up page, when the primary is a journey step somewhere else
 * When the next step is blocked (an admin review, a shopper's order) its reason is shown as the
 * waiting line, so the user knows who acts next and the button offers what they can do meanwhile.
 *
 * Invariants:
 *  - The choice of buttons is `resolveActionResult`, a pure function (client/test/actionResult.test.js).
 *  - Buttons are links, so the router navigates without a page reload and a new tab works too.
 *  - Focus moves to the heading and the panel is announced; reduced motion skips the smooth scroll.
 *  - The panel goes on the page root, not inside the page's own container, because several pages
 *    redraw their container right after the action and would wipe it.
 */

import { t } from '../../services/i18n.ts';
import { fetchNextStep, notifyJourneyChanged, type NextStepData } from '../../services/nextStep.ts';
import { DEAD_ENDS, type DeadEnd } from '../../config/journeys.ts';
import { loadNextStepStyles } from '../../styles/loadNextStepStyles.ts';

export interface ActionLink {
  label: string;
  route: string;
}

export interface ActionResultOptions {
  title: string;
  body: string;
  waiting?: string | null;
  primaryAction?: ActionLink | null;
  secondaryAction?: ActionLink | null;
}

/** What `resolveActionResult` decides, as i18n keys and routes, before any string is looked up. */
export interface ResolvedActionResult {
  title_key: string;
  body_key: string;
  waiting_key: string | null;
  primary: { label_key: string; params?: Record<string, string>; route: string };
  secondary: { label_key: string; route: string } | null;
}

export function deadEndById(id: string): DeadEnd {
  const found = DEAD_ENDS.find((d) => d.id === id);
  if (!found) throw new Error(`ActionResult: no dead end "${id}"`);
  return found;
}

export function resolveActionResult(deadEnd: DeadEnd, next: NextStepData | null): ResolvedActionResult {
  const step = next?.current || null;
  const followUp = { label_key: deadEnd.follow_up_key, route: deadEnd.followUp };
  const base = { title_key: deadEnd.title_key, body_key: deadEnd.hint_key };

  if (step && step.status === 'todo' && step.route) {
    const primary = { label_key: 'journey.result.next_step', params: { step: step.title_key }, route: step.route };
    return { ...base, waiting_key: null, primary, secondary: step.route === deadEnd.followUp ? null : followUp };
  }
  return { ...base, waiting_key: step?.blocked_by?.message_key || null, primary: followUp, secondary: null };
}

let headingSeq = 0;

function link({ label, route }: ActionLink, variant: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = `btn btn--${variant} btn--sm action-result__link`;
  a.href = route;
  a.textContent = label;
  return a;
}

export function ActionResult({ title, body, waiting = null, primaryAction = null, secondaryAction = null }: ActionResultOptions): HTMLElement {
  loadNextStepStyles();
  const panel = document.createElement('section');
  panel.className = 'action-result';
  const headingId = `action-result-heading-${++headingSeq}`;
  panel.setAttribute('aria-labelledby', headingId);

  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  const heading = document.createElement('h2');
  heading.className = 'action-result__title';
  heading.id = headingId;
  heading.tabIndex = -1;
  heading.textContent = title;
  const text = document.createElement('p');
  text.className = 'action-result__body';
  text.textContent = body;
  status.append(heading, text);
  if (waiting) {
    const wait = document.createElement('p');
    wait.className = 'action-result__waiting';
    wait.textContent = waiting;
    status.append(wait);
  }
  panel.append(status);

  const actions = document.createElement('div');
  actions.className = 'action-result__actions';
  if (primaryAction) actions.append(link(primaryAction, 'primary'));
  if (secondaryAction) actions.append(link(secondaryAction, 'secondary'));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn--ghost btn--sm';
  close.textContent = t('journey.result.dismiss');
  close.addEventListener('click', () => panel.remove());
  actions.append(close);
  panel.append(actions);
  return panel;
}

function reveal(panel: HTMLElement) {
  if (!panel.isConnected) return;
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  panel.querySelector<HTMLElement>('.action-result__title')?.focus({ preventScroll: true });
  panel.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/**
 * Puts `panel` at the top of `host` (replacing an earlier one), scrolls to it and focuses its heading.
 * WHY wait for open dialogs: most actions finish inside a Modal or Drawer, which hands focus back to
 * the button that opened it in its `close` event, after its exit animation. Focusing the heading
 * before that would be undone, so the screen reader would never announce the panel.
 */
export function presentPanel(host: HTMLElement, panel: HTMLElement): HTMLElement {
  host.querySelectorAll(':scope > .action-result').forEach((old) => old.remove());
  host.prepend(panel);
  const open = [...document.querySelectorAll('dialog[open]')];
  if (open.length === 0) {
    reveal(panel);
    return panel;
  }
  let pending = open.length;
  let revealed = false;
  const once = () => {
    if (revealed) return;
    revealed = true;
    requestAnimationFrame(() => reveal(panel));
  };
  for (const dialog of open) {
    dialog.addEventListener('close', () => {
      pending -= 1;
      if (pending === 0) once();
    }, { once: true });
  }
  // A dialog that stays open (a persistent nav drawer) must not keep the panel from ever being shown.
  setTimeout(once, 1500);
  return panel;
}

/**
 * Ends the action `deadEndId` with its result panel at the top of `host` (the page root). The next
 * step is fetched after the action's write, which already cleared the server's cached answer.
 */
export async function showActionResult(host: HTMLElement, deadEndId: string): Promise<HTMLElement> {
  const deadEnd = deadEndById(deadEndId);
  notifyJourneyChanged();
  const resolved = resolveActionResult(deadEnd, await fetchNextStep());
  const params = resolved.primary.params ? { step: t(resolved.primary.params.step) } : undefined;
  const panel = ActionResult({
    title: t(resolved.title_key),
    body: t(resolved.body_key),
    waiting: resolved.waiting_key ? t(resolved.waiting_key) : null,
    primaryAction: { label: t(resolved.primary.label_key, params), route: resolved.primary.route },
    secondaryAction: resolved.secondary ? { label: t(resolved.secondary.label_key), route: resolved.secondary.route } : null,
  });
  return presentPanel(host, panel);
}
