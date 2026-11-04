/**
 * SetupChecklist — every step of the user's journey on their dashboard, with progress (Prompt 13.4).
 *
 * Drawn from GET /me/next-step (`steps`), so the list, the Next-Step card and the result panels can
 * never disagree on what is done. States:
 *   expanded   under 80% done: every step, the current one with its hint and a button
 *   collapsed  80% or more done: one line naming the next step, with a button and "Show all steps"
 *   hidden     every step done, unless re-opened from Help (`?setup=1` on the dashboard)
 *   all done   the re-opened list with every step ticked
 *
 * Invariants:
 *  - Every step the user can do now is one click away; a blocked step shows who it waits on, never a
 *    dead button; a done step is ticked, with no button.
 *  - The user's own expand/collapse choice is remembered per journey in this browser only.
 *  - Completing a step elsewhere updates the list without a reload: it re-reads after a key action in
 *    this tab (JOURNEY_CHANGED_EVENT) and whenever the page is shown again (another tab, a return).
 */

import { t } from '../../services/i18n.ts';
import { fetchNextStep, JOURNEY_CHANGED_EVENT, type NextStepData, type NextStepView } from '../../services/nextStep.ts';
import { CHECKLIST_COLLAPSE_AT, DASHBOARD_ROUTES, type JourneyRole } from '../../config/journeys.ts';
import { getCurrentUser } from '../../services/session.ts';
import { loadNextStepStyles } from '../../styles/loadNextStepStyles.ts';

export interface SetupChecklistOptions {
  data?: NextStepData | null;
  /** Show it even when every step is done: the Help link's `?setup=1`. */
  forceOpen?: boolean;
  /** Overrides the remembered or default fold; the gallery uses it to show both states. */
  collapsed?: boolean | null;
}

const FOLD_KEY = 'explooro:setup-checklist:collapsed:';
let seq = 0;

function rememberedFold(journey: string): boolean | null {
  try {
    const v = localStorage.getItem(FOLD_KEY + journey);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

function rememberFold(journey: string, collapsed: boolean) {
  try {
    localStorage.setItem(FOLD_KEY + journey, collapsed ? '1' : '0');
  } catch {
    // Private mode: the fold resets on the next visit.
  }
}

/** Whether the checklist should be drawn at all, and folded. Pure, for the tests. */
export function checklistState(data: NextStepData | null, forceOpen = false): 'hidden' | 'expanded' | 'collapsed' | 'all_done' {
  if (!data || !data.enabled || !data.journey || !data.steps?.length) return 'hidden';
  const { done, total } = data.progress;
  if (done >= total) return forceOpen ? 'all_done' : 'hidden';
  return done / total >= CHECKLIST_COLLAPSE_AT ? 'collapsed' : 'expanded';
}

function link(label: string, route: string, variant: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = `btn btn--${variant} btn--sm setup-checklist__link`;
  a.href = route;
  a.textContent = label;
  return a;
}

function stepItem(step: NextStepView, isCurrent: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `setup-checklist__step setup-checklist__step--${step.status}${isCurrent ? ' is-current' : ''}`;
  if (isCurrent) li.setAttribute('aria-current', 'step');

  const mark = document.createElement('span');
  mark.className = 'setup-checklist__mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = step.status === 'done' ? '✓' : String(step.order);

  const text = document.createElement('div');
  text.className = 'setup-checklist__text';
  const title = document.createElement('span');
  title.className = 'setup-checklist__step-title';
  title.textContent = t(step.title_key);
  const state = document.createElement('span');
  state.className = 'sr-only';
  state.textContent = step.status === 'done' ? ` (${t('journey.checklist.status_done')})` : step.status === 'blocked' ? ` (${t('journey.checklist.status_waiting')})` : '';
  title.append(state);
  text.append(title);

  if (isCurrent) {
    const hint = document.createElement('p');
    hint.className = 'setup-checklist__hint';
    hint.textContent = t(step.next_key);
    text.append(hint);
  }
  if (step.status === 'blocked' && step.blocked_by) {
    const wait = document.createElement('p');
    wait.className = 'setup-checklist__waiting';
    wait.textContent = t(step.blocked_by.message_key);
    text.append(wait);
  }
  li.append(mark, text);

  // WHY no button on a done step: it is finished, and some pages (the phone OTP screen) make no sense
  // to reopen. The tick is the whole message.
  if (step.route && step.status === 'todo') {
    li.append(link(t(isCurrent ? 'journey.checklist.do_it' : 'journey.checklist.go'), step.route, isCurrent ? 'primary' : 'secondary'));
  } else if (step.route && step.status === 'blocked') {
    // Waiting on a shopper or a delivery: the page shows the status, so it may be opened.
    li.append(link(t('journey.checklist.open'), step.route, 'ghost'));
  }
  return li;
}

export function SetupChecklist({ data = null, forceOpen = false, collapsed = null }: SetupChecklistOptions = {}): HTMLElement {
  loadNextStepStyles();
  const section = document.createElement('section');
  section.className = 'setup-checklist';
  const state = checklistState(data, forceOpen);
  if (state === 'hidden') {
    section.hidden = true;
    return section;
  }

  const id = ++seq;
  const headingId = `setup-checklist-heading-${id}`;
  const listId = `setup-checklist-list-${id}`;
  section.setAttribute('aria-labelledby', headingId);
  const { done, total } = data.progress;
  const current = data.current;

  const head = document.createElement('div');
  head.className = 'setup-checklist__head';
  const titles = document.createElement('div');
  const heading = document.createElement('h2');
  heading.className = 'setup-checklist__title';
  heading.id = headingId;
  heading.textContent = t(state === 'all_done' ? 'journey.checklist.all_done_title' : state === 'collapsed' ? 'journey.checklist.almost' : 'journey.checklist.title');
  const count = document.createElement('p');
  count.className = 'setup-checklist__count';
  count.textContent = t('journey.checklist.progress', { done, total });
  titles.append(heading, count);
  head.append(titles);

  const bar = document.createElement('div');
  bar.className = 'setup-checklist__bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(total));
  bar.setAttribute('aria-valuenow', String(done));
  bar.setAttribute('aria-labelledby', headingId);
  const fill = document.createElement('span');
  fill.className = 'setup-checklist__bar-fill';
  fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  bar.append(fill);

  const list = document.createElement('ol');
  list.className = 'setup-checklist__list';
  list.id = listId;
  for (const step of data.steps) list.append(stepItem(step, Boolean(current) && step.id === current.id));

  let folded = state === 'all_done' ? false : collapsed ?? rememberedFold(data.journey) ?? state === 'collapsed';

  // The folded line: the next step and its button, so folding never hides what to do.
  const summary = document.createElement('div');
  summary.className = 'setup-checklist__summary';
  if (current) {
    const next = document.createElement('span');
    next.className = 'setup-checklist__summary-text';
    next.textContent = t('journey.checklist.next', { step: t(current.title_key) });
    summary.append(next);
    if (current.route && current.status !== 'blocked') summary.append(link(t('journey.checklist.do_it'), current.route, 'primary'));
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn btn--ghost btn--sm setup-checklist__toggle';
  toggle.setAttribute('aria-controls', listId);
  const paint = () => {
    list.hidden = folded;
    summary.hidden = !folded;
    section.classList.toggle('is-collapsed', folded);
    toggle.setAttribute('aria-expanded', String(!folded));
    toggle.textContent = t(folded ? 'journey.checklist.show_all' : 'journey.checklist.hide');
  };
  toggle.addEventListener('click', () => {
    folded = !folded;
    rememberFold(data.journey, folded);
    paint();
  });
  if (state !== 'all_done') head.append(toggle);

  if (state === 'all_done') {
    const body = document.createElement('p');
    body.className = 'setup-checklist__hint';
    body.textContent = t('journey.checklist.all_done_body');
    section.append(head, bar, body, list);
  } else {
    section.append(head, bar, summary, list);
  }
  paint();
  return section;
}

/**
 * "Show my setup checklist": the Help link that re-opens the list on the user's own dashboard, even
 * once every step is done (REQUIREMENT 2). Null for a role without a journey.
 */
export function setupChecklistLink(): HTMLAnchorElement | null {
  const role = getCurrentUser()?.roles?.[0] as JourneyRole | undefined;
  const dashboard = role ? DASHBOARD_ROUTES[role] : null;
  if (!dashboard) return null;
  const a = document.createElement('a');
  a.className = 'btn btn--secondary btn--sm setup-checklist__link';
  a.href = `${dashboard}?setup=1`;
  a.textContent = t('journey.checklist.reopen');
  return a;
}

/**
 * Fetches the steps and keeps the checklist in `host` current. Re-reads after a key action in this
 * tab and whenever the page becomes visible; stops listening once `host` leaves the page.
 */
export function mountSetupChecklist(host: HTMLElement, { forceOpen = false }: { forceOpen?: boolean } = {}): () => void {
  let disposed = false;
  let inFlight = false;

  async function refresh() {
    if (disposed || inFlight) return;
    inFlight = true;
    try {
      const data = await fetchNextStep();
      if (!disposed) host.replaceChildren(SetupChecklist({ data, forceOpen }));
    } finally {
      inFlight = false;
    }
  }

  const onVisible = () => {
    if (!host.isConnected) return stop();
    if (document.visibilityState === 'visible') refresh();
  };
  const onChanged = () => {
    if (!host.isConnected) return stop();
    refresh();
  };
  function stop() {
    disposed = true;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    window.removeEventListener(JOURNEY_CHANGED_EVENT, onChanged);
  }

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener(JOURNEY_CHANGED_EVENT, onChanged);
  refresh();
  return stop;
}
