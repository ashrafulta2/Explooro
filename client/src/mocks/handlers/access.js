/**
 * Mock handler for the JIT "Request access" flow (ia-sitemap.md §5, Prompt 1.7 REQUIREMENT 3).
 * "Wired to the real API in Prompt 2.8" — until then this gives LockedNavItem's request modal a
 * real request/response round trip (with mock latency, via core/api.js) instead of a fire-and-
 * forget stub, so the deferred-envelope UI path (docs/api-contract.md §2.2) is exercised now.
 */
function traceId() {
  return `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

export default [
  {
    method: 'POST',
    path: '/access-requests',
    handler({ body }) {
      return {
        status: 202,
        body: {
          deferred: {
            code: 'PERMISSION_PENDING_APPROVAL',
            pending_action_ref: `PAA-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
            action_key: body?.permission ?? 'unknown',
            message_en: 'Sent for approval. Your Admin must approve this before it takes effect.',
            message_bn: 'অনুমোদনের জন্য পাঠানো হয়েছে। কার্যকর হওয়ার আগে আপনার অ্যাডমিনকে এটি অনুমোদন করতে হবে।',
            expires_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
            trace_id: traceId(),
          },
        },
      };
    },
  },
];
