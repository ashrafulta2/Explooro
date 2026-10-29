/**
 * mocks/index.ts — the mock API router.
 *
 * Responsibility: give core/api.ts something to resolve against when VITE_API_MODE=mock, so the
 * whole app is previewable before the backend (Phase 2+) exists. Each handler module registers
 * `{ method, path, handler(ctx) }` entries; `path` is matched the same way core/router.ts matches
 * page routes, reusing its `matchPath` so the two systems agree on `:param` syntax.
 */
import { matchPath, parseQuery } from '../core/router.ts';
import productHandlers from './handlers/products.ts';
import discoveryHandlers from './handlers/discovery.ts';
import storeHandlers from './handlers/stores.ts';
import accessHandlers from './handlers/access.ts';
import reviewHandlers from './handlers/reviews.ts';
import qnaHandlers from './handlers/qna.ts';
import authHandlers from './handlers/auth.ts';
import cartHandlers from './handlers/cart.ts';
import orderHandlers from './handlers/orders.ts';
import bundleHandlers from './handlers/bundles.ts';
import { b2bEscrowHandlers } from './handlers/b2bEscrow.ts';
import { developerHandlers } from './handlers/developer.ts';
import { contentHandlers } from './handlers/content.ts';
import supplierHandlers from './handlers/supplier.ts';
import sampleKitHandlers from './handlers/sampleKit.ts';
import payoutProtectionHandlers from './handlers/payoutProtection.ts';
import salerHandlers from './handlers/saler.ts';
import adminHandlers from './handlers/admin.js';
import moduleHandlers from './handlers/modules.ts';
import pageAccessHandlers from './handlers/pageAccess.ts';
import vaultHandlers from './handlers/vault.ts';
import liveHandlers from './handlers/live.ts';
import warrantyHandlers from './handlers/warranty.ts';
import moderatorHandlers from './handlers/moderator.ts';
import disputeHandlers from './handlers/disputes.ts';
import returnHandlers from './handlers/returns.ts';
import campaignHandlers from './handlers/campaigns.ts';
import adsHandlers from './handlers/ads.ts';
import themeHandlers from './handlers/theme.ts';
import { localizationHandlers } from './handlers/localization.ts';
import { genieHandlers } from './handlers/genie.ts';
import { deliveryHandlers } from './handlers/delivery.ts';
import { attributionHandlers } from './handlers/attribution.ts';
import { partnerRewardHandlers } from './handlers/partnerReward.ts';
import { walletTopupHandlers } from './handlers/walletTopup.ts';
import { recommendationHandlers } from './handlers/recommendations.ts';
import { teamPurchaseHandlers } from './handlers/teamPurchase.ts';
import { gamificationHandlers } from './handlers/gamification.ts';
import { referralHandlers } from './handlers/referral.ts';
import { customerHandlers } from './handlers/customer.ts';
import { homeSummaryHandlers } from './handlers/homeSummary.ts';
import { notificationHandlers } from './handlers/notifications.ts';
import chatHandlers from './handlers/chat.ts';
import meHandlers from './handlers/me.ts';
import mediaHandlers from './handlers/media.ts';
import moderatorToolsHandlers from './handlers/moderatorTools.ts';
import communityHandlers from './handlers/community.ts';
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
