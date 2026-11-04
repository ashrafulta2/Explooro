/**
 * navPrefs.ts — what the sidebar needs to know about the signed-in user for Prompt 13.5's tiers:
 * whether their journey is finished (it picks Simple or Advanced as the starting mode) and which
 * items they pinned above "More".
 *
 * Pins live in this browser, per user and role. WHY not on the server: a pin is a layout convenience
 * like the sidebar's collapsed groups, which are not saved anywhere either; losing it on a new device
 * costs one click.
 */

import { appStore, setJourneyState, setNavPins } from '../state/appStore.ts';
import { fetchNextStep, JOURNEY_CHANGED_EVENT } from './nextStep.ts';

const PIN_KEY = 'explooro:nav-pins:';

function pinKey(userId: unknown, role: string): string {
  return `${PIN_KEY}${userId ?? 'anon'}:${role}`;
}

function readPins(userId: unknown, role: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(pinKey(userId, role)) || '[]');
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/** Pins or unpins one sidebar path for the signed-in user. */
export function togglePin(path: string): void {
  const { auth, shell } = appStore.get();
  if (!auth.role) return;
  const next = shell.navPins.includes(path) ? shell.navPins.filter((p) => p !== path) : [...shell.navPins, path];
  try {
    localStorage.setItem(pinKey(auth.user?.id, auth.role), JSON.stringify(next));
  } catch {
    // Private mode: the pin lasts until reload.
  }
  setNavPins(next);
}

async function refreshJourneyState(): Promise<void> {
  if (!appStore.get().auth.isAuthenticated) return setJourneyState('unknown');
  const data = await fetchNextStep();
  // No answer (module off, opted out, failed): keep the pre-13.5 sidebar rather than guess.
  if (!data || !data.journey) return setJourneyState('unknown');
  setJourneyState(data.progress.done >= data.progress.total ? 'done' : 'new');
}

let started = false;

/** Called once at boot: follows sign-in, sign-out and role changes, and journey progress. */
export function initNavPrefs(): void {
  if (started) return;
  started = true;
  const sync = () => {
    const { auth } = appStore.get();
    setNavPins(auth.isAuthenticated && auth.role ? readPins(auth.user?.id, auth.role) : []);
    refreshJourneyState();
  };
  appStore.selector(
    (s) => ({ signedIn: s.auth.isAuthenticated, role: s.auth.role, user: s.auth.user?.id ?? null }),
    sync
  );
  window.addEventListener(JOURNEY_CHANGED_EVENT, () => refreshJourneyState());
  sync();
}
