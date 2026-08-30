/**
 * mocks/index.js — the mock API router.
 *
 * Responsibility: give core/api.js something to resolve against when VITE_API_MODE=mock, so the
 * whole app is previewable before the backend (Phase 2+) exists. Each handler module registers
 * `{ method, path, handler(ctx) }` entries; `path` is matched the same way core/router.js matches
 * page routes, reusing its `matchPath` so the two systems agree on `:param` syntax.
 */
import { matchPath, parseQuery } from '../core/router.js';
import productHandlers from './handlers/products.js';
import storeHandlers from './handlers/stores.js';
import accessHandlers from './handlers/access.js';
import reviewHandlers from './handlers/reviews.js';
import qnaHandlers from './handlers/qna.js';
import authHandlers from './handlers/auth.js';
import cartHandlers from './handlers/cart.js';
import orderHandlers from './handlers/orders.js';
import bundleHandlers from './handlers/bundles.js';
import { b2bEscrowHandlers } from './handlers/b2bEscrow.js';
import { developerHandlers } from './handlers/developer.js';
import { contentHandlers } from './handlers/content.js';
import supplierHandlers from './handlers/supplier.js';
import salerHandlers from './handlers/saler.js';
import adminHandlers from './handlers/admin.js';
import vaultHandlers from './handlers/vault.js';
import liveHandlers from './handlers/live.js';
import warrantyHandlers from './handlers/warranty.js';
import moderatorHandlers from './handlers/moderator.js';
import disputeHandlers from './handlers/disputes.js';
import returnHandlers from './handlers/returns.js';
import campaignHandlers from './handlers/campaigns.js';
import themeHandlers from './handlers/theme.js';
import { teamPurchaseHandlers } from './handlers/teamPurchase.js';
import { gamificationHandlers } from './handlers/gamification.js';
import { referralHandlers } from './handlers/referral.js';
import { customerHandlers } from './handlers/customer.js';
import { notificationHandlers } from './handlers/notifications.js';
import chatHandlers from './handlers/chat.js';

const handlers = [
  ...authHandlers,
  ...productHandlers,
  ...storeHandlers,
  ...accessHandlers,
  ...reviewHandlers,
  ...qnaHandlers,
  ...cartHandlers,
  ...orderHandlers,
  ...bundleHandlers,
  ...b2bEscrowHandlers,
  ...developerHandlers,
  ...contentHandlers,
  ...supplierHandlers,
  ...salerHandlers,
  ...adminHandlers,
  ...vaultHandlers,
  ...liveHandlers,
  ...warrantyHandlers,
  ...moderatorHandlers,
  ...disputeHandlers,
  ...returnHandlers,
  ...campaignHandlers,
  ...themeHandlers,
  ...teamPurchaseHandlers,
  ...gamificationHandlers,
  ...referralHandlers,
  ...customerHandlers,
  ...notificationHandlers,
  ...chatHandlers,
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
  const [cleanPath, search] = path.split('?');
  const parsedQuery = { ...(search ? parseQuery(search) : {}), ...(query ?? {}) };

  for (const entry of handlers) {
    if (entry.method !== method) continue;
    const params = matchPath(entry.path, cleanPath);
    if (!params) continue;
    return entry.handler({ params, query: parsedQuery, body });
  }
  return notFoundBody(path);
}
