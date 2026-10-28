/**
 * types.ts — the shapes every mock handler module shares.
 *
 * A handler module exports an array of routes; `index.ts` spreads them all into one list and the
 * first route whose method and `:param` path match answers. A handler may return a bare body
 * (answered as 200) or a `{ status, body }` pair (answered as is).
 */

export type MockMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** What a handler is called with. `body` and `query` are whatever the caller sent. */
export interface MockContext {
  params?: Record<string, string>;
  query?: Record<string, any>;
  body?: any;
  /** The request path; only some callers pass it (the PUT recommendations handler falls back to it). */
  path?: string;
}

/** An answer with an explicit status; anything else a handler returns is wrapped as a 200. */
export interface MockReply {
  status: number;
  body: any;
}

export interface MockRoute {
  method: MockMethod;
  /** Matched like a page route: `/orders/:id`. */
  path: string;
  handler: (ctx: MockContext) => unknown;
}
