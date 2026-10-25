/**
 * store.ts — minimal pub/sub state container.
 *
 * Responsibility: the one piece of client state shared across routes (auth, enabled modules, UI
 * prefs), with zero external dependency (Dependency Policy §1 — no Redux/Zustand/etc.).
 *
 *   const store = createStore({ count: 0 });
 *   store.subscribe((state) => render(state));
 *   const unsubscribe = store.selector((s) => s.count, (count) => render(count)); // only fires on real change
 *   store.set({ count: 1 });
 *   store.update((s) => ({ count: s.count + 1 }));
 */

export type Listener<S> = (state: S) => void;
export type Unsubscribe = () => void;

export interface Store<S extends object> {
  get(): S;
  /** Replaces the whole state. */
  set(next: S | ((state: S) => S)): void;
  /** Merges a patch into the state. */
  update(patch: Partial<S> | ((state: S) => Partial<S>)): void;
  subscribe(listener: Listener<S>): Unsubscribe;
  selector<T>(select: (state: S) => T, listener: (next: T, previous: T) => void): Unsubscribe;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.is(a[key], b[key]));
}

/** `persist` names a localStorage key (`explooro:<persist>`) the state is saved to and restored from. */
export function createStore<S extends object>(
  initialState: S = {} as S,
  { persist }: { persist?: string } = {},
): Store<S> {
  const storageKey = persist ? `explooro:${persist}` : null;
  let state = initialState;
  const listeners = new Set<Listener<S>>();

  if (storageKey) {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) state = { ...state, ...JSON.parse(saved) };
    } catch {
      // Corrupt JSON or storage unavailable (private browsing) — fall back to initialState.
    }
  }

  function persistState(): void {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Storage full/unavailable — persistence is a convenience, not a guarantee.
    }
  }

  function notify(): void {
    persistState();
    for (const listener of listeners) listener(state);
  }

  function get(): S {
    return state;
  }

  function set(next: S | ((state: S) => S)): void {
    state = typeof next === 'function' ? next(state) : next;
    notify();
  }

  function update(patch: Partial<S> | ((state: S) => Partial<S>)): void {
    const partial = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...partial };
    notify();
  }

  function subscribe(listener: Listener<S>): Unsubscribe {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** Subscribes to a derived slice; `listener` only fires when that slice actually changes. */
  function selector<T>(select: (state: S) => T, listener: (next: T, previous: T) => void): Unsubscribe {
    let prev = select(state);
    return subscribe((s) => {
      const next = select(s);
      if (shallowEqual(next, prev)) return;
      const previous = prev;
      prev = next;
      listener(next, previous);
    });
  }

  return { get, set, update, subscribe, selector };
}
