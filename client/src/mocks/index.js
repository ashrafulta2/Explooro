/**
 * mocks/index.js — the mock API router.
 *
 * Responsibility: give core/api.js something to resolve against when VITE_API_MODE=mock, so the
 * whole app is previewable before the backend (Phase 2+) exists. Each handler module registers
 * `{ method, path, handler(ctx) }` entries; `path` is matched the same way core/router.js matches
 * page routes, reusing its `matchPath` so the two systems agree on `:param` syntax.
 */
import { matchPath } from '../core/router.js';
import productHandlers from './handlers/products.js';
import storeHandlers from './handlers/stores.js';
import accessHandlers from './handlers/access.js';
import reviewHandlers from './handlers/reviews.js';
import qnaHandlers from './handlers/qna.js';
import authHandlers from './handlers/auth.js';
import cartHandlers from './handlers/cart.js';
import orderHandlers from './handlers/orders.js';

const handlers = [
  ...authHandlers,
  ...productHandlers,
  ...storeHandlers,
  ...accessHandlers,
  ...reviewHandlers,
  ...qnaHandlers,
  ...cartHandlers,
  ...orderHandlers,
];

function notFoundBody(path) {
  return {
    status: 404,
    body: {
      error: {
        code: 'NOT_FOUND',
        message_en: `No mock route for ${path}.`,
        message_bn: `${path} এর জন্য কোনো মক রুট নেই।`,
        trace_id: `MOCK-${Date.now().toString(36).toUpperCase()}`,
      },
    },
  };
}

/** Resolves one mock "request" to `{ status, body }`, mirroring the shape a real fetch would give api.js. */
export function handleMockRequest({ method, path, query, body }) {
  for (const entry of handlers) {
    if (entry.method !== method) continue;
    const params = matchPath(entry.path, path);
    if (!params) continue;
    return entry.handler({ params, query: query ?? {}, body });
  }
  return notFoundBody(path);
}
