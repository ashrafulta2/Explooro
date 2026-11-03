/**
 * nextStep.ts — the client side of the Next-Step engine (Prompt 13.2).
 *
 * The server decides the step (server/src/services/nextStep.service.ts); this file only fetches it,
 * remembers a "later" for the browser session, and saves the user's opt-out. No page decides on its
 * own what comes next.
 */

import { api } from '../core/api.ts';

export interface NextStepView {
  id: string;
  order: number;
  /** Null when the step is blocked on something the user cannot do from a page. */
  route: string | null;
  title_key: string;
  next_key: string;
  status: 'todo' | 'blocked';
  blocked_by: { reason: string; message_key: string } | null;
}

export interface NextStepData {
  enabled: boolean;
  reason: 'opted_out' | null;
  journey: string | null;
  progress: { done: number; total: number };
  current: NextStepView | null;
  upcoming: NextStepView[];
}

const LATER_KEY = 'explooro:next-step:later';

/**
 * The user's next step, or null when there is nothing to show: the module is off, the request
 * failed, or the user opted out. WHY null on failure: the card is guidance, never a reason for a
 * dashboard to break.
 */
export async function fetchNextStep(): Promise<NextStepData | null> {
  try {
    const res = await api.get('/me/next-step');
    const data = res?.data as NextStepData | undefined;
    return data && data.enabled ? data : null;
  } catch {
    return null;
  }
}

/** "Later" hides one step for this browser session; a different step shows again. */
export function isLater(journey: string | null, stepId: string): boolean {
  try {
    return sessionStorage.getItem(LATER_KEY) === `${journey}:${stepId}`;
  } catch {
    return false;
  }
}

export function setLater(journey: string | null, stepId: string): void {
  try {
    sessionStorage.setItem(LATER_KEY, `${journey}:${stepId}`);
  } catch {
    // Private mode: the card simply hides until the page is reloaded.
  }
}

export async function getShowNextSteps(): Promise<boolean> {
  const res = await api.get('/me/next-step/preference');
  return res?.data?.show_next_steps !== false;
}

export async function setShowNextSteps(show: boolean): Promise<boolean> {
  const res = await api.put('/me/next-step/preference', { show_next_steps: show });
  return res?.data?.show_next_steps !== false;
}
