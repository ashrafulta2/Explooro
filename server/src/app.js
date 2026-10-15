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

import { loadEnv } from './config/env.ts';
import { createDbPool } from './config/db.ts';
import { createCache } from './config/cache.ts';
import requestContextPlugin from './plugins/requestContext.ts';
import requestMetricsPlugin from './lib/requestMetrics.ts';
import errorHandlerPlugin, { AppError } from './plugins/errorHandler.ts';
import authenticatePlugin from './middlewares/authenticate.ts';
import requirePermissionPlugin from './middlewares/requirePermission.ts';
import requireRestrictionPlugin from './middlewares/requireRestriction.ts';
import requireModulePlugin from './middlewares/requireModule.ts';
import requirePagePlugin from './middlewares/requirePage.ts';
import idempotencyPlugin from './middlewares/idempotency.ts';
import authRoutes from './routes/auth.routes.ts';
import meRoutes from './routes/me.routes.ts';
import delegationRoutes from './routes/delegation.routes.ts';
import restrictionRoutes from './routes/restriction.routes.ts';
import auditRoutes from './routes/audit.routes.ts';
import moduleRoutes from './routes/module.routes.ts';
import pageAccessRoutes from './routes/pageAccess.routes.ts';
import userRoutes from './routes/user.routes.ts';
import staffRoutes from './routes/staff.routes.ts';
import themeRoutes from './routes/theme.routes.js';
import localizationRoutes from './routes/localization.routes.ts';
import genieRoutes from './routes/genie.routes.ts';
import deliveryChargeRoutes from './routes/deliveryCharge.routes.ts';
import recommendationAdminRoutes from './routes/recommendationAdmin.routes.js';
import mediaRoutes from './routes/media.routes.ts';
import productRoutes from './routes/product.routes.js';
import discoveryRoutes from './routes/discovery.routes.js';
import searchRoutes from './routes/search.routes.js';
import reviewRoutes from './routes/review.routes.js';
import qnaRoutes from './routes/qna.routes.ts';
import storeRoutes from './routes/store.routes.ts';
import cartRoutes from './routes/cart.routes.ts';
import wishlistRoutes from './routes/wishlist.routes.ts';
import orderRoutes from './routes/order.routes.ts';
import paymentRoutes from './routes/payment.routes.ts';
import financeRoutes from './routes/finance.routes.ts';
import subscriptionRoutes from './routes/subscription.routes.ts';
import logisticsRoutes from './routes/logistics.routes.ts';
import returnRoutes from './routes/return.routes.ts';
import disputeRoutes from './routes/dispute.routes.ts';
import moderationRoutes from './routes/moderation.routes.ts';
import kycRoutes from './routes/kyc.routes.ts';
import chatRoutes from './routes/chat.routes.ts';
import notificationRoutes from './routes/notification.routes.ts';
import whatsappRoutes from './routes/whatsapp.routes.ts';
import salerInboxRoutes from './routes/salerInbox.routes.ts';
import adsRoutes from './routes/ads.routes.ts';
import promotionRoutes from './routes/promotion.routes.ts';
import referralRoutes from './routes/referral.routes.ts';
import gamificationRoutes from './routes/gamification.routes.ts';
import growthAdminRoutes from './routes/growthAdmin.routes.ts';
import teamPurchaseRoutes from './routes/teamPurchase.routes.ts';
import cartRecoveryRoutes from './routes/cartRecovery.routes.ts';
import socialKitRoutes from './routes/socialKit.routes.ts';
import liveStreamRoutes from './routes/liveStream.routes.ts';
import aiRoutes from './routes/ai.routes.js';
import warrantyRoutes from './routes/warranty.routes.ts';
import bundleRoutes from './routes/bundle.routes.ts';
import b2bEscrowRoutes from './routes/b2bEscrow.routes.ts';
import publicApiRoutes from './routes/publicApi.routes.ts';
import contentRoutes from './routes/content.routes.ts';
import supplierRoutes from './routes/supplier.routes.ts';
import salerRoutes from './routes/saler.routes.ts';
import customerRoutes from './routes/customer.routes.ts';
import homeSummaryRoutes from './routes/homeSummary.routes.ts';
import fastifyWebsocket from '@fastify/websocket';
import websocketGateway from './sockets/gateway.ts';
import { startGrantExpiryScheduler } from './jobs/grantExpiryCron.ts';
import { startScheduler, stopScheduler } from './jobs/scheduler.ts';
import './jobs/escrowRelease.job.ts'; // Registers escrow_release job with scheduler
import './jobs/teamPurchaseExpiry.job.ts'; // Registers team_purchase_expiry job with scheduler
import './jobs/cartRecovery.job.ts'; // Registers cart_recovery_sweep job with scheduler
import './jobs/expiryWarning.job.ts'; // Registers batch_expiry_warning_sweep with scheduler
import './jobs/analyticsRollup.job.ts'; // Registers analytics_nightly_rollup with scheduler
import './jobs/subscriptionRenewal.job.ts'; // Registers subscription_renewal with scheduler (module: subscription_fees)
import './jobs/covisitRebuild.job.ts'; // Registers covisit_rebuild with scheduler (module: personalization_signals)
import './jobs/signalRetention.job.ts'; // Registers signal_retention with scheduler (module: personalization_signals)
import './jobs/coinExpiry.job.ts'; // Registers coin_expiry with scheduler (module: loyalty_coins)
import './jobs/referralRelease.job.ts'; // Registers referral_release with scheduler (module: referral_engine)
import './jobs/supplierScorecard.job.ts'; // Registers supplier_scorecard with scheduler (module: sourcing)
import './jobs/volumeIncentive.job.ts'; // Registers volume_incentive with scheduler (module: sourcing)
import './jobs/salerTier.job.ts'; // Registers saler_tier with scheduler (setting: saler.commission_tiers.enabled)
import './jobs/sampleKit.job.ts'; // Registers sample_kit with scheduler (module: sourcing)
import './jobs/returnProtection.job.ts'; // Registers return_protection with scheduler (module: sourcing)
import './jobs/deficitRecovery.job.ts'; // Registers deficit_recovery with scheduler (module: returns_engine)
import adminAnalyticsRoutes from './routes/adminAnalytics.routes.ts';
import sitemapRoutes from './routes/sitemap.routes.ts';
import { createSmsSender } from './integrations/sms/index.ts';
import { createEmailSender } from './integrations/email/index.ts';

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
    trustProxy: config.core.trustProxy,
    routerOptions: { ignoreTrailingSlash: true },
  });

  const pool = overrides.pool ?? createDbPool(config);
  const cache = overrides.cache ?? (await createCache(config, app.log));

  app.decorate('config', config);
  app.decorate('db', pool);
  app.decorate('cache', cache);
  app.decorate('smsSender', createSmsSender(config));
  app.decorate('emailSender', createEmailSender(config));

  app.register(requestContextPlugin);
  app.register(requestMetricsPlugin);
  app.register(errorHandlerPlugin);
  app.register(authenticatePlugin);
  app.register(requirePermissionPlugin);
  app.register(requireRestrictionPlugin);
  app.register(requireModulePlugin);
  // Must be registered before any route plugin: its onRoute hook only sees routes added after it.
  app.register(requirePagePlugin);
  // Same rule: its onRoute hook must be registered before the route plugins. Gives every write route
  // Idempotency-Key support (CLAUDE.md constraint 11).
  app.register(idempotencyPlugin);

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
    // WHY an AppError and not a plain { error } object: @fastify/rate-limit 11 throws what this
    // returns, and the error handler only maps AppError codes to a status. The plain object fell
    // through to INTERNAL_ERROR, so a rate-limited visitor got HTTP 500 "something went wrong"
    // instead of 429 with the wait time. The X-RateLimit-*/Retry-After headers are set either way.
    errorResponseBuilder: (req, context) => {
      const seconds = Math.ceil(context.ttl / 1000);
      return new AppError(
        'RATE_LIMITED',
        `Too many requests. Please try again in ${seconds}s.`,
        `অনেক বেশি অনুরোধ করা হয়েছে। প্রায় ${seconds} সেকেন্ড পরে আবার চেষ্টা করুন।`
      );
    },
  });

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(meRoutes, { prefix: '/api/v1/me' });
  await app.register(delegationRoutes, { prefix: '/api/v1' });
  await app.register(restrictionRoutes, { prefix: '/api/v1' });
  await app.register(auditRoutes, { prefix: '/api/v1' });
  await app.register(moduleRoutes, { prefix: '/api/v1' });
  await app.register(pageAccessRoutes, { prefix: '/api/v1' });
  await app.register(userRoutes, { prefix: '/api/v1' });
  await app.register(staffRoutes, { prefix: '/api/v1' });
  await app.register(themeRoutes, { prefix: '/api/v1' });
  await app.register(localizationRoutes, { prefix: '/api/v1' });
  await app.register(genieRoutes, { prefix: '/api/v1' });
  await app.register(deliveryChargeRoutes, { prefix: '/api/v1' });
  await app.register(recommendationAdminRoutes, { prefix: '/api/v1' });
  await app.register(mediaRoutes, { prefix: '/api/v1' });
  await app.register(productRoutes, { prefix: '/api/v1' });
  await app.register(discoveryRoutes, { prefix: '/api/v1' });
  await app.register(searchRoutes, { prefix: '/api/v1' });
  await app.register(reviewRoutes, { prefix: '/api/v1' });
  await app.register(qnaRoutes, { prefix: '/api/v1' });
  await app.register(storeRoutes, { prefix: '/api/v1' });
  await app.register(cartRoutes, { prefix: '/api/v1' });
  await app.register(wishlistRoutes, { prefix: '/api/v1' });
  await app.register(orderRoutes, { prefix: '/api/v1' });
  await app.register(paymentRoutes, { prefix: '/api/v1' });
  await app.register(financeRoutes, { prefix: '/api/v1' });
  await app.register(subscriptionRoutes, { prefix: '/api/v1' });
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
  await app.register(growthAdminRoutes, { prefix: '/api/v1' });
  await app.register(teamPurchaseRoutes, { prefix: '/api/v1' });
  await app.register(cartRecoveryRoutes, { prefix: '/api/v1' });
  await app.register(socialKitRoutes, { prefix: '/api/v1' });
  await app.register(socialKitRoutes); // Root registration for /s/:code
  await app.register(liveStreamRoutes, { prefix: '/api/v1' });
  await app.register(aiRoutes, { prefix: '/api/v1' });
  await app.register(warrantyRoutes, { prefix: '/api/v1' });
  await app.register(bundleRoutes, { prefix: '/api/v1' });
  await app.register(b2bEscrowRoutes, { prefix: '/api/v1' });
  await app.register(publicApiRoutes, { prefix: '/api/v1' });
  await app.register(contentRoutes, { prefix: '/api/v1' });
  await app.register(supplierRoutes, { prefix: '/api/v1' });
  await app.register(salerRoutes, { prefix: '/api/v1' });
  await app.register(customerRoutes, { prefix: '/api/v1' });
  await app.register(homeSummaryRoutes, { prefix: '/api/v1' });
  await app.register(adminAnalyticsRoutes, { prefix: '/api/v1' });
  await app.register(sitemapRoutes); // Root registration for /sitemap.xml and /robots.txt

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
