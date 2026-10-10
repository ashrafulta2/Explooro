/**
 * styleGate.js — lets the router hold a page back until its lazy stylesheet has arrived.
 *
 * WHY: page CSS that is split out of main.css (70KB gzip budget) is pulled in with a dynamic
 * `import('./x.css')` from inside the page function, which is not awaited — the page mounts its
 * markup in the same tick. On the first visit per page load the chunk is still in flight, so the
 * browser paints unstyled markup (a black rectangle, a stack of bare buttons) for ~100–300ms, and
 * never again until a reload. A gate beats awaiting inside ~25 page modules: each loader registers
 * its in-flight promise here, and the router reads it right after the page function returns.
 *
 * Pure JS with no DOM access, so Node's test runner can import every loader that uses it.
 */

const pending = new Set();

/** Registers an in-flight stylesheet load. Returns the same promise. Never rejects the gate: a
 * failed stylesheet must not keep a page hidden, so settling in either direction releases it. */
export function trackStyleLoad(promise) {
  pending.add(promise);
  const release = () => pending.delete(promise);
  promise.then(release, release);
  return promise;
}

/** Resolves once every stylesheet requested so far has settled; `null` when nothing is in flight
 * so the common case (CSS already cached) costs the router nothing. */
export function stylesPending() {
  if (pending.size === 0) return null;
  return Promise.allSettled([...pending]);
}
