/**
 * mocks/index.ts — the mock API router.
 *
 * Responsibility: give core/api.ts something to resolve against when VITE_API_MODE=mock, so the
 * whole app is previewable before the backend (Phase 2+) exists. Each handler module registers
 * `{ method, path, handler(ctx) }` entries; `path` is matched the same way core/router.js matches
 * page routes, reusing its `matchPath` so the two systems agree on `:param` syntax.
 */
import { matchPath, parseQuery } from '../core/router.js';
import productHandlers from './handlers/products.js';
import discoveryHandlers from './handlers/discovery.js';
import storeHandlers from './handlers/stores.js';
import accessHandlers from './handlers/access.ts';
import reviewHandlers from './handlers/reviews.js';
import qnaHandlers from './handlers/qna.ts';
import authHandlers from './handlers/auth.js';
import cartHandlers from './handlers/cart.js';
import orderHandlers from './handlers/orders.js';
import bundleHandlers from './handlers/bundles.js';
import { b2bEscrowHandlers } from './handlers/b2bEscrow.js';
import { developerHandlers } from './handlers/developer.js';
import { contentHandlers } from './handlers/content.js';
import supplierHandlers from './handlers/supplier.js';
import sampleKitHandlers from './handlers/sampleKit.js';
import payoutProtectionHandlers from './handlers/payoutProtection.ts';
import salerHandlers from './handlers/saler.js';
import adminHandlers from './handlers/admin.js';
import moduleHandlers from './handlers/modules.ts';
import pageAccessHandlers from './handlers/pageAccess.js';
import vaultHandlers from './handlers/vault.js';
import liveHandlers from './handlers/live.js';
import warrantyHandlers from './handlers/warranty.js';
import moderatorHandlers from './handlers/moderator.js';
import disputeHandlers from './handlers/disputes.js';
import returnHandlers from './handlers/returns.js';
import campaignHandlers from './handlers/campaigns.js';
import adsHandlers from './handlers/ads.js';
import themeHandlers from './handlers/theme.js';
import { localizationHandlers } from './handlers/localization.js';
import { genieHandlers } from './handlers/genie.ts';
import { deliveryHandlers } from './handlers/delivery.ts';
import { attributionHandlers } from './handlers/attribution.ts';
import { partnerRewardHandlers } from './handlers/partnerReward.js';
import { walletTopupHandlers } from './handlers/walletTopup.ts';
import { recommendationHandlers } from './handlers/recommendations.js';
import { teamPurchaseHandlers } from './handlers/teamPurchase.js';
import { gamificationHandlers } from './handlers/gamification.js';
import { referralHandlers } from './handlers/referral.js';
import { customerHandlers } from './handlers/customer.js';
import { homeSummaryHandlers } from './handlers/homeSummary.ts';
import { notificationHandlers } from './handlers/notifications.js';
import chatHandlers from './handlers/chat.js';
import meHandlers from './handlers/me.js';
import mediaHandlers from './handlers/media.ts';
import moderatorToolsHandlers from './handlers/moderatorTools.js';
import communityHandlers from './handlers/community.js';
import type { MockRoute, MockReply } from './types.ts';

// WHY `method: string`: the handler modules that are still .js infer it as a plain string; a typed
// module (those that end in `satisfies MockRoute[]`) is narrower and fits. Tighten this to MockRoute
// once the last handler file is typed.
const handlers: (Omit<MockRoute, 'method'> & { method: string })[] = [
  ...authHandlers,
  ...productHandlers,
  ...discoveryHandlers,
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
  ...sampleKitHandlers,
  ...payoutProtectionHandlers,
  ...salerHandlers,
  ...adminHandlers,
  ...moduleHandlers,
  ...pageAccessHandlers,
  ...vaultHandlers,
  ...liveHandlers,
  ...warrantyHandlers,
  ...moderatorHandlers,
  ...disputeHandlers,
  ...returnHandlers,
  ...campaignHandlers,
  ...adsHandlers,
  ...themeHandlers,
  ...localizationHandlers,
  ...genieHandlers,
  ...deliveryHandlers,
  ...attributionHandlers,
  ...partnerRewardHandlers,
  ...walletTopupHandlers,
  ...recommendationHandlers,
  ...teamPurchaseHandlers,
  ...gamificationHandlers,
  ...referralHandlers,
  ...customerHandlers,
  ...homeSummaryHandlers,
  ...notificationHandlers,
  ...chatHandlers,
  ...meHandlers,
  ...mediaHandlers,
  ...moderatorToolsHandlers,
  ...communityHandlers,
];

function notFoundBody(path: string): MockReply {
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
export function handleMockRequest({ method, path, query, body }: { method: string; path: string; query?: Record<string, unknown> | null; body?: unknown }): MockReply {
  const [cleanPath, search] = path.split('?');
  const parsedQuery = { ...(search ? parseQuery(search) : {}), ...(query ?? {}) };

  for (const entry of handlers) {
    if (entry.method !== method) continue;
    const params = matchPath(entry.path, cleanPath);
    if (!params) continue;
    const res = entry.handler({ params: params as Record<string, string>, query: parsedQuery, body });
    if (res && typeof res === 'object' && (res as MockReply).status !== undefined) {
      return res as MockReply;
    }
    return { status: 200, body: res };
  }
  return notFoundBody(path);
}
