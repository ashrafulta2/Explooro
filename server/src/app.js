/**
 * app.js — Fastify application factory (Prompt 2.1).
 *
 * Builds (but does not start listening) a fully wired Fastify instance: validated env, the pg
 * pool, the cache driver (redis | memory), the error handler, request context, and the security /
 * rate-limit plugins. `src/index.js` is the thin entrypoint that calls this and starts the server
 * — kept separate so the app can be built and exercised without binding a port.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';

import { loadEnv } from './config/env.js';
import { createDbPool } from './config/db.js';
import { createCache } from './config/cache.js';
import requestContextPlugin from './plugins/requestContext.js';
import errorHandlerPlugin from './plugins/errorHandler.js';
import authenticatePlugin from './middlewares/authenticate.js';
import requirePermissionPlugin from './middlewares/requirePermission.js';
import requireRestrictionPlugin from './middlewares/requireRestriction.js';
import requireModulePlugin from './middlewares/requireModule.js';
import authRoutes from './routes/auth.routes.js';
import meRoutes from './routes/me.routes.js';
import delegationRoutes from './routes/delegation.routes.js';
import restrictionRoutes from './routes/restriction.routes.js';
import auditRoutes from './routes/audit.routes.js';
import moduleRoutes from './routes/module.routes.js';
import userRoutes from './routes/user.routes.js';
import themeRoutes from './routes/theme.routes.js';
import mediaRoutes from './routes/media.routes.js';
import productRoutes from './routes/product.routes.js';
import searchRoutes from './routes/search.routes.js';
import reviewRoutes from './routes/review.routes.js';
import qnaRoutes from './routes/qna.routes.js';
import storeRoutes from './routes/store.routes.js';
import cartRoutes from './routes/cart.routes.js';
import wishlistRoutes from './routes/wishlist.routes.js';
import orderRoutes from './routes/order.routes.js';
import financeRoutes from './routes/finance.routes.js';
import logisticsRoutes from './routes/logistics.routes.js';
import returnRoutes from './routes/return.routes.js';
import disputeRoutes from './routes/dispute.routes.js';
import moderationRoutes from './routes/moderation.routes.js';
import kycRoutes from './routes/kyc.routes.js';
import chatRoutes from './routes/chat.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import salerInboxRoutes from './routes/salerInbox.routes.js';
import adsRoutes from './routes/ads.routes.js';
import promotionRoutes from './routes/promotion.routes.js';
import referralRoutes from './routes/referral.routes.js';
import gamificationRoutes from './routes/gamification.routes.js';
import teamPurchaseRoutes from './routes/teamPurchase.routes.js';
import cartRecoveryRoutes from './routes/cartRecovery.routes.js';
import socialKitRoutes from './routes/socialKit.routes.js';
import liveStreamRoutes from './routes/liveStream.routes.js';
import aiRoutes from './routes/ai.routes.js';
import warrantyRoutes from './routes/warranty.routes.js';
import fastifyWebsocket from '@fastify/websocket';
import websocketGateway from './sockets/gateway.js';
import { startGrantExpiryScheduler } from './jobs/grantExpiryCron.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import './jobs/escrowRelease.job.js'; // Registers escrow_release job with scheduler
import './jobs/teamPurchaseExpiry.job.js'; // Registers team_purchase_expiry job with scheduler
import './jobs/cartRecovery.job.js'; // Registers cart_recovery_sweep job with scheduler
import { createSmsSender } from './integrations/sms/index.js';

/**
 * A @fastify/rate-limit custom Store, backed by our cache adapter instead of the plugin's
 * built-in LocalStore/RedisStore, so CACHE_DRIVER=memory keeps rate limiting working with no
 * Redis installed (docs/api-contract.md §6). The plugin instantiates stores itself and does not
 * forward extra registration options into the constructor, so the cache instance is captured via
 * closure instead of passed through fastify.
 */
function createRateLimitStoreClass(cache) {
  return class CacheRateLimitStore {
    constructor(params) {
      this.timeWindow = params.timeWindow;
    }

    incr(key, cb, timeWindow) {
      const windowMs = timeWindow ?? this.timeWindow;
      cache
        .incr(`ratelimit:${key}`)
        .then(async (current) => {
          if (current === 1) {
            await cache.expire(`ratelimit:${key}`, Math.ceil(windowMs / 1000));
          }
          const ttl = await cache.ttl(`ratelimit:${key}`);
          cb(null, { current, ttl: ttl >= 0 ? ttl : windowMs });
        })
        .catch((err) => cb(err));
    }

    child(routeParams) {
      return new this.constructor(routeParams);
    }
  };
}

export async function buildApp(overrides = {}) {
  const config = overrides.config ?? loadEnv();

  const app = Fastify({
    logger: { level: config.core.logLevel },
    routerOptions: { ignoreTrailingSlash: true },
  });

  const pool = overrides.pool ?? createDbPool(config);
  const cache = overrides.cache ?? (await createCache(config, app.log));

  app.decorate('config', config);
  app.decorate('db', pool);
  app.decorate('cache', cache);
  app.decorate('smsSender', createSmsSender(config));

  app.register(requestContextPlugin);
  app.register(errorHandlerPlugin);
  app.register(authenticatePlugin);
  app.register(requirePermissionPlugin);
  app.register(requireRestrictionPlugin);
  app.register(requireModulePlugin);

  await app.register(helmet, { global: true });

  await app.register(cors, {
    origin: config.core.publicWebUrl,
    credentials: true,
  });

  await app.register(cookie, { secret: config.auth.cookieSecret || undefined });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    store: createRateLimitStoreClass(cache),
    // Match docs/api-contract.md §2.3's error envelope instead of the plugin's own shape — the
    // X-RateLimit-*/Retry-After headers are still set by the plugin regardless of this builder.
    errorResponseBuilder: (req, context) => ({
      error: {
        code: 'RATE_LIMITED',
        message_en: `Too many requests. Please try again in ${Math.ceil(context.ttl / 1000)}s.`,
        message_bn: `অনেক বেশি অনুরোধ করা হয়েছে। প্রায় ${Math.ceil(context.ttl / 1000)} সেকেন্ড পরে আবার চেষ্টা করুন।`,
        trace_id: req.traceId ?? 'unknown',
      },
    }),
  });

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(meRoutes, { prefix: '/api/v1/me' });
  await app.register(delegationRoutes, { prefix: '/api/v1' });
  await app.register(restrictionRoutes, { prefix: '/api/v1' });
  await app.register(auditRoutes, { prefix: '/api/v1' });
  await app.register(moduleRoutes, { prefix: '/api/v1' });
  await app.register(userRoutes, { prefix: '/api/v1' });
  await app.register(themeRoutes, { prefix: '/api/v1' });
  await app.register(mediaRoutes, { prefix: '/api/v1' });
  await app.register(productRoutes, { prefix: '/api/v1' });
  await app.register(searchRoutes, { prefix: '/api/v1' });
  await app.register(reviewRoutes, { prefix: '/api/v1' });
  await app.register(qnaRoutes, { prefix: '/api/v1' });
  await app.register(storeRoutes, { prefix: '/api/v1' });
  await app.register(cartRoutes, { prefix: '/api/v1' });
  await app.register(wishlistRoutes, { prefix: '/api/v1' });
  await app.register(orderRoutes, { prefix: '/api/v1' });
  await app.register(financeRoutes, { prefix: '/api/v1' });
  await app.register(logisticsRoutes, { prefix: '/api/v1' });
  await app.register(returnRoutes, { prefix: '/api/v1' });
  await app.register(disputeRoutes, { prefix: '/api/v1' });
  await app.register(moderationRoutes, { prefix: '/api/v1' });
  await app.register(kycRoutes, { prefix: '/api/v1' });
  await app.register(chatRoutes, { prefix: '/api/v1' });
  await app.register(notificationRoutes, { prefix: '/api/v1' });
  await app.register(whatsappRoutes, { prefix: '/api/v1' });
  await app.register(salerInboxRoutes, { prefix: '/api/v1' });
  await app.register(adsRoutes, { prefix: '/api/v1' });
  await app.register(promotionRoutes, { prefix: '/api/v1' });
  await app.register(referralRoutes, { prefix: '/api/v1' });
  await app.register(gamificationRoutes, { prefix: '/api/v1' });
  await app.register(teamPurchaseRoutes, { prefix: '/api/v1' });
  await app.register(cartRecoveryRoutes, { prefix: '/api/v1' });
  await app.register(socialKitRoutes, { prefix: '/api/v1' });
  await app.register(socialKitRoutes); // Root registration for /s/:code
  await app.register(liveStreamRoutes, { prefix: '/api/v1' });
  await app.register(aiRoutes, { prefix: '/api/v1' });
  await app.register(warrantyRoutes, { prefix: '/api/v1' });

  // Register WebSocket Gateway (Prompt 8.1)
  await app.register(fastifyWebsocket);
  await app.register(websocketGateway);

  // Start periodic 5-minute grant/JIT/action expiry sweep (Prompt 2.5)
  const stopGrantExpiry = startGrantExpiryScheduler(pool, cache, app.log, 300000);

  // Start distributed scheduler for hourly escrow release & periodic tasks (Prompt 6.2)
  startScheduler(pool, cache, app.log, { runOnStartup: false });

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    service: 'explooro-api',
    version: '0.1.0',
    cache_driver: cache.driver,
    ts: new Date().toISOString(),
    uptime_s: Math.round(process.uptime()),
  }));

  app.addHook('onClose', async () => {
    stopScheduler();
    stopGrantExpiry();
    await cache.quit?.();
    await pool.end();
  });

  return app;
}
