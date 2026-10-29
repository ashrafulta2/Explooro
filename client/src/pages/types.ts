/**
 * pages/types.ts — the contract between core/router.js and every page module.
 *
 * The router calls `mod.default(root, { params, query, navigate })` and keeps whatever the page
 * returns as its cleanup (core/router.js, the doc comment above `createRouter`).
 */

/** What the router hands a page as its second argument. */
export interface PageContext {
  /** Values captured by `:name` segments of the route pattern, already decoded. */
  params?: Record<string, string>;
  /** The parsed query string. */
  query?: Record<string, string>;
  navigate?: (path: string, options?: { replace?: boolean }) => void;
}

/** Returned by a page; the router runs it before mounting the next one. */
export type PageCleanup = () => void;
