/**
 * NextStepCard — the one thing the user should do now (Prompt 13.2).
 *
 * Draws what GET /me/next-step answered; it decides nothing itself. States:
 *   loading   skeleton while the answer is on its way
 *   todo      the step, one primary button to its page, "Later", and "Step 3 of 7"
 *   blocked   the step and who it waits on; a button only when the server left the page on offer
 *   done      every step finished (shown by the gallery and by 13.4's re-open from Help)
 *   empty     the role has no journey: renders nothing
 *
 * Invariants:
 *  - Never a dead button: a blocked step with `route: null` has no navigation button at all.
 *  - "Later" hides this step for the browser session only; a different step shows again.
 *  - Every string comes from the journey keys in both locales (client/test/journeys.test.js).
 */

import { t } from '../../services/i18n.ts';
import { Button } from '../ui/Button.ts';
import { Skeleton } from '../ui/Skeleton.ts';
import { fetchNextStep, isLater, setLater, type NextStepData } from '../../services/nextStep.ts';
import { loadNextStepStyles } from '../../styles/loadNextStepStyles.ts';

export interface NextStepCardOptions {
  data?: NextStepData | null;
  loading?: boolean;
  navigate?: ((path: string) => void) | null;
  /** Called after "Later" hides the card. */
  onLater?: (() => void) | null;
}

let headingSeq = 0;

function go(navigate, route: string) {
  if (typeof navigate === 'function') navigate(route);
  else window.location.assign(route);
}

function progressBar(done: number, total: number): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'next-step-card__bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(total));
  bar.setAttribute('aria-valuenow', String(done));
  bar.setAttribute('aria-label', t('journey.card.progress_label', { done, total }));
  const fill = document.createElement('span');
  fill.className = 'next-step-card__bar-fill';
  fill.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
  bar.append(fill);
  return bar;
}

export function NextStepCard({ data = null, loading = false, navigate = null, onLater = null }: NextStepCardOptions = {}): HTMLElement {
  loadNextStepStyles();
  const card = document.createElement('section');
  card.className = 'next-step-card';

  if (loading) {
    card.classList.add('next-step-card--loading');
    card.setAttribute('aria-busy', 'true');
    card.append(Skeleton({ variant: 'text', lines: 3 }));
    return card;
  }

  if (!data || !data.journey) {
    card.hidden = true;
    return card;
  }

  const headingId = `next-step-heading-${++headingSeq}`;
  card.setAttribute('aria-labelledby', headingId);
  const { done, total } = data.progress;
  const step = data.current;

  const eyebrow = document.createElement('p');
  eyebrow.className = 'next-step-card__eyebrow';
  const heading = document.createElement('h2');
  heading.className = 'next-step-card__title';
  heading.id = headingId;
  const body = document.createElement('p');
  body.className = 'next-step-card__body';
  const actions = document.createElement('div');
  actions.className = 'next-step-card__actions';

  if (!step) {
    card.classList.add('next-step-card--done');
    eyebrow.textContent = t('journey.card.progress_label', { done, total });
    heading.textContent = t('journey.card.done_title');
    body.textContent = t('journey.card.done_body');
    card.append(eyebrow, heading, body, progressBar(done, total));
    return card;
  }

  eyebrow.textContent = `${t('journey.card.label')} · ${t('journey.card.progress', { done: done + 1, total })}`;
  heading.textContent = t(step.title_key);

  if (step.status === 'blocked' && step.blocked_by) {
    card.classList.add('next-step-card--blocked');
    const waiting = document.createElement('p');
    waiting.className = 'next-step-card__waiting';
    waiting.textContent = t(step.blocked_by.message_key);
    body.textContent = t(step.next_key);
    card.append(eyebrow, heading, waiting, body);
    if (step.route) {
      actions.append(Button({ label: t('journey.card.view'), variant: 'secondary', size: 'sm', onClick: () => go(navigate, step.route) }));
    }
  } else {
    body.textContent = t(step.next_key);
    card.append(eyebrow, heading, body);
    if (step.route) {
      actions.append(Button({ label: t('journey.card.go'), variant: 'primary', size: 'sm', onClick: () => go(navigate, step.route) }));
    }
  }

  actions.append(
    Button({
      label: t('journey.card.later'),
      variant: 'ghost',
      size: 'sm',
      onClick: () => {
        setLater(data.journey, step.id);
        card.remove();
        onLater?.();
      },
    })
  );
  card.append(progressBar(done, total), actions);
  return card;
}

/**
 * Fetches the user's next step and puts the card at the top of `container`. Adds nothing when there
 * is no step to show, the user finished every step, or chose "Later" for this one.
 */
export async function mountNextStepCard(container: HTMLElement, { navigate = null }: { navigate?: ((path: string) => void) | null } = {}): Promise<HTMLElement | null> {
  const placeholder = NextStepCard({ loading: true });
  container.prepend(placeholder);
  const data = await fetchNextStep();
  if (!data || !data.current || isLater(data.journey, data.current.id)) {
    placeholder.remove();
    return null;
  }
  const card = NextStepCard({ data, navigate });
  placeholder.replaceWith(card);
  return card;
}
